import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { finishAuth } from "@/lib/enablebanking";

export async function GET(request: NextRequest) {
  const base = process.env.APP_URL || request.nextUrl.origin;
  if (!(await getCurrentUser())) return NextResponse.redirect(`${base}/login`);
  const p = request.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get("bank_state")?.value;
  jar.delete("bank_state");
  if (p.get("error") || !p.get("code")) {
    return NextResponse.redirect(`${base}/settings?bank=${encodeURIComponent(p.get("error_description") || p.get("error") || "annulé")}`);
  }
  if (!expected || p.get("state") !== expected) return NextResponse.redirect(`${base}/settings?bank=state`);
  try {
    await finishAuth(p.get("code")!);
    return NextResponse.redirect(`${base}/settings?bank=ok`);
  } catch (e) {
    return NextResponse.redirect(`${base}/settings?bank=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
