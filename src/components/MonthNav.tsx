import Link from "next/link";
import { addMonths, currentMonth, monthLabel } from "@/lib/dates";

export function MonthNav({ month, base, extra = "" }: { month: string; base: string; extra?: string }) {
  const next = addMonths(month, 1);
  return (
    <div className="flex items-center gap-2">
      <Link className="btn-ghost px-3 py-1.5" href={`${base}?m=${addMonths(month, -1)}${extra}`} aria-label="Mois précédent">
        ‹
      </Link>
      <span className="min-w-32 text-center text-sm font-medium capitalize">{monthLabel(month)}</span>
      {next <= currentMonth() ? (
        <Link className="btn-ghost px-3 py-1.5" href={`${base}?m=${next}${extra}`} aria-label="Mois suivant">
          ›
        </Link>
      ) : (
        <span className="btn-ghost invisible px-3 py-1.5">›</span>
      )}
    </div>
  );
}
