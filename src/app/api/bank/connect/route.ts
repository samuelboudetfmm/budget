import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, newToken } from "@/lib/auth";
import { startAuth } from "@/lib/enablebanking";

export async function POST(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const { name, country } = (await request.json()) as { name: string; country?: string };
  const state = newToken(16);
  (await cookies()).set("bank_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 1800, secure: process.env.NODE_ENV === "production" });
  try {
    const url = await startAuth({ name, country: country || "FR" }, state);
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
