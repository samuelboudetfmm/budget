import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or } from "drizzle-orm";
import { db, schema } from "./db";
import type { Category, Email, Transaction } from "./db/schema";
import { askJSON, aiConfigured } from "./ai";
import { addDays, daysBetween } from "./dates";
import { log } from "./log";
import { detectInstallments, matchInstallment } from "./installments";

const NOISE =
  /\b(CB|CARTE|PAIEMENT|PAIEM|PAR|ACHAT|PRLV|PRELEVEMENT|SEPA|VIR|VIREMENT|INST|RECU|EMIS|FACTURE|DU|LE|FR|X\d+|\d+)\b/g;

/** Clé stable d'un commerçant à partir du libellé bancaire (pour les règles apprises). */
export function merchantKey(label: string): string {
  const cleaned = label
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\d{2}[/.]\d{2}([/.]\d{2,4})?/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.split(" ").filter((w) => w.length > 1).slice(0, 2).join(" ");
}

export function activeCategories(): Category[] {
  return db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.archived, false))
    .orderBy(asc(schema.categories.sortOrder))
    .all();
}

export function categoriesForPrompt(cats: Category[]): string {
  return cats
    .map((c) => `- ${c.id} : ${c.name} [${c.kind}]${c.hint ? ` — ${c.hint}` : ""}`)
    .join("\n");
}

export function setSplits(
  txId: number,
  parts: { categoryId: number; amount: number; note?: string | null }[],
  meta: Partial<Pick<Transaction, "classifiedBy" | "aiConfidence" | "aiReason" | "merchant" | "emailId">>,
) {
  db.transaction((t) => {
    t.delete(schema.splits).where(eq(schema.splits.transactionId, txId)).run();
    if (parts.length) {
      t.insert(schema.splits)
        .values(parts.map((p) => ({ transactionId: txId, categoryId: p.categoryId, amount: p.amount, note: p.note ?? null })))
        .run();
    }
    if (Object.keys(meta).length) t.update(schema.transactions).set(meta).where(eq(schema.transactions.id, txId)).run();
  });
}

/** Mémorise le choix de l'utilisateur pour les prochaines transactions du même commerçant. */
export function learnRule(tx: Transaction, categoryId: number, multi: boolean) {
  const key = merchantKey(tx.label);
  if (!key) return;
  db.insert(schema.merchantRules)
    .values({ merchantKey: key, categoryId, multi })
    .onConflictDoUpdate({ target: schema.merchantRules.merchantKey, set: { categoryId, multi } })
    .run();
}

// ---------- Tickets / emails ----------

export type EmailExtraction = {
  isPurchase: boolean;
  merchant?: string | null;
  date?: string | null;
  total?: number | null; // euros
  mainCategoryId?: number | null;
  cardLast4?: string | null;
  items?: { label: string; amount: number; categoryId: number }[];
};

function emailExtraction(email: Email): EmailExtraction | null {
  if (!email.extracted) return null;
  try {
    return JSON.parse(email.extracted) as EmailExtraction;
  } catch {
    return null;
  }
}

function amountMatches(txAmount: number, totalEuros: number): boolean {
  const total = Math.round(totalEuros * 100);
  const diff = Math.abs(Math.abs(txAmount) - total);
  return diff <= Math.max(5, Math.round(total * 0.005));
}

/** Répartit le montant de la transaction selon les lignes du ticket. */
export function applyEmailToTransaction(email: Email, tx: Transaction): boolean {
  const ex = emailExtraction(email);
  if (!ex) return false;
  const sign = tx.amount < 0 ? -1 : 1;
  const total = Math.abs(tx.amount);
  const byCat = new Map<number, number>();
  for (const it of ex.items ?? []) {
    if (!it.categoryId || !Number.isFinite(it.amount)) continue;
    byCat.set(it.categoryId, (byCat.get(it.categoryId) ?? 0) + Math.max(0, it.amount));
  }
  const itemsSum = [...byCat.values()].reduce((a, b) => a + b, 0);
  let parts: { categoryId: number; amount: number }[];
  if (itemsSum > 0) {
    parts = [...byCat.entries()].map(([categoryId, v]) => ({
      categoryId,
      amount: Math.round((v / itemsSum) * total),
    }));
    // Ajuste l'arrondi sur la plus grosse part
    const diff = total - parts.reduce((a, p) => a + p.amount, 0);
    parts.sort((a, b) => b.amount - a.amount);
    parts[0].amount += diff;
  } else if (ex.mainCategoryId) {
    parts = [{ categoryId: ex.mainCategoryId, amount: total }];
  } else {
    return false;
  }
  setSplits(
    tx.id,
    parts.filter((p) => p.amount !== 0).map((p) => ({ ...p, amount: p.amount * sign })),
    {
      classifiedBy: "email",
      emailId: email.id,
      merchant: ex.merchant ?? tx.merchant,
      aiReason: `D'après le mail « ${email.subject ?? ""} »`,
      aiConfidence: 0.95,
    },
  );
  db.update(schema.emails).set({ status: "matched" }).where(eq(schema.emails.id, email.id)).run();
  log("email", `Mail #${email.id} rattaché à la transaction #${tx.id} (${parts.length} catégorie(s))`);
  return true;
}

function emailDate(email: Email, ex: EmailExtraction): string {
  return ex.date && /^\d{4}-\d{2}-\d{2}$/.test(ex.date) ? ex.date : email.receivedAt.toISOString().slice(0, 10);
}

/** Cherche un mail de commande/ticket correspondant à une transaction. */
export function findEmailForTransaction(tx: Transaction): Email | null {
  if (tx.amount >= 0) return null;
  const candidates = db
    .select()
    .from(schema.emails)
    .where(eq(schema.emails.status, "parsed"))
    .orderBy(desc(schema.emails.receivedAt))
    .limit(200)
    .all();
  let best: { email: Email; score: number } | null = null;
  for (const email of candidates) {
    const ex = emailExtraction(email);
    if (!ex?.isPurchase || ex.total == null || !amountMatches(tx.amount, ex.total)) continue;
    // Le débit arrive en général entre le jour de la commande et ~15 jours après (expédition)
    const gap = daysBetween(emailDate(email, ex), tx.date);
    if (gap < -3 || gap > 15) continue;
    const score = Math.abs(gap);
    if (!best || score < best.score) best = { email, score };
  }
  return best?.email ?? null;
}

/** Cherche la transaction correspondant à un mail déjà analysé (le mail arrive souvent après). */
export function findTransactionForEmail(email: Email): Transaction | null {
  const ex = emailExtraction(email);
  if (!ex?.isPurchase || ex.total == null) return null;
  const d = emailDate(email, ex);
  const candidates = db
    .select()
    .from(schema.transactions)
    .where(
      and(
        gte(schema.transactions.date, addDays(d, -3)),
        lte(schema.transactions.date, addDays(d, 15)),
        isNull(schema.transactions.emailId),
        or(isNull(schema.transactions.classifiedBy), ne(schema.transactions.classifiedBy, "user")),
      ),
    )
    .all();
  const matches = candidates
    .filter((tx) => tx.amount < 0 && amountMatches(tx.amount, ex.total!))
    .sort((a, b) => Math.abs(daysBetween(d, a.date)) - Math.abs(daysBetween(d, b.date)));
  return matches[0] ?? null;
}

// ---------- Classification ----------

type AIResult = {
  results: { id: number; merchant?: string; categoryId: number; confidence?: number; reason?: string }[];
};

function examplesForPrompt(): string {
  const rows = db
    .select({ label: schema.transactions.label, merchant: schema.transactions.merchant, categoryId: schema.splits.categoryId })
    .from(schema.transactions)
    .innerJoin(schema.splits, eq(schema.splits.transactionId, schema.transactions.id))
    .where(eq(schema.transactions.classifiedBy, "user"))
    .orderBy(desc(schema.transactions.id))
    .limit(200)
    .all();
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of rows) {
    const k = merchantKey(r.label);
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`"${r.label}" → ${r.categoryId}`);
    if (lines.length >= 40) break;
  }
  return lines.join("\n");
}

async function classifyWithAI(txs: Transaction[], cats: Category[]) {
  const multiRules = new Set(
    db.select().from(schema.merchantRules).where(eq(schema.merchantRules.multi, true)).all().map((r) => r.merchantKey),
  );
  const examples = examplesForPrompt();
  const system = `Tu classes les opérations bancaires d'une famille française dans des catégories de budget.
Catégories disponibles (id : nom [type] — précision) :
${categoriesForPrompt(cats)}

Règles :
- Montant négatif = dépense, positif = crédit (revenu, remboursement, virement reçu).
- Choisis l'id de catégorie le plus probable. Un remboursement reçu va dans la catégorie de la dépense d'origine si évident, sinon "Revenus".
- L'argent d'une vente d'occasion (Vinted, Leboncoin, eBay…) va dans la catégorie Libre, pas dans Revenus.
- Un virement du compte commun vers le compte personnel d'un membre va dans le budget privé de ce membre (catégorie qui porte son nom), pas dans "Virements internes".
- "merchant" : nom lisible et court du commerçant (ex : "Carrefour Market", "SNCF", "Amazon").
- Pour un commerçant multi-rayons (supermarché, Amazon, Fnac…) sans détail, choisis la catégorie la plus probable et indique-le dans "reason" ; un ticket reçu par mail affinera ensuite.
- "confidence" entre 0 et 1. En cas de doute, choisis quand même l'hypothèse la plus probable, mets une confiance inférieure à 0.7 et formule l'hypothèse dans "reason" (ex : "Supposé alimentaire : supermarché sans ticket").
- "reason" : une phrase courte en français.
${examples ? `\nExemples déjà validés par la famille (libellé → id) :\n${examples}\n` : ""}
Réponds uniquement en JSON : {"results":[{"id":number,"merchant":string,"categoryId":number,"confidence":number,"reason":string}]}`;
  const user = JSON.stringify(
    txs.map((t) => ({
      id: t.id,
      date: t.date,
      amount: (t.amount / 100).toFixed(2),
      label: t.label,
      merchant: t.merchant,
      multiCategoryMerchant: multiRules.has(merchantKey(t.label)) || undefined,
    })),
  );
  const out = await askJSON<AIResult>(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 300 + txs.length * 120 },
  );
  const validIds = new Set(cats.map((c) => c.id));
  for (const r of out.results ?? []) {
    const tx = txs.find((t) => t.id === r.id);
    if (!tx || !validIds.has(r.categoryId)) continue;
    setSplits(tx.id, [{ categoryId: r.categoryId, amount: tx.amount }], {
      classifiedBy: "ai",
      merchant: r.merchant || tx.merchant,
      aiConfidence: r.confidence ?? null,
      aiReason: r.reason ?? null,
    });
  }
}

// Plateformes de revente entre particuliers : leurs versements alimentent le budget Libre
const RESALE = /vinted|leboncoin|le bon coin|\bebay\b|beebs|vestiaire collective|selency|momox|label emmaus/i;

export const isResale = (tx: Pick<Transaction, "label" | "merchant">) => RESALE.test(`${tx.label} ${tx.merchant ?? ""}`);

/**
 * Classe les transactions données (non encore classées par l'utilisateur) :
 * 1. ticket reçu par mail, 2. règle apprise, 3. IA par lots.
 */
export async function classifyTransactions(ids: number[], opts: { force?: boolean } = {}) {
  if (!ids.length) return;
  await classifyOnly(ids, opts);
  // Paiement fractionné repéré dans le libellé : supposé, à confirmer dans « À vérifier »
  detectInstallments(ids);
}

async function classifyOnly(ids: number[], opts: { force?: boolean }) {
  const txs = db.select().from(schema.transactions).where(inArray(schema.transactions.id, ids)).all();
  const classified = new Set(
    db
      .select({ id: schema.splits.transactionId })
      .from(schema.splits)
      .where(inArray(schema.splits.transactionId, ids))
      .all()
      .map((r) => r.id),
  );
  const rules = new Map(db.select().from(schema.merchantRules).all().map((r) => [r.merchantKey, r]));
  const libre = db.select().from(schema.categories).where(eq(schema.categories.code, "libre")).get();
  const forAI: Transaction[] = [];

  for (const tx of txs) {
    if (tx.classifiedBy === "user") continue;
    if (classified.has(tx.id) && !opts.force) continue;
    if (matchInstallment(tx)) continue;
    if (tx.amount > 0 && isResale(tx) && libre) {
      setSplits(tx.id, [{ categoryId: libre.id, amount: tx.amount }], {
        classifiedBy: "rule",
        aiConfidence: 1,
        aiReason: "Vente d'occasion : l'argent alimente le budget Libre",
      });
      continue;
    }
    const email = findEmailForTransaction(tx);
    if (email && applyEmailToTransaction(email, tx)) continue;
    const rule = rules.get(merchantKey(tx.label)) ?? (tx.merchant ? rules.get(merchantKey(tx.merchant)) : undefined);
    if (rule && !rule.multi) {
      setSplits(tx.id, [{ categoryId: rule.categoryId, amount: tx.amount }], {
        classifiedBy: "rule",
        aiConfidence: 1,
        aiReason: "Règle apprise de vos corrections",
      });
      continue;
    }
    forAI.push(tx);
  }

  if (!forAI.length) return;
  if (!aiConfigured()) {
    log("ai", `${forAI.length} transaction(s) non classée(s) : clé OpenRouter absente`, "warn");
    return;
  }
  // Les échéances déjà comptées sont rattachées par les plans, jamais devinées
  const cats = activeCategories().filter((c) => c.code !== "echeance");
  for (let i = 0; i < forAI.length; i += 20) {
    const batch = forAI.slice(i, i + 20);
    try {
      await classifyWithAI(batch, cats);
    } catch (e) {
      log("ai", `Échec de classification de ${batch.length} transaction(s) : ${(e as Error).message}`, "error");
    }
  }
}

/** Relance la classification des transactions restées sans catégorie (ex : IA indisponible). */
export async function classifyPending(limit = 100) {
  const withSplits = db.select({ id: schema.splits.transactionId }).from(schema.splits);
  const rows = db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(notInArray(schema.transactions.id, withSplits))
    .orderBy(desc(schema.transactions.date))
    .limit(limit)
    .all();
  await classifyTransactions(rows.map((r) => r.id));
}
