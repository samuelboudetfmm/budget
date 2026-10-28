import crypto from "node:crypto";
import fs from "node:fs";
import { eq, isNotNull } from "drizzle-orm";
import { db, schema } from "./db";
import { addDays, today } from "./dates";
import { parseAmount } from "./money";
import { ingestTransactions, type IncomingTx } from "./ingest";
import { log } from "./log";

const API = "https://api.enablebanking.com";

export function bankConfigured(): boolean {
  return Boolean(process.env.ENABLE_BANKING_APP_ID && privateKey());
}

function privateKey(): string | null {
  if (process.env.ENABLE_BANKING_PRIVATE_KEY) return process.env.ENABLE_BANKING_PRIVATE_KEY.replace(/\\n/g, "\n");
  const p = process.env.ENABLE_BANKING_KEY_PATH;
  if (p && fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  return null;
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function jwt(): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: process.env.ENABLE_BANKING_APP_ID }));
  const body = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 }));
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey()!);
  return `${header}.${body}.${b64url(signature)}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Enable Banking ${res.status} ${path} : ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export type Aspsp = { name: string; country: string; logo?: string; maximum_consent_validity?: number };

export async function listBanks(country = "FR"): Promise<Aspsp[]> {
  const out = await call<{ aspsps: Aspsp[] }>(`/aspsps?country=${country}&psu_type=personal`);
  return out.aspsps;
}

function redirectUrl() {
  return `${process.env.APP_URL || "https://budget.samuelboudet.com"}/api/bank/callback`;
}

/** Démarre le consentement : renvoie l'URL de la banque où s'authentifier. */
export async function startAuth(aspsp: { name: string; country: string }, state: string): Promise<string> {
  const banks = await listBanks(aspsp.country);
  const bank = banks.find((b) => b.name === aspsp.name);
  // Consentement le plus long autorisé par la banque (souvent 180 jours en France)
  const seconds = Math.min(bank?.maximum_consent_validity ?? 90 * 86400, 180 * 86400);
  const out = await call<{ url: string }>("/auth", {
    method: "POST",
    body: JSON.stringify({
      access: { valid_until: new Date(Date.now() + seconds * 1000).toISOString() },
      aspsp,
      state,
      redirect_url: redirectUrl(),
      psu_type: "personal",
    }),
  });
  return out.url;
}

type SessionAccount = {
  uid: string;
  account_id?: { iban?: string };
  name?: string;
  product?: string;
  currency?: string;
};

/** Retour de la banque : crée la session, enregistre les comptes et lance l'import de l'historique. */
export async function finishAuth(code: string) {
  const s = await call<{
    session_id: string;
    accounts: SessionAccount[];
    aspsp: { name: string; country: string };
    access: { valid_until: string };
  }>("/sessions", { method: "POST", body: JSON.stringify({ code }) });
  db.insert(schema.bankSessions)
    .values({
      id: s.session_id,
      aspspName: s.aspsp.name,
      aspspCountry: s.aspsp.country,
      validUntil: new Date(s.access.valid_until),
    })
    .onConflictDoNothing()
    .run();
  for (const a of s.accounts) {
    const name = [s.aspsp.name, a.name || a.product, a.account_id?.iban?.slice(-4)].filter(Boolean).join(" · ");
    db.insert(schema.accounts)
      .values({
        name,
        source: "enablebanking",
        externalId: a.uid,
        bankSessionId: s.session_id,
        iban: a.account_id?.iban ?? null,
        currency: a.currency ?? "EUR",
      })
      .onConflictDoUpdate({ target: schema.accounts.externalId, set: { bankSessionId: s.session_id } })
      .run();
  }
  log("bank", `Banque connectée : ${s.aspsp.name} (${s.accounts.length} compte(s))`);
  // Juste après l'authentification forte, la banque donne en général accès à un historique plus long
  syncAll({ initial: true }).catch((e) => log("bank", (e as Error).message, "error"));
}

type EBTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator?: "CRDT" | "DBIT";
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  note?: string | null;
};

function toIncoming(t: EBTransaction, accountId: number): IncomingTx | null {
  const abs = parseAmount(t.transaction_amount.amount);
  const date = t.transaction_date || t.booking_date || t.value_date;
  if (abs == null || !date) return null;
  const amount = t.credit_debit_indicator === "DBIT" ? -Math.abs(abs) : Math.abs(abs);
  const counterparty = amount < 0 ? t.creditor?.name : t.debtor?.name;
  const label = [counterparty, ...(t.remittance_information ?? [])].filter(Boolean).join(" ").trim() || t.note || "Opération";
  const status = t.status === "PDNG" ? "pending" : "booked";
  const externalId =
    t.entry_reference ||
    t.transaction_id ||
    crypto.createHash("sha1").update(`${date}|${amount}|${label}`).digest("hex");
  return {
    accountId,
    // Les opérations "pending" changent souvent d'identifiant une fois comptabilisées
    externalId: status === "pending" ? `pdng:${externalId}` : externalId,
    date: date.slice(0, 10),
    amount,
    currency: t.transaction_amount.currency,
    label,
    status,
    source: "bank",
  };
}

async function syncAccount(account: typeof schema.accounts.$inferSelect, initial: boolean) {
  const from = initial || !account.lastSyncAt ? addDays(today(), -730) : addDays(today(), -10);
  const items: IncomingTx[] = [];
  let continuation: string | undefined;
  do {
    const q = new URLSearchParams({ date_from: from });
    if (continuation) q.set("continuation_key", continuation);
    const page = await call<{ transactions: EBTransaction[]; continuation_key?: string | null }>(
      `/accounts/${account.externalId}/transactions?${q}`,
    );
    for (const t of page.transactions ?? []) {
      const inc = toIncoming(t, account.id);
      if (inc) items.push(inc);
    }
    continuation = page.continuation_key ?? undefined;
  } while (continuation);
  items.sort((a, b) => a.date.localeCompare(b.date));
  const n = await ingestTransactions(items, { notify: !initial, background: initial });
  db.update(schema.accounts)
    .set({ lastSyncAt: new Date(), lastSyncError: null })
    .where(eq(schema.accounts.id, account.id))
    .run();
  log("bank", `${account.name} : ${items.length} opération(s) lue(s), ${n} nouvelle(s)`);
}

let running = false;

/** Synchronise tous les comptes bancaires (limité par la DSP2 à ~4 fois par jour sans action de votre part). */
export async function syncAll(opts: { initial?: boolean } = {}) {
  if (!bankConfigured() || running) return;
  running = true;
  try {
    const accounts = db.select().from(schema.accounts).where(isNotNull(schema.accounts.bankSessionId)).all();
    for (const a of accounts) {
      try {
        await syncAccount(a, Boolean(opts.initial && !a.lastSyncAt));
      } catch (e) {
        const msg = (e as Error).message;
        db.update(schema.accounts).set({ lastSyncError: msg }).where(eq(schema.accounts.id, a.id)).run();
        log("bank", `${a.name} : ${msg}`, "error");
      }
    }
  } finally {
    running = false;
  }
}
