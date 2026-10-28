"use client";

import { useState } from "react";
import type { Category } from "@/lib/db/schema";
import type { TxWithSplits } from "@/lib/queries";
import { formatEUR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { TxEditor } from "./TxEditor";

export function TxList({
  transactions,
  categories,
  openId,
}: {
  transactions: TxWithSplits[];
  categories: Category[];
  openId?: number;
}) {
  const [editing, setEditing] = useState<TxWithSplits | null>(() => transactions.find((t) => t.id === openId) ?? null);
  const cat = new Map(categories.map((c) => [c.id, c]));
  if (!transactions.length) return <p className="py-8 text-center text-sm text-muted">Aucune opération.</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {transactions.map((t) => {
          const main = [...t.splits].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
          const c = main ? cat.get(main.categoryId) : undefined;
          return (
            <li key={t.id}>
              <button onClick={() => setEditing(t)} className="flex w-full items-center gap-3 py-3 text-left">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl text-lg"
                  style={{ background: c ? `${c.color}22` : "var(--surface-2)" }}
                >
                  {t.splits.length > 1 ? "🧾" : (c?.icon ?? "❔")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.merchant || t.label}</span>
                  <span className="block truncate text-xs text-muted">
                    {formatDate(t.date)} ·{" "}
                    {t.splits.length > 1
                      ? `${t.splits.length} catégories`
                      : c
                        ? c.name
                        : <span className="text-warn">À classer</span>}
                    {t.status === "pending" && " · en attente"}
                    {t.classifiedBy === "ai" && (t.aiConfidence ?? 1) < 0.6 && " · à vérifier"}
                  </span>
                </span>
                <span className={`tnum text-sm font-semibold ${t.amount > 0 ? "text-ok" : ""}`}>
                  {t.amount > 0 ? "+" : ""}
                  {formatEUR(t.amount)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {editing && <TxEditor tx={editing} categories={categories} onClose={() => setEditing(null)} />}
    </>
  );
}
