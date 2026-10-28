import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { db, schema } from "./db";
import type { Email } from "./db/schema";
import { askJSON, aiConfigured } from "./ai";
import {
  activeCategories,
  applyEmailToTransaction,
  categoriesForPrompt,
  findTransactionForEmail,
  type EmailExtraction,
} from "./classify";
import { log } from "./log";

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " \t ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&euro;/gi, "€")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

type RawInput = { raw: Buffer | string } | { from?: string; subject?: string; text?: string; html?: string; date?: string; messageId?: string };

/** Enregistre un mail (brut MIME ou champs déjà extraits) puis l'analyse. */
export async function receiveEmail(input: RawInput): Promise<Email | null> {
  let messageId: string, fromAddr: string | null, subject: string | null, receivedAt: Date, body: string;
  if ("raw" in input) {
    const parsed = await simpleParser(input.raw);
    body = parsed.text?.trim() || (parsed.html ? htmlToText(parsed.html) : "");
    if (parsed.html && body.length < 200) body = htmlToText(parsed.html);
    messageId = parsed.messageId || crypto.createHash("sha256").update(String(input.raw)).digest("hex");
    fromAddr = parsed.from?.text ?? null;
    subject = parsed.subject ?? null;
    receivedAt = parsed.date ?? new Date();
  } else {
    body = input.text?.trim() || (input.html ? htmlToText(input.html) : "");
    messageId =
      input.messageId || crypto.createHash("sha256").update(`${input.from}|${input.subject}|${body}`).digest("hex");
    fromAddr = input.from ?? null;
    subject = input.subject ?? null;
    receivedAt = input.date ? new Date(input.date) : new Date();
  }
  const existing = db.select().from(schema.emails).where(eq(schema.emails.messageId, messageId)).get();
  if (existing) return existing;
  const email = db
    .insert(schema.emails)
    .values({ messageId, fromAddr, subject, receivedAt, body: body.slice(0, 60_000) })
    .returning()
    .get();
  log("email", `Mail reçu : « ${subject ?? "(sans objet)"} » de ${fromAddr ?? "?"}`);
  await analyzeEmail(email.id);
  return email;
}

/** Extraction IA : commerçant, total, lignes réparties par catégorie ; puis rapprochement. */
export async function analyzeEmail(emailId: number) {
  const email = db.select().from(schema.emails).where(eq(schema.emails.id, emailId)).get();
  if (!email) return;
  if (!aiConfigured()) {
    db.update(schema.emails).set({ status: "error", error: "Clé OpenRouter absente" }).where(eq(schema.emails.id, emailId)).run();
    return;
  }
  const cats = activeCategories().filter((c) => c.kind === "expense");
  try {
    const ex = await askJSON<EmailExtraction>(
      [
        {
          role: "system",
          content: `Tu analyses des mails (souvent transférés) de commandes, factures, tickets de caisse et reçus d'une famille française.
Catégories de dépenses (id : nom — précision) :
${categoriesForPrompt(cats)}

Extrais :
- isPurchase : true si le mail atteste un achat/paiement avec un montant (commande, facture, ticket, reçu) ; false pour une pub, une newsletter, un simple suivi de livraison sans montant.
- merchant : nom court du commerçant.
- date : date d'achat YYYY-MM-DD.
- total : montant total réellement payé en euros (TTC, frais de port inclus, réductions déduites).
- items : lignes d'articles avec { label, amount (euros TTC, positif), categoryId }. Regroupe si plus de 40 lignes. Les frais de port vont avec la catégorie majoritaire.
- mainCategoryId : catégorie principale.
Réponds uniquement en JSON : {"isPurchase":boolean,"merchant":string|null,"date":string|null,"total":number|null,"mainCategoryId":number|null,"items":[{"label":string,"amount":number,"categoryId":number}]}`,
        },
        {
          role: "user",
          content: `De : ${email.fromAddr ?? ""}\nObjet : ${email.subject ?? ""}\nReçu le : ${email.receivedAt.toISOString()}\n\n${email.body.slice(0, 20_000)}`,
        },
      ],
      { maxTokens: 4000 },
    );
    const status = ex.isPurchase && ex.total ? "parsed" : "ignored";
    db.update(schema.emails)
      .set({ status, extracted: JSON.stringify(ex), error: null })
      .where(eq(schema.emails.id, emailId))
      .run();
    if (status !== "parsed") return;
    const updated = db.select().from(schema.emails).where(eq(schema.emails.id, emailId)).get()!;
    const tx = findTransactionForEmail(updated);
    if (tx) applyEmailToTransaction(updated, tx);
  } catch (e) {
    db.update(schema.emails).set({ status: "error", error: (e as Error).message }).where(eq(schema.emails.id, emailId)).run();
    log("email", `Analyse du mail #${emailId} impossible : ${(e as Error).message}`, "error");
  }
}
