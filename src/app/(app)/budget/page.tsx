import { history, monthSummary } from "@/lib/budget";
import { getSetting } from "@/lib/settings";
import { BudgetEditor, type BudgetRow } from "@/components/BudgetEditor";

export default async function BudgetPage({ searchParams }: PageProps<"/budget">) {
  const sp = await searchParams;
  const monthsBack = [3, 6, 12].includes(Number(sp.n)) ? Number(sp.n) : 6;
  const h = history(monthsBack);
  const cur = monthSummary();
  const rows: BudgetRow[] = h.rows
    .filter((r) => r.category.kind !== "transfer")
    // Les provisions s'affichent avec leur groupe, dans l'ordre des enveloppes
    .sort((a, b) => a.category.sortOrder - b.category.sortOrder)
    .map((r) => {
      const line = cur.lines.find((l) => l.id === r.category.id)!;
      return {
        id: r.category.id,
        name: r.category.name,
        icon: r.category.icon,
        kind: r.category.kind,
        group: r.category.groupName,
        locked: r.category.locked,
        daily: r.category.accrual === "daily",
        accumulates: r.category.rollover === "self",
        perMonth: r.perMonth,
        median: r.median,
        average: r.average,
        defaultBudget: r.category.budget,
        // Budget du mois hors reste reporté et reports
        monthBudget: line.envelope?.alloc ?? line.budgetAmount,
        spent: line.spent,
      };
    });
  return (
    <BudgetEditor
      rows={rows}
      months={h.months}
      monthsBack={monthsBack}
      unclassified={h.unclassified}
      goals={getSetting("goals", "")}
      daysLeft={cur.daysLeft}
      rulesActive={cur.envelopes.active}
    />
  );
}
