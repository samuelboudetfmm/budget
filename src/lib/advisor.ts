import { askJSON } from "./ai";
import { history, monthSummary } from "./budget";
import { getSetting } from "./settings";

export type Proposal = {
  summary: string;
  categories: { categoryId: number; amount: number; rationale: string }[]; // amount en euros
  tips: string[];
};

const euros = (cents: number) => Math.round(cents) / 100;

/**
 * mode "initial" : construit un budget à partir de l'historique et des objectifs.
 * mode "adjust"  : propose des réallocations pour la fin du mois en cours.
 */
export async function proposeBudget(mode: "initial" | "adjust", monthsBack = 6): Promise<Proposal> {
  const goals = getSetting<string>("goals", "");
  const h = history(monthsBack);
  const current = monthSummary();
  const data = {
    objectifs: goals || "(non renseignés)",
    moisAnalyses: h.months,
    nonClasseParMois: h.unclassified.map(euros),
    categories: h.rows.map((r) => {
      const line = current.lines.find((l) => l.id === r.category.id);
      return {
        id: r.category.id,
        nom: r.category.name,
        type: r.category.kind,
        historiqueMensuel: r.perMonth.map(euros),
        moyenne: euros(r.average),
        mediane: euros(r.median),
        groupe: r.category.groupName ?? undefined,
        verrouille: r.category.locked || undefined,
        debloqueAuJour: r.category.accrual === "daily" || undefined,
        cumulable: r.category.rollover === "self" || undefined,
        budgetActuel: euros(line?.envelope?.alloc ?? line?.budgetAmount ?? 0),
        disponibleCeMois: line?.envelope ? euros(line.envelope.monthAvailable) : undefined,
        depenseCeMois: euros(line?.spent ?? 0),
      };
    }),
    moisEnCours: {
      mois: current.month,
      joursRestants: current.daysLeft,
      budgetTotal: euros(current.totalBudget),
      depenseTotale: euros(current.totalSpent),
      revenus: euros(current.income),
    },
  };
  const task =
    mode === "initial"
      ? `Propose un budget mensuel pour chaque catégorie de type "expense" et "savings", en euros ronds.
Base-toi sur la médiane historique (plus robuste que la moyenne face aux dépenses exceptionnelles), puis ajuste pour atteindre les objectifs de la famille.
Le total des dépenses + épargne ne doit pas dépasser les revenus habituels. Ne propose pas les catégories "income" et "transfer".`
      : `On est en cours de mois. Compare les dépenses du mois aux budgets et aux jours restants.
Propose uniquement les catégories dont le budget du mois en cours devrait changer (réallocation : ce qui est pris à l'une est rendu à une autre, en préservant l'épargne si possible), avec le nouveau montant en euros ronds.
Si tout va bien, renvoie une liste vide et dis-le.`;
  return askJSON<Proposal>(
    [
      {
        role: "system",
        content: `Tu es le conseiller budget bienveillant et concret d'une famille française. Tu réponds en français.
Règles de la famille : on ne s'endette pas et on ne dépasse jamais une enveloppe ; un dépassement doit être couvert par une autre enveloppe, jamais par celles marquées "verrouille" (alimentaire, pharmacie/médecin, impôts). Les paiements en plusieurs fois comptent en totalité le mois de l'achat, sauf des vacances à venir. Vacances et provisions privées ("cumulable") s'accumulent : prévois-y un montant mensuel régulier. Le reste non dépensé des autres enveloppes part sur vêtements/jouets le mois suivant.
${task}
"summary" : 3 à 5 phrases sur la situation et la logique de ta proposition.
"tips" : 2 à 4 conseils concrets et chiffrés.
Réponds uniquement en JSON : {"summary":string,"categories":[{"categoryId":number,"amount":number,"rationale":string}],"tips":[string]}`,
      },
      { role: "user", content: JSON.stringify(data) },
    ],
    { maxTokens: 3000 },
  );
}
