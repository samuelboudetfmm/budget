import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { monthSummary } from "@/lib/budget";
import { formatEUR } from "@/lib/money";
import { sendToAll } from "@/lib/push";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const s = monthSummary();
  await sendToAll({
    title: "Test de notification",
    body: `Envoyé par ${user.name}. Budget du mois : reste ${formatEUR(s.remaining)} (${s.daysLeft} j).`,
    url: "/",
  });
  return NextResponse.json({ ok: true });
}
