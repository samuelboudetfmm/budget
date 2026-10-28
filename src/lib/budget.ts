import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { Category } from "./db/schema";
import { activeCategories } from "./classify";
import { addMonths, currentMonth, monthBounds, today } from "./dates";
import { computeEnvelopes, type EnvelopeMonth, type EnvelopeState } from "./envelopes";

export type CategoryLine = Category & {
  budgetAmount: number;
  spent: number;
  remaining: number;
  // Présent quand les règles d'enveloppes s'appliquent à ce mois
  envelope?: EnvelopeMonth;
};

export type MonthSummary = {
  month: string;
  lines: CategoryLine[];
  totalBudget: number;
  totalSpent: number; // dépenses (catégories "expense" + non classées), positif
  unclassifiedSpent: number;
  unclassifiedCount: number;
  income: number;
  savings: number;
  remaining: number;
  daysLeft: number;
  envelopes: EnvelopeState;
  deferredTotal: number;
};

/** Totaux par catégorie (signés) pour une plage de dates. */
function totalsByCategory(start: string, end: string): Map<number, number> {
  const rows = db
    .select({ categoryId: schema.splits.categoryId, total: sql<number>`sum(${schema.splits.amount})` })
    .from(schema.splits)
    .innerJoin(schema.transactions, eq(schema.transactions.id, schema.splits.transactionId))
    .where(and(gte(schema.transactions.date, start), lte(schema.transactions.date, end)))
    .groupBy(schema.splits.categoryId)
    .all();
  return new Map(rows.map((r) => [r.categoryId, Number(r.total)]));
}

function unclassified(start: string, end: string) {
  const withSplits = db.select({ id: schema.splits.transactionId }).from(schema.splits);
  const row = db
    .select({ total: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)`, n: sql<number>`count(*)` })
    .from(schema.transactions)
    .where(
      and(
        gte(schema.transactions.date, start),
        lte(schema.transactions.date, end),
        notInArray(schema.transactions.id, withSplits),
        sql`${schema.transactions.amount} < 0`,
      ),
    )
    .get();
  return { spent: -Number(row?.total ?? 0), count: Number(row?.n ?? 0) };
}

export function budgetsForMonth(month: string, cats: Category[]): Map<number, number> {
  const overrides = db.select().from(schema.budgetOverrides).where(eq(schema.budgetOverrides.month, month)).all();
  const map = new Map(cats.map((c) => [c.id, c.budget]));
  for (const o of overrides) map.set(o.categoryId, o.amount);
  return map;
}

export function monthSummary(month = currentMonth(), envelopes = computeEnvelopes()): MonthSummary {
  const cats = activeCategories();
  const { start, end } = monthBounds(month);
  const totals = totalsByCategory(start, end);
  const budgets = budgetsForMonth(month, cats);
  const envMonth = envelopes.months.get(month);
  const lines: CategoryLine[] = cats.map((c) => {
    const env = envMonth?.get(c.id);
    // Enveloppe : ne compte que les dépenses passées (celles en attente de report sont à part)
    if (env) return { ...c, budgetAmount: env.monthAvailable, spent: env.spent, remaining: env.remaining, envelope: env };
    const signed = totals.get(c.id) ?? 0;
    const spent = c.kind === "income" ? signed : -signed;
    const budgetAmount = budgets.get(c.id) ?? 0;
    return { ...c, budgetAmount, spent, remaining: budgetAmount - spent };
  });
  const expense = lines.filter((l) => l.kind === "expense");
  const unc = unclassified(start, end);
  const totalBudget = expense.reduce((a, l) => a + l.budgetAmount, 0);
  const totalSpent = expense.reduce((a, l) => a + l.spent, 0) + unc.spent;
  const t = today();
  const daysLeft = month === t.slice(0, 7) ? Number(end.slice(8)) - Number(t.slice(8)) + 1 : 0;
  return {
    month,
    lines,
    totalBudget,
    totalSpent,
    unclassifiedSpent: unc.spent,
    unclassifiedCount: unc.count,
    income: lines.filter((l) => l.kind === "income").reduce((a, l) => a + l.spent, 0),
    savings: lines.filter((l) => l.kind === "savings").reduce((a, l) => a + l.spent, 0),
    remaining: totalBudget - totalSpent,
    daysLeft,
    envelopes,
    deferredTotal: expense.reduce((a, l) => a + (l.envelope?.deferred ?? 0), 0),
  };
}

export type HistoryRow = {
  category: Category;
  perMonth: number[]; // positif = dépense (ou revenu pour la catégorie revenus)
  average: number;
  median: number;
};

/** Historique des N derniers mois complets (couverts par les données), par catégorie. */
export function history(monthsBack = 6): { months: string[]; rows: HistoryRow[]; unclassified: number[] } {
  const cats = activeCategories();
  const cur = currentMonth();
  // On ignore les mois antérieurs au début de l'historique (sinon ils comptent pour 0 € dans la médiane)
  const first = db.select({ d: sql<string | null>`min(${schema.transactions.date})` }).from(schema.transactions).get()?.d;
  const firstMonth = first ? first.slice(0, 7) : cur;
  const months = Array.from({ length: monthsBack }, (_, i) => addMonths(cur, i - monthsBack)).filter((m) => m >= firstMonth);
  const perMonthTotals = months.map((m) => {
    const { start, end } = monthBounds(m);
    return { totals: totalsByCategory(start, end), unc: unclassified(start, end).spent };
  });
  const rows = cats.map((category) => {
    const perMonth = perMonthTotals.map(({ totals }) => {
      const v = totals.get(category.id) ?? 0;
      return category.kind === "income" ? v : -v;
    });
    const sorted = [...perMonth].sort((a, b) => a - b);
    const median = sorted.length
      ? sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : 0;
    const average = Math.round(perMonth.reduce((a, b) => a + b, 0) / Math.max(1, perMonth.length));
    return { category, perMonth, average, median };
  });
  return { months, rows, unclassified: perMonthTotals.map((p) => p.unc) };
}

/** Ligne de budget d'une catégorie pour le mois en cours (utilisée par les notifications). */
export function categoryStatus(categoryId: number, month = currentMonth(), envelopes?: EnvelopeState) {
  const summary = monthSummary(month, envelopes);
  return { line: summary.lines.find((l) => l.id === categoryId), summary };
}
