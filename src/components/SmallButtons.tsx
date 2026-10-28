"use client";

import { useTransition } from "react";
import {
  archiveCategoryAction,
  classifyAllPendingAction,
  deleteAccountAction,
  deleteRuleAction,
  logoutAction,
  regenerateTokenAction,
  retryEmailAction,
} from "@/app/actions";

function ActionButton({ run, children, className = "btn-ghost", confirmText }: { run: () => Promise<unknown>; children: React.ReactNode; className?: string; confirmText?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={className}
      disabled={pending}
      onClick={() => {
        if (confirmText && !confirm(confirmText)) return;
        start(async () => {
          await run();
        });
      }}
    >
      {pending ? "…" : children}
    </button>
  );
}

export const RetryEmailButton = ({ id }: { id: number }) => (
  <ActionButton run={() => retryEmailAction(id)} className="mt-2 text-xs text-accent underline">Réanalyser</ActionButton>
);
export const RegenerateTokenButton = () => (
  <ActionButton run={regenerateTokenAction} confirmText="Les raccourcis existants cesseront de fonctionner. Continuer ?">Nouveau jeton</ActionButton>
);
export const DeleteRuleButton = ({ id }: { id: number }) => (
  <ActionButton run={() => deleteRuleAction(id)} className="text-xs text-danger">Supprimer</ActionButton>
);
export const ArchiveCategoryButton = ({ id }: { id: number }) => (
  <ActionButton run={() => archiveCategoryAction(id)} className="text-xs text-danger" confirmText="Masquer cette catégorie ?">Masquer</ActionButton>
);
export const DeleteAccountButton = ({ id }: { id: number }) => (
  <ActionButton run={() => deleteAccountAction(id)} className="text-xs text-danger" confirmText="Retirer ce compte ? Ses opérations sont conservées.">Retirer</ActionButton>
);
export const ClassifyPendingButton = () => <ActionButton run={classifyAllPendingAction}>Classer les opérations restantes</ActionButton>;
export const LogoutButton = () => <ActionButton run={logoutAction}>Se déconnecter</ActionButton>;
