import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listBanks } from "@/lib/enablebanking";

export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  try {
    const banks = await listBanks("FR");
    return NextResponse.json(banks.map((b) => ({ name: b.name, country: b.country, logo: b.logo })));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
