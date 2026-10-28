"use client";

import { useState } from "react";
import Link from "next/link";

export function ImportForm({ accounts }: { accounts: { id: number; name: string }[] }) {
  const [result, setResult] = useState<{ rows: number; created: number; from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ? String(accounts[0].id) : "");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/import", { method: "POST", body: new FormData(e.currentTarget) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div>
        <label className="label" htmlFor="file">Fichier CSV ou OFX</label>
        <input className="input" id="file" name="file" type="file" accept=".csv,.ofx,.qfx,.txt" required />
      </div>
      <div>
        <label className="label" htmlFor="accountId">Compte</label>
        <select className="input" id="accountId" name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
          <option value="">+ Nouveau compte</option>
        </select>
      </div>
      {!accountId && <input className="input" name="accountName" placeholder="Nom du compte (ex : Compte joint)" />}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Import…" : "Importer"}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <p className="text-sm text-ok">
          {result.rows} opérations lues (du {result.from} au {result.to}), {result.created} nouvelles. Classement IA en cours —{" "}
          <Link className="underline" href="/transactions">voir les opérations</Link>.
        </p>
      )}
    </form>
  );
}
