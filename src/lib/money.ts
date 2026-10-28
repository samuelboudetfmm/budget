const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function formatEUR(cents: number): string {
  return eur.format(cents / 100);
}

/** "12,50 €", "-1 234.56", "1.234,56" → centimes. null si illisible. */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = input.replace(/[\s  €$]|EUR/gi, "").replace(/−/g, "-");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
