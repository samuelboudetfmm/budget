import { and, desc, eq, gte, inArray, like, lte, notInArray, or, type SQL } from "drizzle-orm";
import { db, schema } from "./db";
import type { InstallmentPlan, Transaction } from "./db/schema";
import { monthBounds } from "./dates";

export type TxWithSplits = Transaction & {
  splits: { categoryId: number; amount: number }[];
  emailSubject: string | null;
  accountName: string | null;
  plan: InstallmentPlan | null;
};

export function listTransactions(opts: {
  month?: string;
  categoryId?: number;
  unclassified?: boolean;
  search?: string;
  ids?: number[];
  limit?: number;
}): TxWithSplits[] {
  const where: SQL[] = [];
  if (opts.ids) where.push(inArray(schema.transactions.id, opts.ids.length ? opts.ids : [-1]));
  if (opts.month) {
    const { start, end } = monthBounds(opts.month);
    where.push(gte(schema.transactions.date, start), lte(schema.transactions.date, end));
  }
  if (opts.search) {
    const q = `%${opts.search}%`;
    where.push(or(like(schema.transactions.label, q), like(schema.transactions.merchant, q))!);
  }
  const withSplits = db.select({ id: schema.splits.transactionId }).from(schema.splits);
  if (opts.unclassified) where.push(notInArray(schema.transactions.id, withSplits));
  if (opts.categoryId) {
    const inCat = db
      .select({ id: schema.splits.transactionId })
      .from(schema.splits)
      .where(eq(schema.splits.categoryId, opts.categoryId));
    where.push(inArray(schema.transactions.id, inCat));
  }
  const rows = db
    .select({ tx: schema.transactions, emailSubject: schema.emails.subject, accountName: schema.accounts.name })
    .from(schema.transactions)
    .leftJoin(schema.emails, eq(schema.emails.id, schema.transactions.emailId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.id))
    .limit(opts.limit ?? 500)
    .all();
  const ids = rows.map((r) => r.tx.id);
  const splits = ids.length
    ? db.select().from(schema.splits).where(inArray(schema.splits.transactionId, ids)).all()
    : [];
  const byTx = new Map<number, { categoryId: number; amount: number }[]>();
  for (const s of splits) {
    const list = byTx.get(s.transactionId) ?? [];
    list.push({ categoryId: s.categoryId, amount: s.amount });
    byTx.set(s.transactionId, list);
  }
  const plans = ids.length
    ? db.select().from(schema.installmentPlans).where(inArray(schema.installmentPlans.firstTransactionId, ids)).all()
    : [];
  const planByTx = new Map(plans.map((p) => [p.firstTransactionId, p]));
  return rows.map((r) => ({
    ...r.tx,
    emailSubject: r.emailSubject,
    accountName: r.accountName,
    splits: byTx.get(r.tx.id) ?? [],
    plan: planByTx.get(r.tx.id) ?? null,
  }));
}
