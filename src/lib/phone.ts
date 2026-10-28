import { askJSON, aiConfigured } from "./ai";
import { normalizeDate, today } from "./dates";
import { parseAmount } from "./money";
import type { IncomingTx } from "./ingest";

export type PhonePayload = {
  amount?: string | number;
  merchant?: string;
  card?: string;
  date?: string;
  text?: string; // texte brut d'une notification (Android)
  app?: string;
};

const AMOUNT_RE = /(-|−)?\s?(\d{1,3}(?:[ .  ]\d{3})*(?:[.,]\d{1,2})?)\s?(?:€|EUR)|(?:€|EUR)\s?(-|−)?\s?(\d+(?:[.,]\d{1,2})?)/i;
const CREDIT_RE = /rembours|cr[ée]dit(é|e)?\b|vous avez re[çc]u|virement re[çc]u|refund/i;

function fromText(text: string): { amount: number; merchant: string } | null {
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  const value = parseAmount(m[2] ?? m[4]);
  if (value == null || value === 0) return null;
  const merchant =
    text.match(/(?:chez|auprès de|à|at)\s+([A-Z0-9][\w'&.\- ]{1,40}?)(?:\s+(?:le|du|pour|avec|,|\.|$))/i)?.[1]?.trim() ??
    text.replace(AMOUNT_RE, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const amount = CREDIT_RE.test(text) ? Math.abs(value) : -Math.abs(value);
  return { amount, merchant };
}

async function fromTextAI(text: string): Promise<{ amount: number; merchant: string } | null> {
  const out = await askJSON<{ isTransaction: boolean; amount?: number; merchant?: string; isCredit?: boolean }>([
    {
      role: "system",
      content: `On te donne le texte d'une notification d'application bancaire ou de paiement sur téléphone.
Si elle signale un paiement ou un encaissement, extrais le montant en euros (nombre positif), le commerçant (nom court) et isCredit (true si de l'argent est reçu ou remboursé).
Sinon isTransaction=false (code de sécurité, publicité, solde seul…).
Réponds uniquement en JSON : {"isTransaction":boolean,"amount":number,"merchant":string,"isCredit":boolean}`,
    },
    { role: "user", content: text.slice(0, 1000) },
  ]);
  if (!out.isTransaction || !out.amount) return null;
  const cents = Math.round(Math.abs(out.amount) * 100);
  return { amount: out.isCredit ? cents : -cents, merchant: out.merchant || "Paiement" };
}

/** Convertit l'appel du téléphone en opération ; null si ce n'est pas un paiement. */
export async function parsePhonePayload(p: PhonePayload): Promise<IncomingTx | null> {
  const date = (p.date && normalizeDate(p.date)) || today();
  if (p.amount != null && p.amount !== "") {
    const value = parseAmount(p.amount);
    if (value == null || value === 0) return null;
    const merchant = (p.merchant || "").trim() || "Paiement mobile";
    // Raccourci iPhone "Transaction" : montant positif = paiement
    const amount = typeof p.amount === "string" && /^\s*[-−]/.test(p.amount) ? Math.abs(value) : -Math.abs(value);
    return { date, amount, label: merchant, merchant, source: "phone", status: "pending" };
  }
  if (p.text) {
    const parsed = aiConfigured() ? await fromTextAI(p.text).catch(() => fromText(p.text!)) : fromText(p.text);
    if (!parsed) return null;
    return { date, amount: parsed.amount, label: parsed.merchant, merchant: parsed.merchant, source: "phone", status: "pending" };
  }
  return null;
}
