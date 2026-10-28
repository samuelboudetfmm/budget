"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { formatEUR } from "@/lib/money";
import { addProvisionAction, saveBudgetsAction, saveGoalsAction } from "@/app/actions";

export type BudgetRow = {
  id: number;
  name: string;
  icon: string;
  kind: string;
  group: string | null;
  locked: boolean;
  daily: boolean;
  accumulates: boolean;
  perMonth: number[];
  median: number;
  average: number;
  defaultBudget: number;
  monthBudget: number;
  spent: number;
};

type Proposal = {
  summary: string;
  categories: { categoryId: number; amount: number; rationale: string }[];
  tips: string[];
};

const short = (m: string) =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(new Date(`${m}-01T12:00:00Z`));

export function BudgetEditor({
  rows,
  months,
  monthsBack,
  unclassified,
  goals: initialGoals,
  daysLeft,
  rulesActive,
}: {
  rows: BudgetRow[];
  months: string[];
  monthsBack: number;
  unclassified: number[];
  goals: string;
  daysLeft: number;
  rulesActive: boolean;
}) {
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, String(Math.round(r.monthBudget / 100))])),
  );
  const [goals, setGoals] = useState(initialGoals);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"initial" | "adjust" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const budgeted = rows.filter((r) => r.kind === "expense" || r.kind === "savings");
  const income = rows.filter((r) => r.kind === "income");
  // Une enveloppe ajoutée après l'ouverture de la page (budget privé) garde son budget enregistré
  const valueOf = (r: BudgetRow) => values[r.id] ?? String(Math.round(r.monthBudget / 100));
  const total = (kind: string) => budgeted.filter((r) => r.kind === kind).reduce((a, r) => a + (Number(valueOf(r)) || 0), 0);
  const incomeMedian = income.reduce((a, r) => a + r.median, 0) / 100;
  const hasHistory = rows.some((r) => r.perMonth.some((v) => v !== 0));

  const ask = async (mode: "initial" | "adjust") => {
    setLoading(mode);
    setAiError(null);
    setProposal(null);
    try {
      await saveGoalsAction(goals);
      const res = await fetch("/api/ai/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, monthsBack }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProposal(data);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const applyProposal = () => {
    if (!proposal) return;
    setValues((v) => {
      const next = { ...v };
      for (const p of proposal.categories) next[p.categoryId] = String(Math.round(p.amount));
      return next;
    });
  };

  const save = (scope: "default" | "month") =>
    start(async () => {
      await saveBudgetsAction(
        budgeted.map((r) => ({ categoryId: r.id, amount: Number(valueOf(r)) || 0 })),
        scope,
      );
      setSaved(scope === "default" ? "Budget enregistré pour tous les mois." : "Budget modifié pour ce mois uniquement.");
      setTimeout(() => setSaved(null), 4000);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Budget</h1>
        <div className="flex gap-1 text-sm">
          {[3, 6, 12].map((n) => (
            <Link key={n} href={`/budget?n=${n}`} className={`rounded-full px-3 py-1 ${n === monthsBack ? "bg-accent-soft text-accent" : "bg-surface-2"}`}>
              {n} mois
            </Link>
          ))}
        </div>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">Vos objectifs</h2>
        <textarea
          className="input min-h-24"
          placeholder="Ex : épargner 400 €/mois pour les vacances d'été, réduire les restaurants, garder 150 € de marge pour les imprévus…"
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => ask("initial")} disabled={!!loading || !hasHistory}>
            {loading === "initial" ? "Analyse en cours…" : "✨ Proposer un budget"}
          </button>
          <button className="btn-ghost" onClick={() => ask("adjust")} disabled={!!loading}>
            {loading === "adjust" ? "Analyse en cours…" : `Ajuster ce mois (${daysLeft} j restants)`}
          </button>
        </div>
        {!hasHistory && <p className="text-xs text-muted">Importez d&apos;abord l&apos;historique pour que l&apos;IA puisse s&apos;appuyer dessus.</p>}
        {aiError && <p className="text-sm text-danger">{aiError}</p>}
        {proposal && (
          <div className="space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
            <p className="whitespace-pre-line">{proposal.summary}</p>
            {proposal.categories.length > 0 && (
              <ul className="space-y-1">
                {proposal.categories.map((p) => {
                  const r = rows.find((x) => x.id === p.categoryId);
                  if (!r) return null;
                  return (
                    <li key={p.categoryId} className="flex justify-between gap-3">
                      <span>
                        {r.icon} {r.name} <span className="text-muted">— {p.rationale}</span>
                      </span>
                      <span className="tnum shrink-0 font-medium">{Math.round(p.amount)} €</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {proposal.tips?.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {proposal.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
            {proposal.categories.length > 0 && (
              <button className="btn-primary" onClick={applyProposal}>
                Reporter dans le tableau
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-2 font-medium">Catégorie</th>
              {months.map((m) => (
                <th key={m} className="hidden py-2 text-right font-medium capitalize md:table-cell">{short(m)}</th>
              ))}
              <th className="py-2 text-right font-medium">Médiane</th>
              <th className="py-2 text-right font-medium">Ce mois</th>
              <th className="w-24 py-2 text-right font-medium">Budget €</th>
            </tr>
          </thead>
          <tbody className="tnum divide-y divide-border">
            {[...budgeted, ...income].map((r, idx, all) => {
              const budget = (Number(valueOf(r)) || 0) * 100;
              const editable = r.kind !== "income";
              const groupStart = r.group && all[idx - 1]?.group !== r.group;
              return (
                <Row key={r.id} groupStart={groupStart ? r.group : null} cols={months.length + 4}>
                  <td className={`py-1.5 pr-2 ${r.group ? "pl-3" : ""}`}>
                    {r.icon} {r.name}
                    {r.locked && <span className="ml-1 text-xs" title="On ne peut pas y puiser pour couvrir un dépassement">🔒</span>}
                    {r.daily && <span className="ml-1 rounded bg-surface-2 px-1 text-[10px] text-muted">au jour</span>}
                    {r.accumulates && <span className="ml-1 rounded bg-surface-2 px-1 text-[10px] text-muted">cumul</span>}
                  </td>
                  {r.perMonth.map((v, i) => (
                    <td key={i} className="hidden py-1.5 text-right text-muted md:table-cell">{v ? Math.round(v / 100) : "–"}</td>
                  ))}
                  <td className="py-1.5 text-right font-medium">{Math.round(r.median / 100)}</td>
                  <td className={`py-1.5 text-right ${editable && budget && r.spent > budget ? "text-danger" : ""}`}>{Math.round(r.spent / 100)}</td>
                  <td className="py-1 pl-2 text-right">
                    {editable ? (
                      <input
                        className="input tnum w-20 py-1 text-right"
                        inputMode="numeric"
                        value={valueOf(r)}
                        onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value.replace(/[^\d]/g, "") }))}
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </Row>
              );
            })}
            <tr className="text-muted">
              <td className="py-1.5">❔ Non classé</td>
              {unclassified.map((v, i) => (
                <td key={i} className="hidden py-1.5 text-right md:table-cell">{v ? Math.round(v / 100) : "–"}</td>
              ))}
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </section>

      <ProvisionForm />

      <section className="card space-y-1 text-xs text-muted">
        <p className="font-medium text-text">Règles {rulesActive ? "appliquées" : "appliquées dès le premier enregistrement"}</p>
        <p>On ne dépasse jamais un budget : une dépense qui ne rentre pas attend le lendemain, jusqu&apos;à ce que vous choisissiez sur quoi la reporter (jamais sur 🔒 alimentaire, pharmacie/médecin ou impôts).</p>
        <p>« au jour » : le budget se débloque jour après jour. « cumul » : ce qui n&apos;est pas dépensé reste sur place (vacances, budgets privés). Pour les autres, le reste du mois part par défaut sur Libre.</p>
        <p>Paiement en plusieurs fois : le total compte le mois de l&apos;achat, sauf des vacances encore à venir qu&apos;on peut payer par parties.</p>
      </section>

      <section className="card sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] space-y-2 p-3 shadow-lg sm:bottom-4">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted">Dépenses</p>
            <p className="tnum font-semibold">{formatEUR(total("expense") * 100)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Épargne</p>
            <p className="tnum font-semibold">{formatEUR(total("savings") * 100)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Revenus habituels</p>
            <p className={`tnum font-semibold ${incomeMedian && total("expense") + total("savings") > incomeMedian ? "text-danger" : "text-ok"}`}>
              {formatEUR(incomeMedian * 100)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary flex-1 px-3 py-2" disabled={pending} onClick={() => save("default")}>
            Enregistrer
          </button>
          <button className="btn-ghost px-3 py-2" disabled={pending} onClick={() => save("month")}>
            Ce mois seulement
          </button>
        </div>
        {saved && <p className="text-sm text-ok">{saved}</p>}
      </section>
    </div>
  );
}

function Row({ groupStart, cols, children }: { groupStart: string | null; cols: number; children: React.ReactNode }) {
  return (
    <>
      {groupStart && (
        <tr>
          <td colSpan={cols} className="pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted">
            {groupStart}
          </td>
        </tr>
      )}
      <tr>{children}</tr>
    </>
  );
}

/** Chacun a son budget privé, dépensé sur son compte perso : ici on ne suit que le virement qui l'alimente. */
function ProvisionForm() {
  const [state, action, pending] = useActionState(addProvisionAction, undefined);
  return (
    <form action={action} className="card space-y-2">
      <h2 className="font-semibold">👤 Ajouter mon budget privé</h2>
      <p className="text-xs text-muted">
        Le montant viré chaque mois du compte commun vers votre compte perso. Vos dépenses sur le compte perso
        n&apos;apparaissent pas ici : seul le virement compte dans ce budget.
      </p>
      <div className="flex gap-2">
        <input className="input tnum flex-1" name="amount" inputMode="decimal" placeholder="€ / mois" required />
        <button className="btn-primary shrink-0" disabled={pending}>Ajouter</button>
      </div>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-ok">{state.ok}</p>}
    </form>
  );
}
