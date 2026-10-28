"use client";

import { useState, useTransition } from "react";
import type { Category } from "@/lib/db/schema";
import type { TxWithSplits } from "@/lib/queries";
import { formatEUR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { confirmGuessAction } from "@/app/actions";
import { TxEditor } from "./TxEditor";

export type UncertainRow = { tx: TxWithSplits; kind: string; text: string };

const KIND: Record<string, string> = {
  unclassified: "Non classée",
  ai: "Catégorie supposée",
  multi: "Sans ticket",
  installment: "Paiement fractionné supposé",
};

export function UncertainList({ rows, categories }: { rows: UncertainRow[]; categories: Category[] }) {
  const [editing, setEditing] = useState<TxWithSplits | null>(null);
  const [pending, start] = useTransition();
  const cat = new Map(categories.map((c) => [c.id, c]));
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">Aucune supposition en attente 🎉</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map(({ tx, kind, text }) => {
          const main = [...tx.splits].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
          const c = main ? cat.get(main.categoryId) : undefined;
          return (
            <li key={`${kind}-${tx.id}`} className="py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{tx.merchant || tx.label}</span>
                <span className="tnum shrink-0 text-sm font-semibold">{formatEUR(tx.amount)}</span>
              </div>
              <p className="text-xs text-muted">
                {formatDate(tx.date)} · <span className="text-warn">{KIND[kind]}</span>
                {c && ` · ${c.icon} ${c.name}`}
              </p>
              <p className="mt-1 text-sm">{text}</p>
              <div className="mt-2 flex gap-2">
                {kind !== "unclassified" && (
                  <button className="btn-ghost px-3 py-1.5" disabled={pending} onClick={() => start(() => confirmGuessAction(tx.id))}>
                    ✓ C&apos;est bon
                  </button>
                )}
                <button className="btn-ghost px-3 py-1.5" onClick={() => setEditing(tx)}>
                  {kind === "unclassified" ? "Classer" : "Corriger"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && <TxEditor tx={editing} categories={categories} onClose={() => setEditing(null)} />}
    </>
  );
}
