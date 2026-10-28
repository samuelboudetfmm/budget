"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Category } from "@/lib/db/schema";
import { addMemberAction, saveCategoryAction, saveModelAction, type FormState } from "@/app/actions";

function Feedback({ state }: { state: FormState }) {
  if (state?.error) return <p className="text-sm text-danger">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-ok">{state.ok}</p>;
  return null;
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      {label && <span className="label">{label}</span>}
      <div className="flex gap-2">
        <input className="input font-mono text-xs" readOnly value={value} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
    </div>
  );
}

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMemberAction, undefined);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-4">
      <input className="input" name="name" placeholder="Prénom" required />
      <input className="input" name="email" type="email" placeholder="Email" required />
      <input className="input" name="password" type="password" placeholder="Mot de passe (8+)" minLength={8} required autoComplete="new-password" />
      <button className="btn-primary" disabled={pending}>Ajouter</button>
      <div className="sm:col-span-4"><Feedback state={state} /></div>
    </form>
  );
}

const MODELS = ["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"];

export function ModelForm({ model }: { model: string }) {
  const [state, action, pending] = useActionState(saveModelAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="flex gap-2">
        <input className="input font-mono text-xs" name="model" defaultValue={model} list="models" />
        <datalist id="models">
          {MODELS.map((m) => <option key={m} value={m} />)}
        </datalist>
        <button className="btn-primary shrink-0" disabled={pending}>Enregistrer</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function CategoryForm({ category }: { category?: Category }) {
  const [state, action, pending] = useActionState(saveCategoryAction, undefined);
  return (
    <form action={action} className="grid grid-cols-[3.5rem_1fr] gap-2 sm:grid-cols-[3.5rem_1fr_9rem_2fr_auto]">
      {category && <input type="hidden" name="id" value={category.id} />}
      <input className="input text-center" name="icon" defaultValue={category?.icon ?? "📦"} aria-label="Icône" />
      <input className="input" name="name" defaultValue={category?.name} placeholder="Nom" required />
      <select className="input" name="kind" defaultValue={category?.kind ?? "expense"}>
        <option value="expense">Dépense</option>
        <option value="savings">Épargne</option>
        <option value="income">Revenu</option>
        <option value="transfer">Virement interne</option>
      </select>
      <input className="input" name="hint" defaultValue={category?.hint ?? ""} placeholder="Précision pour l'IA (facultatif)" />
      <input type="hidden" name="color" value={category?.color ?? "#64748b"} />
      <button className="btn-ghost" disabled={pending}>{category ? "OK" : "Ajouter"}</button>
      <div className="col-span-full"><Feedback state={state} /></div>
    </form>
  );
}

type Bank = { name: string; country: string; logo?: string };

export function BankConnect() {
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bank/banks")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setBanks(data);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const filtered = useMemo(
    () => (banks ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 30),
    [banks, q],
  );

  const connect = async (b: Bank) => {
    setBusy(b.name);
    setError(null);
    const res = await fetch("/api/bank/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      setBusy(null);
      return;
    }
    window.location.assign(data.url);
  };

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!banks) return <p className="text-sm text-muted">Chargement de la liste des banques…</p>;
  return (
    <div className="space-y-2">
      <input className="input" placeholder="Rechercher votre banque…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {filtered.map((b) => (
          <li key={b.name}>
            <button className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => connect(b)} disabled={!!busy}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {b.logo ? <img src={b.logo} alt="" className="size-6 object-contain" /> : <span className="size-6" />}
              <span className="flex-1">{b.name}</span>
              {busy === b.name && <span className="text-muted">…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/bank/sync", { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Synchronisation…" : "Synchroniser maintenant"}
    </button>
  );
}
