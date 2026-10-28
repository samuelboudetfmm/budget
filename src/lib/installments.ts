import { and, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { db, schema } from "./db";
import type { InstallmentPlan, Transaction } from "./db/schema";
import { addDays, today } from "./dates";
import { merchantKey, setSplits } from "./classify";
import { categoryByCode } from "./envelopes";
import { log } from "./log";

/** Libellés typiques d'un paiement fractionné (4X CB, Oney, Alma, Klarna, PayPal 4X…). */
const BNPL = /\b(?:([2-9]|1[0-2])\s?X\b|PAIEMENT EN \d|EN \d FOIS|ONEY|ALMA|KLARNA|FLOA|COFIDIS\s?\dX|PAY\s?IN\s?\d|SCALAPAY|YOUNITED)/i;

export function looksLikeInstallment(label: string): { count: number } | null {
  const m = label.match(BNPL);
  if (!m) return null;
  const n = Number(m[1] ?? label.match(/(?:EN|IN)\s?(\d+)/i)?.[1]);
  return { count: n >= 2 && n <= 12 ? n : 4 };
}

function mainExpenseCategory(txId: number): number | null {
  const parts = db.select().from(schema.splits).where(eq(schema.splits.transactionId, txId)).all();
  const main = parts.sort((a, b) => a.amount - b.amount)[0];
  if (!main) return null;
  const cat = db.select().from(schema.categories).where(eq(schema.categories.id, main.categoryId)).get();
  return cat?.kind === "expense" ? cat.id : null;
}

export function planForTransaction(txId: number): InstallmentPlan | undefined {
  return db.select().from(schema.installmentPlans).where(eq(schema.installmentPlans.firstTransactionId, txId)).get();
}

/**
 * Déclare un achat payé en plusieurs fois. On ne s'endette pas : le total est compté le mois de l'achat
 * (opération virtuelle pour le reste), sauf pour des vacances pas encore passées qu'on paie par parties.
 */
export function createPlan(
  tx: Transaction,
  opts: { count: number; total: number; tripDate?: string | null; assumed?: boolean; categoryId?: number | null },
): InstallmentPlan | null {
  const categoryId = opts.categoryId ?? mainExpenseCategory(tx.id);
  if (!categoryId) return null;
  deletePlanOf(tx.id);
  const installment = Math.abs(tx.amount);
  const total = Math.max(opts.total, installment);
  const vacances = categoryByCode("vacances");
  const mode = vacances?.id === categoryId && opts.tripDate && opts.tripDate > tx.date ? "parts" : "upfront";
  return db.transaction((t) => {
    let complementId: number | null = null;
    if (mode === "upfront" && total > installment) {
      complementId = t
        .insert(schema.transactions)
        .values({
          date: tx.date,
          amount: -(total - installment),
          label: `Reste du paiement en ${opts.count} fois — ${tx.merchant || tx.label}`,
          merchant: tx.merchant || tx.label,
          source: "plan",
          classifiedBy: "user",
          aiReason: "Paiement fractionné compté en totalité le mois de l'achat",
        })
        .returning({ id: schema.transactions.id })
        .get().id;
      t.insert(schema.splits).values({ transactionId: complementId, categoryId, amount: -(total - installment) }).run();
    }
    const plan = t
      .insert(schema.installmentPlans)
      .values({
        firstTransactionId: tx.id,
        complementTransactionId: complementId,
        merchantKey: merchantKey(tx.label),
        categoryId,
        count: opts.count,
        total,
        installment,
        mode,
        tripDate: opts.tripDate ?? null,
        assumed: opts.assumed ?? false,
      })
      .returning()
      .get();
    t.update(schema.transactions).set({ installmentPlanId: plan.id }).where(eq(schema.transactions.id, tx.id)).run();
    if (complementId) t.update(schema.transactions).set({ installmentPlanId: plan.id }).where(eq(schema.transactions.id, complementId)).run();
    return plan;
  });
}

/** Supprime le plan d'une opération ; les échéances rattachées redeviennent des opérations à classer. */
export function deletePlanOf(txId: number): number[] {
  const plan = planForTransaction(txId);
  if (!plan) return [];
  const linked = db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.installmentPlanId, plan.id), ne(schema.transactions.id, txId)))
    .all()
    .map((r) => r.id)
    .filter((id) => id !== plan.complementTransactionId);
  db.transaction((t) => {
    if (plan.complementTransactionId) t.delete(schema.transactions).where(eq(schema.transactions.id, plan.complementTransactionId)).run();
    if (linked.length) {
      t.delete(schema.splits).where(inArray(schema.splits.transactionId, linked)).run();
      t.update(schema.transactions).set({ installmentPlanId: null, classifiedBy: null }).where(inArray(schema.transactions.id, linked)).run();
    }
    t.update(schema.transactions).set({ installmentPlanId: null }).where(eq(schema.transactions.id, txId)).run();
    t.delete(schema.installmentPlans).where(eq(schema.installmentPlans.id, plan.id)).run();
  });
  return linked;
}

/** Une échéance suivante d'un plan déjà compté : rattachée et neutralisée (elle ne compte pas une 2e fois). */
export function matchInstallment(tx: Transaction): boolean {
  if (tx.amount >= 0) return false;
  if (planForTransaction(tx.id)) return false;
  const key = merchantKey(tx.label);
  const plans = db
    .select()
    .from(schema.installmentPlans)
    .where(and(eq(schema.installmentPlans.merchantKey, key), eq(schema.installmentPlans.mode, "upfront")))
    .orderBy(desc(schema.installmentPlans.id))
    .all();
  for (const plan of plans) {
    if (Math.abs(Math.abs(tx.amount) - plan.installment) > 100) continue;
    const first = db.select().from(schema.transactions).where(eq(schema.transactions.id, plan.firstTransactionId)).get();
    if (!first || tx.date <= first.date || tx.date > addDays(first.date, 31 * plan.count + 10)) continue;
    const already = db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.installmentPlanId, plan.id), eq(schema.transactions.amount, tx.amount)))
      .all()
      .filter((r) => r.id !== tx.id).length;
    if (already >= plan.count) continue;
    const echeance = categoryByCode("echeance");
    if (!echeance) return false;
    db.update(schema.transactions).set({ installmentPlanId: plan.id }).where(eq(schema.transactions.id, tx.id)).run();
    setSplits(tx.id, [{ categoryId: echeance.id, amount: tx.amount }], {
      classifiedBy: "rule",
      aiConfidence: 1,
      aiReason: `Échéance du paiement en ${plan.count} fois du ${first.date}, déjà comptée en totalité`,
    });
    return true;
  }
  return false;
}

/**
 * Libellé de paiement fractionné sans plan : on suppose un achat en N fois (N lu dans le libellé, 4 sinon)
 * dont c'est la première échéance. L'hypothèse apparaît dans la page « À vérifier ».
 */
export function detectInstallments(ids: number[]) {
  if (!ids.length) return;
  const recent = addDays(today(), -60);
  const txs = db
    .select()
    .from(schema.transactions)
    .where(
      and(
        inArray(schema.transactions.id, ids),
        isNull(schema.transactions.installmentPlanId),
        gte(schema.transactions.date, recent),
        or(isNull(schema.transactions.classifiedBy), ne(schema.transactions.classifiedBy, "user")),
      ),
    )
    .all();
  for (const tx of txs) {
    if (tx.amount >= 0 || tx.source === "plan") continue;
    const guess = looksLikeInstallment(tx.label);
    if (!guess) continue;
    const plan = createPlan(tx, { count: guess.count, total: Math.abs(tx.amount) * guess.count, assumed: true });
    if (plan) log("ai", `Paiement en ${guess.count} fois supposé pour l'opération #${tx.id} (${tx.label})`);
  }
}
