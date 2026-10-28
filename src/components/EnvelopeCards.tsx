"use client";

import { useState, useTransition } from "react";
import { formatEUR } from "@/lib/money";
import { formatDate, monthLabel } from "@/lib/dates";
import { setCarryoverAction, transferAction } from "@/app/actions";

type Cat = { id: number; name: string; icon: string };

export type OverrunRow = {
  splitId: number;
  transactionId: number;
  categoryId: number;
  label: string;
  date: string;
  amount: number;
  missing: number;
  coveredInDays: number | null;
};

/** Dépenses qui dépassent leur budget : reportées au lendemain tant qu'on n'a pas choisi sur quoi reporter. */
export function OverrunCard({
  rows,
  categories,
  sources,
}: {
  rows: OverrunRow[];
  categories: Cat[];
  sources: { id: number; free: number }[];
}) {
  const cat = new Map(categories.map((c) => [c.id, c]));
  return (
    <section id="depassements" className="card scroll-mt-20 space-y-3 border-danger bg-danger-soft/40">
      <div>
        <h2 className="font-semibold text-danger">⛔ Dépassement : choisissez sur quoi reporter</h2>
        <p className="text-xs text-muted">
          On ne dépasse pas un budget. Tant que le report n&apos;est pas fait, la dépense est repoussée au lendemain. Alimentaire,
          pharmacie/médecin et impôts ne peuvent pas servir de source.
        </p>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <OverrunLine key={r.splitId} row={r} cat={cat} sources={sources.filter((s) => s.id !== r.categoryId)} />
        ))}
      </ul>
    </section>
  );
}

function OverrunLine({ row, cat, sources }: { row: OverrunRow; cat: Map<number, Cat>; sources: { id: number; free: number }[] }) {
  const [from, setFrom] = useState(sources[0]?.id ?? 0);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const c = cat.get(row.categoryId);
  const src = sources.find((s) => s.id === from);
  const take = src ? Math.min(src.free, row.missing) : 0;
  return (
    <li className="rounded-xl bg-surface p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{row.label}</span>
        <span className="tnum shrink-0 font-semibold">{formatEUR(row.amount)}</span>
      </div>
      <p className="text-xs text-muted">
        {formatDate(row.date)} · {c?.icon} {c?.name} · il manque <strong className="text-danger">{formatEUR(row.missing)}</strong>
        {row.coveredInDays != null && ` · passera seule dans ${row.coveredInDays} j avec le déblocage quotidien`}
      </p>
      {sources.length ? (
        <div className="mt-2 flex gap-2">
          <select className="input flex-1 py-1.5" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {sources.map((s) => {
              const sc = cat.get(s.id);
              return (
                <option key={s.id} value={s.id}>
                  {sc?.icon} {sc?.name} — libre {formatEUR(s.free)}
                </option>
              );
            })}
          </select>
          <button
            className="btn-primary shrink-0 px-3 py-1.5"
            disabled={pending || !take}
            onClick={() =>
              start(async () => {
                const res = await transferAction(from, row.categoryId, take);
                setMsg(res?.error ?? null);
              })
            }
          >
            Reporter {formatEUR(take)}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-danger">Aucun budget autorisé n&apos;a de marge aujourd&apos;hui : la dépense attend demain.</p>
      )}
      {take > 0 && take < row.missing && <p className="mt-1 text-xs text-warn">Report partiel : il faudra compléter depuis un autre budget.</p>}
      {msg && <p className="mt-1 text-xs text-danger">{msg}</p>}
    </li>
  );
}

/** Le reste non dépensé du mois précédent : par défaut sur vêtements/jouets, ou au choix. */
export function CarryoverCard({
  month,
  rows,
  categories,
}: {
  month: string;
  rows: { categoryId: number; amount: number; targetCategoryId: number }[];
  categories: Cat[];
}) {
  const [pending, start] = useTransition();
  const cat = new Map(categories.map((c) => [c.id, c]));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm">
        <strong>{formatEUR(total)}</strong> non dépensés en {monthLabel(month)} — reportés ce mois-ci
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {rows.map((r) => {
          const c = cat.get(r.categoryId);
          return (
            <li key={r.categoryId} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {c?.icon} {c?.name} <span className="tnum text-muted">{formatEUR(r.amount)}</span>
              </span>
              <span className="text-muted">→</span>
              <select
                className="input w-auto py-1"
                disabled={pending}
                value={r.targetCategoryId}
                onChange={(e) => start(() => setCarryoverAction(month, r.categoryId, Number(e.target.value)))}
              >
                {categories.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icon} {t.name}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
