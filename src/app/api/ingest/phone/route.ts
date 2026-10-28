import { NextResponse, type NextRequest } from "next/server";
import { userFromIngestToken } from "@/lib/auth";
import { ingestTransactions } from "@/lib/ingest";
import { parsePhonePayload, type PhonePayload } from "@/lib/phone";
import { formatEUR } from "@/lib/money";
import { log } from "@/lib/log";

/** Appelé par le Raccourci iPhone ou MacroDroid (Android) à chaque paiement. */
export async function POST(request: NextRequest) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const user = userFromIngestToken(bearer || request.nextUrl.searchParams.get("token"));
  if (!user) return NextResponse.json({ error: "Jeton invalide" }, { status: 401 });

  let payload: PhonePayload;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("json")) payload = await request.json();
  else if (type.includes("form")) payload = Object.fromEntries((await request.formData()).entries()) as PhonePayload;
  else payload = { text: await request.text() };

  const tx = await parsePhonePayload(payload);
  if (!tx) {
    log("phone", `${user.name} : notification ignorée (${JSON.stringify(payload).slice(0, 200)})`);
    return NextResponse.json({ ok: true, ignored: true });
  }
  tx.label = tx.label + (payload.card ? ` (${payload.card})` : "");
  log("phone", `${user.name} : ${formatEUR(tx.amount)} ${tx.merchant}`);
  await ingestTransactions([tx], { notify: true });
  return NextResponse.json({ ok: true });
}
