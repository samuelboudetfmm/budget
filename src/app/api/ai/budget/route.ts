import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { proposeBudget } from "@/lib/advisor";

export async function POST(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const { mode, monthsBack } = (await request.json()) as { mode: "initial" | "adjust"; monthsBack?: number };
  try {
    return NextResponse.json(await proposeBudget(mode, monthsBack ?? 6));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
