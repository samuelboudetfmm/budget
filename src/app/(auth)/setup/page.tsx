import { redirect } from "next/navigation";
import { setupAction } from "@/app/actions";
import { hasUsers, setupCode } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export default function SetupPage() {
  if (hasUsers()) redirect("/login");
  setupCode();
  return (
    <div className="card">
      <p className="mb-4 text-sm text-muted">
        Premier lancement : créez votre compte. Le code d&apos;installation à 6 chiffres est affiché dans les logs du serveur
        (<code>docker compose logs web</code>) et dans <code>data/setup-code.txt</code>. Vous ajouterez ensuite les autres membres
        de la famille dans les réglages.
      </p>
      <AuthForm action={setupAction} withName withCode submit="Créer mon compte" />
    </div>
  );
}
