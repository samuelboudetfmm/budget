import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "./db";
import type { Transaction } from "./db/schema";
import { addDays, today } from "./dates";
import { classifyTransactions } from "./classify";
import { notifyTransaction } from "./push";
import { log } from "./log";

export type IncomingTx = {
  accountId?: number | null;
  externalId?: string | null;
  date: string;
  amount: number; // centimes signés
  currency?: string;
  label: string;
  merchant?: string | null;
  status?: "pending" | "booked";
  source: "bank" | "phone" | "import" | "manual";
};

/**
 * Rapproche une opération entrante d'une opération déjà connue
 * (ex : dépense signalée par le téléphone puis remontée par la banque).
 */
function findCounterpart(tx: IncomingTx): Transaction | undefined {
  const window = and(
    eq(schema.transactions.amount, tx.amount),
    gte(schema.transactions.date, addDays(tx.date, -5)),
    lte(schema.transactions.date, addDays(tx.date, 5)),
  );
  if (tx.source === "phone") {
    // La banque a pu remonter l'opération avant le téléphone
    return db
      .select()
      .from(schema.transactions)
      .where(and(window, inArray(schema.transactions.source, ["bank", "import"]), gte(schema.transactions.date, addDays(today(), -5))))
      .get();
  }
  // Opération bancaire : remplace une opération téléphone, ou une opération bancaire "pending" de la même banque
  return db
    .select()
    .from(schema.transactions)
    .where(
      and(
        window,
        or(
          and(eq(schema.transactions.source, "phone"), isNull(schema.transactions.externalId)),
          and(eq(schema.transactions.status, "pending"), eq(schema.transactions.accountId, tx.accountId ?? -1)),
        ),
      ),
    )
    .get();
}

/**
 * Enregistre des opérations (dédoublonnage + rapprochement), les classe,
 * puis notifie les dépenses récentes. Renvoie le nombre de nouvelles opérations.
 */
export async function ingestTransactions(
  items: IncomingTx[],
  opts: { notify: boolean; background?: boolean },
): Promise<number> {
  const created: number[] = [];
  for (const tx of items) {
    if (tx.externalId && tx.accountId) {
      const existing = db
        .select()
        .from(schema.transactions)
        .where(and(eq(schema.transactions.accountId, tx.accountId), eq(schema.transactions.externalId, tx.externalId)))
        .get();
      if (existing) {
        if (existing.status !== (tx.status ?? "booked")) {
          db.update(schema.transactions)
            .set({ status: tx.status ?? "booked", date: tx.date })
            .where(eq(schema.transactions.id, existing.id))
            .run();
        }
        continue;
      }
    }
    const counterpart = findCounterpart(tx);
    if (counterpart) {
      if (tx.source !== "phone") {
        // La banque fait foi : on garde la classification et la notification déjà faites
        db.update(schema.transactions)
          .set({
            accountId: tx.accountId ?? counterpart.accountId,
            externalId: tx.externalId,
            date: tx.date,
            label: tx.label,
            status: tx.status ?? "booked",
            source: tx.source,
            merchant: counterpart.merchant ?? tx.merchant,
          })
          .where(eq(schema.transactions.id, counterpart.id))
          .run();
      }
      continue;
    }
    const row = db
      .insert(schema.transactions)
      .values({
        accountId: tx.accountId ?? null,
        externalId: tx.externalId ?? null,
        date: tx.date,
        amount: tx.amount,
        currency: tx.currency ?? "EUR",
        label: tx.label,
        merchant: tx.merchant ?? null,
        status: tx.status ?? "booked",
        source: tx.source,
      })
      .returning({ id: schema.transactions.id })
      .get();
    created.push(row.id);
  }

  if (opts.background) {
    // Gros volumes (import, historique bancaire) : classification en tâche de fond
    classifyTransactions(created).catch((e) => log("ai", (e as Error).message, "error"));
    return created.length;
  }
  await classifyTransactions(created);

  if (opts.notify) {
    const recent = addDays(today(), -2);
    for (const id of created) {
      const tx = db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
      if (tx && tx.date >= recent) {
        await notifyTransaction(id).catch((e) => log("push", `Notification impossible : ${(e as Error).message}`, "error"));
      }
    }
  }
  return created.length;
}
