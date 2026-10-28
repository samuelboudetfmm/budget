import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { getCurrentUser, hasUsers } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export default async function LoginPage() {
  if (!hasUsers()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="card">
      <AuthForm action={loginAction} submit="Se connecter" />
      <p className="mt-4 text-center text-xs text-muted">Vous resterez connecté sur cet appareil.</p>
    </div>
  );
}
