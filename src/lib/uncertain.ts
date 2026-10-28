import { and, eq, gte, isNull, ne, notInArray, or } from "drizzle-orm";
import { db, schema } from "./db";
import { addDays, today } from "./dates";
import { merchantKey } from "./classify";
import { listTransactions, type TxWithSplits } from "./queries";
import type { InstallmentPlan } from "./db/schema";

export const LOW_CONFIDENCE = 0.75;

export type Uncertain = {
  tx: TxWithSplits;
  kind: "unclassified" | "ai" | "multi" | "installment";
  text: string;
  plan?: InstallmentPlan;
};

/** Dépenses pour lesquelles une hypothèse a été faite (catégorie devinée, ticket absent, paiement fractionné supposé). */
export function uncertainTransactions(): Uncertain[] {
  const since = addDays(today(), -90);
  const withSplits = db.select({ id: schema.splits.transactionId }).from(schema.splits);
  const multiKeys = new Set(
    db.select().from(schema.merchantRules).where(eq(schema.merchantRules.multi, true)).all().map((r) => r.merchantKey),
  );
  const rows = db
    .select()
    .from(schema.transactions)
    .where(
      and(
        gte(schema.transactions.date, since),
        or(isNull(schema.transactions.classifiedBy), ne(schema.transactions.classifiedBy, "user")),
        or(notInArray(schema.transactions.id, withSplits), eq(schema.transactions.classifiedBy, "ai")),
      ),
    )
    .all();
  const plans = db.select().from(schema.installmentPlans).where(eq(schema.installmentPlans.assumed, true)).all();
  const planByTx = new Map(plans.map((p) => [p.firstTransactionId, p]));
  const ids = new Set(rows.map((r) => r.id));
  for (const p of plans) ids.add(p.firstTransactionId);
  const txs = listTransactions({ ids: [...ids], limit: 1000 });
  const out: Uncertain[] = [];
  for (const tx of txs) {
    const plan = planByTx.get(tx.id);
    if (plan) {
      out.push({
        tx,
        plan,
        kind: "installment",
        text: `Supposé : achat payé en ${plan.count} fois, total ${(plan.total / 100).toFixed(2).replace(".", ",")} € compté en entier ce mois-ci.`,
      });
      continue;
    }
    if (tx.classifiedBy === "user" || tx.source === "plan") continue;
    if (!tx.splits.length) {
      if (tx.amount < 0) out.push({ tx, kind: "unclassified", text: "Pas encore classée : elle ne compte dans aucun budget." });
    } else if (tx.classifiedBy === "ai" && multiKeys.has(merchantKey(tx.label))) {
      out.push({ tx, kind: "multi", text: `Commerçant multi-rayons sans ticket — ${tx.aiReason ?? "catégorie supposée"}` });
    } else if (tx.classifiedBy === "ai" && (tx.aiConfidence ?? 0) < LOW_CONFIDENCE) {
      out.push({ tx, kind: "ai", text: tx.aiReason ?? "Catégorie supposée par l'IA" });
    }
  }
  return out.sort((a, b) => b.tx.date.localeCompare(a.tx.date));
}

/** Liens de la wishlist dont le prix ou la livraison n'ont pas pu être lus. */
export function uncertainWishlist() {
  return db
    .select({ link: schema.wishlistLinks, item: schema.wishlistItems })
    .from(schema.wishlistLinks)
    .innerJoin(schema.wishlistItems, eq(schema.wishlistItems.id, schema.wishlistLinks.itemId))
    .where(
      and(
        eq(schema.wishlistItems.status, "wanted"),
        or(isNull(schema.wishlistLinks.shipping), isNull(schema.wishlistLinks.price), eq(schema.wishlistLinks.status, "error")),
        ne(schema.wishlistLinks.status, "pending"),
      ),
    )
    .all();
}

export function countUncertain(): number {
  return uncertainTransactions().length + uncertainWishlist().length;
}
