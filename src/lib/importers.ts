import crypto from "node:crypto";
import { normalizeDate } from "./dates";
import { parseAmount } from "./money";

export type ParsedRow = { date: string; amount: number; label: string; externalId: string };

function fingerprint(date: string, amount: number, label: string, n: number) {
  return "imp:" + crypto.createHash("sha1").update(`${date}|${amount}|${label}|${n}`).digest("hex").slice(0, 20);
}

/** Identifiant stable : deux lignes identiques le même jour restent distinctes. */
function withIds(rows: Omit<ParsedRow, "externalId">[]): ParsedRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = `${r.date}|${r.amount}|${r.label}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...r, externalId: fingerprint(r.date, r.amount, r.label, n) };
  });
}

export function parseOFX(text: string): ParsedRow[] {
  const rows: Omit<ParsedRow, "externalId">[] = [];
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const date = normalizeDate(tag(block, "DTPOSTED"));
    const amount = parseAmount(tag(block, "TRNAMT"));
    const label = [tag(block, "NAME"), tag(block, "MEMO")].filter(Boolean).join(" ").trim();
    if (date && amount != null) rows.push({ date, amount, label: label || "Opération" });
  }
  return withIds(rows);
}

function splitCSVLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/**
 * CSV des banques françaises : séparateur ; , ou tabulation, dates jj/mm/aaaa,
 * montant unique ou colonnes Débit / Crédit.
 */
export function parseCSV(text: string): ParsedRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sample = lines.slice(0, 10).join("\n");
  const sep = [";", "\t", ","].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];

  // L'en-tête est la première ligne qui contient "date"
  const headerIdx = lines.findIndex((l) => /date/i.test(l));
  if (headerIdx < 0) throw new Error("En-tête introuvable : le fichier doit contenir une colonne « Date »");
  const header = splitCSVLine(lines[headerIdx], sep).map(norm);
  const find = (...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));
  const iDate = find(/^date( (operation|op|comptable))?$/, /date/);
  const iLabel = find(/libelle|label|description|intitule|nature|detail/);
  const iLabel2 = header.findIndex((h, i) => i !== iLabel && /(libelle|info|complement|memo|detail)/.test(h));
  const iAmount = find(/^montant/, /amount/);
  const iDebit = find(/debit/);
  const iCredit = find(/credit/);
  if (iDate < 0 || (iAmount < 0 && iDebit < 0 && iCredit < 0)) {
    throw new Error("Colonnes Date et Montant (ou Débit/Crédit) introuvables");
  }

  const rows: Omit<ParsedRow, "externalId">[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cols = splitCSVLine(line, sep);
    const date = normalizeDate(cols[iDate] ?? "");
    if (!date) continue;
    let amount: number | null;
    if (iAmount >= 0) amount = parseAmount(cols[iAmount]);
    else {
      const d = parseAmount(cols[iDebit] ?? "");
      const c = parseAmount(cols[iCredit] ?? "");
      amount = d ? -Math.abs(d) : c ? Math.abs(c) : null;
    }
    if (amount == null || amount === 0) continue;
    const label = [cols[iLabel], iLabel2 >= 0 ? cols[iLabel2] : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    rows.push({ date, amount, label: label || "Opération" });
  }
  return withIds(rows);
}

export function parseStatement(filename: string, text: string): ParsedRow[] {
  if (/\.(ofx|qfx)$/i.test(filename) || /<OFX>/i.test(text)) return parseOFX(text);
  return parseCSV(text);
}
