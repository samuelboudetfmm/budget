import Link from "next/link";
import { count } from "drizzle-orm";
import { monthSummary } from "@/lib/budget";
import { activeCategories } from "@/lib/classify";
import { addMonths, currentMonth } from "@/lib/dates";
import { requireUser } from "@/lib/auth";
import { budgetCategories, computeEnvelopes, transferSources } from "@/lib/envelopes";
import { countUncertain } from "@/lib/uncertain";
import type { CategoryLine } from "@/lib/budget";
import { db, schema } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import { listTransactions } from "@/lib/queries";
import { Meter } from "@/components/Meter";
import { MonthNav } from "@/components/MonthNav";
import { TxList } from "@/components/TxList";
import { PushPrompt } from "@/components/PushToggle";
import { CarryoverCard, OverrunCard } from "@/components/EnvelopeCards";

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const month = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : currentMonth();
  const user = await requireUser();
  const envelopes = computeEnvelopes();
  const s = monthSummary(month, envelopes);
  const isCurrent = month === currentMonth();
  const budgetCats = budgetCategories().map((c) => ({ id: c.id, name: c.name, icon: c.icon }));
  const sources = transferSources(envelopes, user.id).map((x) => ({ id: x.category.id, free: x.free }));
  const prev = addMonths(currentMonth(), -1);
  const leftovers = envelopes.leftovers.get(prev) ?? [];
  const uncertain = countUncertain();
  const txCount = db.select({ n: count() }).from(schema.transactions).get()?.n ?? 0;
  const recent = listTransactions({ month, limit: 8 });
  const categories = activeCategories();
  const expense = s.lines.filter(
    (l) => l.kind === "expense" && (l.budgetAmount > 0 || l.spent > 0 || (l.envelope?.deferred ?? 0) > 0),
  );
  // Regroupement à l'affichage (Factures mensuelles, Vacances/sorties/privé), dans l'ordre des enveloppes
  const groups: { name: string | null; lines: CategoryLine[] }[] = [];
  for (const l of expense) {
    const last = groups[groups.length - 1];
    if (last && last.name === l.groupName && l.groupName) last.lines.push(l);
    else groups.push({ name: l.groupName, lines: [l] });
  }
  const perDay = s.daysLeft > 0 ? Math.max(0, s.remaining) / s.daysLeft : 0;
  const over = s.remaining < 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ce mois-ci</h1>
        <MonthNav month={month} base="/" />
      </div>

      <PushPrompt />

      {isCurrent && envelopes.deferred.length > 0 && (
        <OverrunCard rows={envelopes.deferred} categories={budgetCats} sources={sources} />
      )}

      {isCurrent && leftovers.length > 0 && <CarryoverCard month={prev} rows={leftovers} categories={budgetCats} />}

      {txCount === 0 && (
        <div className="card border-accent bg-accent-soft/40">
          <h2 className="font-semibold">Pour commencer</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>
              <Link className="text-accent underline" href="/import">Importez l&apos;historique</Link> (CSV/OFX des derniers mois) ou{" "}
              <Link className="text-accent underline" href="/settings#banque">connectez votre banque</Link>.
            </li>
            <li>Vérifiez le classement proposé par l&apos;IA.</li>
            <li>
              <Link className="text-accent underline" href="/budget">Construisez le budget</Link> avec l&apos;assistant à partir de vos objectifs.
            </li>
            <li>
              <Link className="text-accent underline" href="/settings#telephone">Reliez vos téléphones</Link> pour être notifié à chaque paiement.
            </li>
          </ol>
        </div>
      )}

      <section className="card">
        {s.totalBudget > 0 ? (
          <>
            <p className="text-sm text-muted">{over ? "Budget dépassé de" : "Reste à dépenser"}</p>
            <p className={`tnum text-4xl font-bold tracking-tight ${over ? "text-danger" : ""}`}>
              {formatEUR(Math.abs(s.remaining))}
            </p>
            <p className="mt-1 text-sm text-muted">
              {formatEUR(s.totalSpent)} dépensés sur {formatEUR(s.totalBudget)}
              {s.daysLeft > 0 && !over && ` · ${formatEUR(perDay)} / jour pendant ${s.daysLeft} j`}
            </p>
            <div className="mt-3">
              <Meter spent={s.totalSpent} budget={s.totalBudget} />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Dépensé ce mois</p>
            <p className="tnum text-4xl font-bold tracking-tight">{formatEUR(s.totalSpent)}</p>
            <Link href="/budget" className="mt-3 inline-block text-sm text-accent underline">
              Définir un budget →
            </Link>
          </>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-xs text-muted">Revenus</p>
            <p className="tnum font-semibold text-ok">{formatEUR(s.income)}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-xs text-muted">Épargne</p>
            <p className="tnum font-semibold">{formatEUR(s.savings)}</p>
          </div>
        </div>
      </section>

      {uncertain > 0 && (
        <Link href="/verifier" className="card flex items-center justify-between border-warn">
          <span className="text-sm">
            <strong>{uncertain}</strong> supposition(s) à vérifier (catégories devinées, paiements fractionnés, prix…)
          </span>
          <span className="text-warn">→</span>
        </Link>
      )}

      {s.unclassifiedCount > 0 && (
        <Link href={`/transactions?m=${month}&f=unclassified`} className="card flex items-center justify-between border-warn">
          <span className="text-sm">
            <strong>{s.unclassifiedCount}</strong> opération(s) à classer ({formatEUR(s.unclassifiedSpent)})
          </span>
          <span className="text-warn">→</span>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold">Par catégorie</h2>
          {expense.length === 0 && <p className="text-sm text-muted">Rien pour l&apos;instant.</p>}
          <div className="space-y-4">
            {groups.map((g, gi) => (
              <div key={gi}>
                {g.name && (
                  <p className="mb-2 flex justify-between text-xs font-medium uppercase tracking-wide text-muted">
                    <span>{g.name}</span>
                    <span className="tnum normal-case">
                      {formatEUR(g.lines.reduce((a, l) => a + l.spent, 0))} / {formatEUR(g.lines.reduce((a, l) => a + l.budgetAmount, 0))}
                    </span>
                  </p>
                )}
                <ul className={`space-y-3 ${g.name ? "border-l-2 border-border pl-3" : ""}`}>
                  {g.lines.map((l) => (
                    <CategoryRow key={l.id} line={l} month={month} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Dernières opérations</h2>
            <Link href={`/transactions?m=${month}`} className="text-sm text-accent">
              Tout voir
            </Link>
          </div>
          <TxList transactions={recent} categories={categories} />
        </section>
      </div>
    </div>
  );
}

function CategoryRow({ line: l, month }: { line: CategoryLine; month: string }) {
  const env = l.envelope;
  const notes: string[] = [];
  if (env?.dailyRate && env.remainingToday !== env.remaining) {
    notes.push(`${formatEUR(Math.max(0, env.remainingToday))} dispo aujourd'hui · +${formatEUR(env.dailyRate)}/jour`);
  }
  if (env?.carryIn) notes.push(`dont ${formatEUR(env.carryIn)} du mois dernier`);
  if (env?.sales) notes.push(`+${formatEUR(env.sales)} de ventes`);
  if (env && env.transferIn - env.transferOut !== 0) {
    const net = env.transferIn - env.transferOut;
    notes.push(`${net > 0 ? "+" : "−"}${formatEUR(Math.abs(net))} de reports`);
  }
  if (env?.deferred) notes.push(`${formatEUR(env.deferred)} en attente de report`);
  return (
    <li>
      <Link href={`/transactions?m=${month}&c=${l.id}`} className="block">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
          <span className="truncate">
            {l.icon} {l.name}
            {l.locked && <span className="ml-1 text-xs" title="On ne peut pas y puiser pour un report">🔒</span>}
          </span>
          <span className="tnum shrink-0 text-xs text-muted">
            <span className={(l.remaining < 0 || env?.deferred) && l.budgetAmount > 0 ? "font-semibold text-danger" : "font-medium text-text"}>
              {formatEUR(l.spent)}
            </span>
            {l.budgetAmount > 0 && ` / ${formatEUR(l.budgetAmount)}`}
          </span>
        </div>
        <Meter spent={l.spent + (env?.deferred ?? 0)} budget={l.budgetAmount} color={l.color} />
        {notes.length > 0 && <p className={`mt-1 text-xs ${env?.deferred ? "text-danger" : "text-muted"}`}>{notes.join(" · ")}</p>}
      </Link>
    </li>
  );
}
