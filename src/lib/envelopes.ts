import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "./db";
import type { Category } from "./db/schema";
import { addDays, addMonths, monthBounds, today } from "./dates";
import { getSetting } from "./settings";

/**
 * Règles du budget (à partir du mois où le premier budget a été enregistré) :
 * - une enveloppe ne peut jamais être dépassée : une dépense qui ne rentre pas est
 *   « reportée au lendemain » jusqu'à ce qu'elle rentre (déblocage quotidien, nouveau mois)
 *   ou qu'un report depuis une autre enveloppe la couvre ;
 * - les enveloppes "daily" (vêtements/jouets) se débloquent jour après jour ;
 * - ce qui reste à la fin du mois part sur l'enveloppe choisie (vêtements/jouets par défaut),
 *   ou reste sur place pour les provisions (vacances, privé).
 */

export type EnvelopeMonth = {
  categoryId: number;
  alloc: number; // budget du mois
  carryIn: number; // reste du mois précédent reçu
  transferIn: number;
  transferOut: number;
  monthAvailable: number; // alloc + carryIn + transferIn - transferOut
  availableToday: number; // ce qui est débloqué à ce jour (= monthAvailable sauf enveloppes "daily")
  spent: number; // dépenses comptées ce mois (nettes des remboursements)
  deferred: number; // dépenses en attente de report
  remaining: number; // monthAvailable - spent
  remainingToday: number; // ce qu'on peut dépenser aujourd'hui
  dailyRate: number; // déblocage quotidien (enveloppes "daily")
};

export type DeferredItem = {
  splitId: number;
  transactionId: number;
  categoryId: number;
  amount: number; // positif
  date: string; // date de l'opération
  label: string;
  missing: number; // ce qu'il manque aujourd'hui pour la passer
  coveredInDays: number | null; // couverte automatiquement par le déblocage quotidien dans N jours
};

export type Leftover = { categoryId: number; amount: number; targetCategoryId: number; chosen: boolean };

export type EnvelopeState = {
  active: boolean;
  start: string | null; // YYYY-MM
  asOf: string;
  months: Map<string, Map<number, EnvelopeMonth>>;
  deferred: DeferredItem[];
  leftovers: Map<string, Leftover[]>; // par mois qui se termine
  postedOn: Map<number, string>; // splitId → date de prise en compte quand elle diffère de la date de l'opération
  defaultTargetId: number | null;
};

export function rulesStart(): string | null {
  return getSetting<string | null>("rules_start", null);
}

export function budgetCategories(): Category[] {
  return db
    .select()
    .from(schema.categories)
    .where(and(eq(schema.categories.kind, "expense"), eq(schema.categories.archived, false)))
    .orderBy(asc(schema.categories.sortOrder))
    .all();
}

export function categoryByCode(code: string): Category | undefined {
  return db.select().from(schema.categories).where(eq(schema.categories.code, code)).get();
}

function budgetsFor(month: string, cats: Category[]): Map<number, number> {
  const map = new Map(cats.map((c) => [c.id, c.budget]));
  for (const o of db.select().from(schema.budgetOverrides).where(eq(schema.budgetOverrides.month, month)).all()) {
    if (map.has(o.categoryId)) map.set(o.categoryId, o.amount);
  }
  return map;
}

type Item = { splitId: number; transactionId: number; categoryId: number; usage: number; date: string; label: string };

export function computeEnvelopes(asOf = today()): EnvelopeState {
  const start = rulesStart();
  const cats = budgetCategories();
  const defaultTargetId = cats.find((c) => c.code === "vetements")?.id ?? null;
  const state: EnvelopeState = {
    active: Boolean(start),
    start,
    asOf,
    months: new Map(),
    deferred: [],
    leftovers: new Map(),
    postedOn: new Map(),
    defaultTargetId,
  };
  if (!start) return state;
  const firstDay = `${start}-01`;
  const ids = new Set(cats.map((c) => c.id));

  const items: Item[] = db
    .select({
      splitId: schema.splits.id,
      transactionId: schema.transactions.id,
      categoryId: schema.splits.categoryId,
      amount: schema.splits.amount,
      date: schema.transactions.date,
      label: schema.transactions.label,
      merchant: schema.transactions.merchant,
    })
    .from(schema.splits)
    .innerJoin(schema.transactions, eq(schema.transactions.id, schema.splits.transactionId))
    .where(and(gte(schema.transactions.date, firstDay), lte(schema.transactions.date, asOf)))
    .orderBy(asc(schema.transactions.date), asc(schema.splits.id))
    .all()
    .filter((r) => ids.has(r.categoryId))
    .map((r) => ({ ...r, usage: -r.amount, label: r.merchant || r.label }));

  const transfers = db
    .select()
    .from(schema.budgetTransfers)
    .where(and(gte(schema.budgetTransfers.date, firstDay), lte(schema.budgetTransfers.date, asOf)))
    .all();
  const choices = new Map(
    db.select().from(schema.carryovers).all().map((c) => [`${c.month}:${c.categoryId}`, c.targetCategoryId]),
  );

  const queue = new Map<number, Item[]>(cats.map((c) => [c.id, []]));
  let carry = new Map<number, number>();
  const curMonth = asOf.slice(0, 7);

  for (let month = start; month <= curMonth; month = addMonths(month, 1)) {
    const { start: ms, end: me } = monthBounds(month);
    const days = Number(me.slice(8));
    const lastDay = month === curMonth ? asOf : me;
    const lastIdx = Number(lastDay.slice(8));
    const budgets = budgetsFor(month, cats);
    const monthItems = items.filter((i) => i.date >= ms && i.date <= me);
    const monthTransfers = transfers.filter((t) => t.date >= ms && t.date <= me);
    const result = new Map<number, EnvelopeMonth>();
    const nextCarry = new Map<number, number>();
    const leftovers: Leftover[] = [];

    for (const c of cats) {
      const alloc = budgets.get(c.id) ?? 0;
      const carryIn = carry.get(c.id) ?? 0;
      const tin = monthTransfers.filter((t) => t.toCategoryId === c.id);
      const tout = monthTransfers.filter((t) => t.fromCategoryId === c.id);
      const sumUpTo = (list: typeof tin, d: number) =>
        list.filter((t) => Number(t.date.slice(8)) <= d).reduce((a, t) => a + t.amount, 0);
      const accrued = (d: number) => (c.accrual === "daily" ? Math.floor((alloc * d) / days) : alloc);
      // g(d) = disponible le jour d, reports sortants déduits ; une dépense passée le jour D
      // doit tenir sous le minimum de g sur [D, dernier jour] pour ne jamais créer de dépassement plus tard
      const g = Array.from({ length: lastIdx + 1 }, (_, d) => carryIn + accrued(d) + sumUpTo(tin, d) - sumUpTo(tout, d));
      const suffixMin = [...g];
      for (let d = lastIdx - 1; d >= 1; d--) suffixMin[d] = Math.min(suffixMin[d], suffixMin[d + 1]);

      const pending = queue.get(c.id)!;
      const own = monthItems.filter((i) => i.categoryId === c.id);
      let spent = 0;
      for (let d = 1; d <= lastIdx; d++) {
        const date = `${month}-${String(d).padStart(2, "0")}`;
        for (const it of own) {
          if (it.date !== date) continue;
          // Remboursement : redonne de la marge immédiatement
          if (it.usage <= 0) spent += it.usage;
          else pending.push(it);
        }
        for (let k = 0; k < pending.length; ) {
          const it = pending[k];
          if (spent + it.usage <= suffixMin[d]) {
            spent += it.usage;
            if (it.date !== date) state.postedOn.set(it.splitId, date);
            pending.splice(k, 1);
          } else k++;
        }
      }

      const tIn = sumUpTo(tin, lastIdx);
      const tOut = sumUpTo(tout, lastIdx);
      const monthAvailable = alloc + carryIn + tIn - tOut;
      const availableToday = g[lastIdx];
      result.set(c.id, {
        categoryId: c.id,
        alloc,
        carryIn,
        transferIn: tIn,
        transferOut: tOut,
        monthAvailable,
        availableToday,
        spent,
        deferred: pending.reduce((a, i) => a + i.usage, 0),
        remaining: monthAvailable - spent,
        remainingToday: availableToday - spent,
        dailyRate: c.accrual === "daily" ? Math.floor(alloc / days) : 0,
      });

      if (month < curMonth) {
        const left = g[lastIdx] - spent;
        const chosen = choices.get(`${month}:${c.id}`);
        const target = left < 0 ? c.id : (chosen ?? (c.rollover === "self" || !defaultTargetId ? c.id : defaultTargetId));
        if (left !== 0) nextCarry.set(target, (nextCarry.get(target) ?? 0) + left);
        if (left > 0) leftovers.push({ categoryId: c.id, amount: left, targetCategoryId: target, chosen: chosen != null });
      }
    }
    state.months.set(month, result);
    if (month < curMonth) state.leftovers.set(month, leftovers);
    carry = nextCarry;
  }

  const cur = state.months.get(curMonth)!;
  for (const c of cats) {
    const line = cur.get(c.id)!;
    for (const it of queue.get(c.id)!) {
      const missing = Math.max(0, it.usage - Math.max(0, line.remainingToday));
      const { end } = monthBounds(curMonth);
      const daysToEnd = Number(end.slice(8)) - Number(asOf.slice(8));
      const coveredInDays =
        line.dailyRate > 0 && Math.ceil(missing / line.dailyRate) <= daysToEnd ? Math.ceil(missing / line.dailyRate) : null;
      state.deferred.push({
        splitId: it.splitId,
        transactionId: it.transactionId,
        categoryId: c.id,
        amount: it.usage,
        date: it.date,
        label: it.label,
        missing,
        coveredInDays,
      });
    }
  }
  state.deferred.sort((a, b) => a.date.localeCompare(b.date));
  return state;
}

/** Enveloppes dans lesquelles l'utilisateur peut puiser, avec ce qu'elles ont de libre aujourd'hui. */
export function transferSources(state: EnvelopeState, userId: number, exclude?: number) {
  const cur = state.months.get(state.asOf.slice(0, 7));
  if (!cur) return [];
  return budgetCategories()
    .filter((c) => !c.locked && c.id !== exclude && (c.ownerUserId == null || c.ownerUserId === userId))
    .map((c) => ({ category: c, free: Math.max(0, cur.get(c.id)?.remainingToday ?? 0) }))
    .filter((s) => s.free > 0);
}

export const tomorrow = () => addDays(today(), 1);
