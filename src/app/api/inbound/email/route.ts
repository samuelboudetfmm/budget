import { NextResponse, type NextRequest } from "next/server";
import { receiveEmail } from "@/lib/email";

/**
 * Webhook optionnel (Cloudflare Email Worker, Mailgun…) : mail brut MIME
 * ou JSON { from, subject, text, html }. Protégé par INBOUND_EMAIL_TOKEN.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.INBOUND_EMAIL_TOKEN;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.nextUrl.searchParams.get("token");
  if (!expected || token !== expected) return NextResponse.json({ error: "Jeton invalide" }, { status: 401 });

  const type = request.headers.get("content-type") ?? "";
  let email;
  if (type.includes("json")) email = await receiveEmail(await request.json());
  else if (type.includes("form")) {
    const f = await request.formData();
    const get = (k: string) => (f.get(k) as string | null) ?? undefined;
    email = get("body-mime")
      ? await receiveEmail({ raw: get("body-mime")! })
      : await receiveEmail({ from: get("from") ?? get("sender"), subject: get("subject"), text: get("body-plain") ?? get("text"), html: get("body-html") ?? get("html") });
  } else email = await receiveEmail({ raw: Buffer.from(await request.arrayBuffer()) });
  return NextResponse.json({ ok: true, id: email?.id });
}
