"use client";

import { useState, useTransition } from "react";
import type { Category } from "@/lib/db/schema";
import type { TxWithSplits } from "@/lib/queries";
import { formatEUR } from "@/lib/money";
import { deleteTransactionAction, reclassifyAction, saveInstallmentAction, saveSplitsAction } from "@/app/actions";

type Part = { categoryId: number; amount: string };

const toInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

const SOURCES: Record<string, string> = { bank: "Banque", phone: "Téléphone", import: "Import", manual: "Saisie", plan: "Paiement fractionné" };
const BY: Record<string, string> = { rule: "règle apprise", ai: "IA", email: "ticket reçu par mail", user: "vous" };

export function TxEditor({ tx, categories, onClose }: { tx: TxWithSplits; categories: Category[]; onClose: () => void }) {
  const total = Math.abs(tx.amount);
  const [parts, setParts] = useState<Part[]>(
    tx.splits.length
      ? tx.splits.map((s) => ({ categoryId: s.categoryId, amount: toInput(Math.abs(s.amount)) }))
      : [{ categoryId: 0, amount: toInput(total) }],
  );
  const [remember, setRemember] = useState(true);
  const [note, setNote] = useState(tx.note ?? "");
  const [pending, start] = useTransition();
  const [split, setSplit] = useState(Boolean(tx.plan));
  const [count, setCount] = useState(String(tx.plan?.count ?? 4));
  const [planTotal, setPlanTotal] = useState(toInput(tx.plan?.total ?? total * 4));
  const [tripDate, setTripDate] = useState(tx.plan?.tripDate ?? "");
  const cents = (s: string) => Math.round(Number(s.replace(",", ".")) * 100) || 0;
  const sum = parts.reduce((a, p) => a + cents(p.amount), 0);
  const diff = total - sum;
  const multi = parts.length > 1;

  const update = (i: number, patch: Partial<Part>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addPart = () => setParts((ps) => [...ps, { categoryId: 0, amount: toInput(Math.max(0, diff)) }]);

  const isVacances = parts.some((p) => categories.find((c) => c.id === p.categoryId)?.code === "vacances");
  const canSplit = tx.amount < 0 && tx.source !== "plan" && !(tx.installmentPlanId && !tx.plan);

  const save = () =>
    start(async () => {
      const list = multi ? parts : [{ ...parts[0], amount: toInput(total) }];
      await saveSplitsAction(
        tx.id,
        list.map((p) => ({ categoryId: p.categoryId, amount: cents(p.amount) })),
        { remember, note },
      );
      if (canSplit && (split || tx.plan)) {
        const n = Number(count) || 0;
        const planChanged =
          !tx.plan || tx.plan.count !== n || tx.plan.total !== cents(planTotal) || (tx.plan.tripDate ?? "") !== tripDate || tx.plan.assumed;
        if (!split) await saveInstallmentAction(tx.id, null);
        else if (planChanged || tx.splits[0]?.categoryId !== list[0].categoryId)
          await saveInstallmentAction(tx.id, { count: n, total: cents(planTotal), tripDate: isVacances ? tripDate || null : null });
      }
      onClose();
    });

  const grouped = ["expense", "savings", "income", "transfer"].map((k) => ({
    kind: k,
    cats: categories.filter((c) => c.kind === k),
  }));
  const kindLabel: Record<string, string> = { expense: "Dépenses", savings: "Épargne", income: "Revenus", transfer: "Virements" };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{tx.merchant || tx.label}</h2>
            <p className="text-xs text-muted">
              {new Date(`${tx.date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} ·{" "}
              {SOURCES[tx.source] ?? tx.source}
              {tx.accountName && ` · ${tx.accountName}`}
            </p>
            {tx.merchant && tx.merchant !== tx.label && <p className="mt-1 break-all text-xs text-muted">{tx.label}</p>}
          </div>
          <span className={`tnum text-lg font-semibold ${tx.amount > 0 ? "text-ok" : ""}`}>{formatEUR(tx.amount)}</span>
        </div>

        {tx.classifiedBy && tx.classifiedBy !== "user" && (
          <p className="mb-4 rounded-xl bg-surface-2 p-3 text-xs text-muted">
            Classé par {BY[tx.classifiedBy]}
            {tx.aiConfidence != null && tx.classifiedBy === "ai" && ` (confiance ${Math.round(tx.aiConfidence * 100)} %)`}
            {tx.aiReason && ` — ${tx.aiReason}`}
          </p>
        )}
        {tx.emailSubject && <p className="mb-4 text-xs text-muted">🧾 Ticket : {tx.emailSubject}</p>}

        <div className="space-y-2">
          {parts.map((p, i) => (
            <div key={i} className="flex gap-2">
              <select
                className="input flex-1"
                value={p.categoryId}
                onChange={(e) => update(i, { categoryId: Number(e.target.value) })}
              >
                <option value={0}>Choisir une catégorie…</option>
                {grouped.map((g) => (
                  <optgroup key={g.kind} label={kindLabel[g.kind]}>
                    {g.cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {multi && (
                <>
                  <input
                    className="input tnum w-24 text-right"
                    inputMode="decimal"
                    value={p.amount}
                    onChange={(e) => update(i, { amount: e.target.value })}
                  />
                  <button className="px-1 text-muted" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} aria-label="Retirer">
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <button className="text-accent" onClick={addPart}>
            + Répartir sur plusieurs catégories
          </button>
          {multi && diff !== 0 && <span className="text-warn">Reste à répartir : {formatEUR(diff)}</span>}
        </div>

        {canSplit && (
          <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
              Paiement en plusieurs fois
            </label>
            {split && (
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <label className="flex-1">
                    <span className="label">Nombre d&apos;échéances</span>
                    <input className="input tnum" inputMode="numeric" value={count} onChange={(e) => {
                      setCount(e.target.value.replace(/\D/g, ""));
                      if (!tx.plan) setPlanTotal(toInput(total * (Number(e.target.value) || 1)));
                    }} />
                  </label>
                  <label className="flex-1">
                    <span className="label">Prix total €</span>
                    <input className="input tnum" inputMode="decimal" value={planTotal} onChange={(e) => setPlanTotal(e.target.value)} />
                  </label>
                </div>
                {isVacances && (
                  <label className="block">
                    <span className="label">Date du séjour</span>
                    <input className="input" type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
                  </label>
                )}
                <p className="text-xs text-muted">
                  {isVacances && tripDate > tx.date
                    ? "Vacances à venir : chaque échéance compte le mois où elle est payée."
                    : `On ne s'endette pas : les ${formatEUR(cents(planTotal))} comptent en entier ce mois-ci, les échéances suivantes ne seront pas recomptées.`}
                </p>
                {tx.plan?.assumed && <p className="text-xs text-warn">Détecté automatiquement d&apos;après le libellé : vérifiez le nombre d&apos;échéances et le total.</p>}
              </div>
            )}
          </div>
        )}

        <input className="input mt-4" placeholder="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Retenir pour ce commerçant
        </label>

        <div className="mt-5 flex gap-2">
          <button className="btn-primary flex-1" disabled={pending || parts.some((p) => !p.categoryId) || (multi && diff !== 0)} onClick={save}>
            Enregistrer
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="mt-4 flex justify-between text-xs">
          <button className="text-muted underline" disabled={pending} onClick={() => start(async () => { await reclassifyAction(tx.id); onClose(); })}>
            Reclasser avec l&apos;IA
          </button>
          {tx.source !== "bank" && (
            <button
              className="text-danger underline"
              disabled={pending}
              onClick={() => confirm("Supprimer cette opération ?") && start(async () => { await deleteTransactionAction(tx.id); onClose(); })}
            >
              Supprimer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
