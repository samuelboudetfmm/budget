"use client";

import { useActionState } from "react";
import { addManualTransactionAction } from "@/app/actions";

export function ManualTxForm() {
  const [state, action, pending] = useActionState(addManualTransactionAction, undefined);
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-medium">Ajouter une opération à la main (espèces…)</summary>
      <form action={action} className="mt-3 grid grid-cols-2 gap-2">
        <select className="input" name="type" defaultValue="expense">
          <option value="expense">Dépense</option>
          <option value="income">Rentrée</option>
        </select>
        <input className="input" name="amount" placeholder="Montant (€)" inputMode="decimal" required />
        <input className="input col-span-2" name="label" placeholder="Commerçant / libellé" required />
        <input className="input" name="date" type="date" />
        <button className="btn-primary" disabled={pending}>
          Ajouter
        </button>
        {state?.error && <p className="col-span-2 text-sm text-danger">{state.error}</p>}
        {state?.ok && <p className="col-span-2 text-sm text-ok">{state.ok}</p>}
      </form>
    </details>
  );
}
