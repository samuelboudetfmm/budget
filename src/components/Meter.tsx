/** Jauge de consommation d'un budget : vert < 85 %, orange < 100 %, rouge au-delà. */
export function Meter({ spent, budget, color }: { spent: number; budget: number; color?: string }) {
  // Sans budget défini : simple trait neutre
  if (budget <= 0) return <div className="h-2 w-full rounded-full bg-surface-2" />;
  const ratio = spent / budget;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const tone = ratio > 1 ? "var(--danger)" : ratio > 0.85 ? "var(--warn)" : (color ?? "var(--accent)");
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}
