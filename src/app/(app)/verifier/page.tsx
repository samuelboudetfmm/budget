import Link from "next/link";
import { activeCategories } from "@/lib/classify";
import { formatEUR } from "@/lib/money";
import { uncertainTransactions, uncertainWishlist } from "@/lib/uncertain";
import { UncertainList } from "@/components/UncertainList";

// Les règles que l'app applique sans qu'elles aient été précisées : à valider par la famille
const RULE_ASSUMPTIONS = [
  "Les règles (pas de dépassement, reports, reste du mois) s'appliquent à partir du mois où le premier budget a été enregistré ; l'historique importé avant sert seulement à calculer les médianes.",
  "Vêtements & jouets : le budget du mois se débloque chaque jour (budget ÷ nombre de jours) ; ce qui vient du mois précédent ou d'un report est disponible tout de suite.",
  "Une dépense qui dépasse est mise en attente en entier (pas seulement la partie qui dépasse) ; si un ticket la répartit sur plusieurs budgets, seule la part du budget dépassé attend.",
  "Les remboursements (montant positif dans un budget) redonnent de la marge immédiatement.",
  "Factures mensuelles = cinq budgets distincts : Impôts (verrouillé), Téléphone, Internet, Charges, Emprunt. Téléphone, Internet, Charges et Emprunt peuvent servir de source pour un report.",
  "Charges regroupe aussi : assurances, mutuelle, frais bancaires, cantine, garde, abonnements. Emprunt inclut un éventuel loyer. Énergie inclut le carburant. Sorties inclut les cadeaux. Imprévu sert aussi de « divers ».",
  "Le reste non dépensé de chaque budget part par défaut sur Vêtements & jouets le mois suivant (y compris celui d'Imprévu) ; Vacances et les provisions privées, elles, s'accumulent sur elles-mêmes.",
  "Provisions privées : chaque membre crée les siennes ; elles sont visibles par toute la famille mais seul leur propriétaire peut y puiser pour un report.",
  "Paiement en plusieurs fois repéré dans le libellé (4X, Oney, Alma, Klarna…) : supposé être la 1re échéance d'un achat en N fois (N lu dans le libellé, 4 sinon) ; le total compte le mois de l'achat et les échéances suivantes sont rattachées automatiquement (même commerçant, même montant à 1 € près).",
  "Vacances payées par parties : autorisé seulement si la date du séjour est postérieure au paiement ; sinon le total compte en une fois comme les autres achats fractionnés.",
  "Wishlist : quand la page ne permet pas de connaître les frais de livraison, ils sont comptés 0 € dans le « meilleur prix ».",
];

export default function VerifierPage() {
  const rows = uncertainTransactions();
  const wishes = uncertainWishlist();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">À vérifier</h1>
        <p className="text-sm text-muted">
          Quand il y a un doute, l&apos;app fait la supposition la plus probable pour que le budget reste juste, et la liste ici.
        </p>
      </div>

      <section className="card">
        <h2 className="font-semibold">Dépenses ({rows.length})</h2>
        <UncertainList rows={rows} categories={activeCategories()} />
      </section>

      {wishes.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Wishlist ({wishes.length})</h2>
          <ul className="divide-y divide-border text-sm">
            {wishes.map(({ link, item }) => (
              <li key={link.id} className="py-2">
                <Link href={`/wishlist?open=${item.id}`} className="block">
                  <span className="font-medium">{item.title}</span> <span className="text-muted">· {link.seller}</span>
                  <span className="block text-xs text-warn">
                    {link.status === "error"
                      ? (link.error ?? "Page illisible : saisissez le prix à la main")
                      : link.price == null
                        ? "Prix introuvable"
                        : `Livraison inconnue : supposée gratuite (prix ${formatEUR(link.price)})`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="card">
        <summary className="cursor-pointer font-semibold">Hypothèses sur les règles du budget</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
          {RULE_ASSUMPTIONS.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
