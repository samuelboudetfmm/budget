"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions";

export function AuthForm({
  action,
  withName,
  withCode,
  submit,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  withName?: boolean;
  withCode?: boolean;
  submit: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-3">
      {withCode && (
        <div>
          <label className="label" htmlFor="code">Code d&apos;installation</label>
          <input className="input tnum" id="code" name="code" inputMode="numeric" autoComplete="off" required />
        </div>
      )}
      {withName && (
        <div>
          <label className="label" htmlFor="name">Prénom</label>
          <input className="input" id="name" name="name" autoComplete="given-name" required />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Mot de passe</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete={withName ? "new-password" : "current-password"}
          minLength={withName ? 8 : undefined}
          required
        />
      </div>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : submit}
      </button>
    </form>
  );
}
