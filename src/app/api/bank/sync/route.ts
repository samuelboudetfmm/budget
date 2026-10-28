import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { syncAll } from "@/lib/enablebanking";

export async function POST() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  await syncAll();
  return NextResponse.json({ ok: true });
}
