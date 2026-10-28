import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { parseStatement } from "@/lib/importers";
import { ingestTransactions } from "@/lib/ingest";
import { log } from "@/lib/log";

function decode(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  // Beaucoup d'exports bancaires français sont en Windows-1252
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

export async function POST(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  let accountId = Number(form.get("accountId")) || null;
  const newName = String(form.get("accountName") ?? "").trim();
  if (!accountId) {
    accountId = db
      .insert(schema.accounts)
      .values({ name: newName || file.name.replace(/\.[^.]+$/, ""), source: "manual" })
      .returning({ id: schema.accounts.id })
      .get().id;
  }
  try {
    const rows = parseStatement(file.name, decode(await file.arrayBuffer())).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return NextResponse.json({ error: "Aucune opération reconnue dans ce fichier" }, { status: 400 });
    const created = await ingestTransactions(
      rows.map((r) => ({ ...r, accountId, source: "import" as const })),
      { notify: false, background: true },
    );
    log("import", `${file.name} : ${rows.length} ligne(s), ${created} nouvelle(s)`);
    return NextResponse.json({ ok: true, rows: rows.length, created, from: rows[0]?.date, to: rows.at(-1)?.date });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
