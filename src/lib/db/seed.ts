import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

type NewCategory = Omit<typeof schema.categories.$inferInsert, "sortOrder">;

export const GROUP_BILLS = "Factures mensuelles";
export const GROUP_LEISURE = "Vacances, sorties & privé";

// Les enveloppes demandées par la famille. Alimentaire, pharmacie/médecin et impôts sont verrouillées :
// on ne peut pas y puiser pour couvrir un dépassement ailleurs.
const DEFAULT_CATEGORIES: NewCategory[] = [
  { code: "alimentaire", name: "Alimentaire", icon: "🛒", color: "#16a34a", locked: true, hint: "courses alimentaires, boulangerie, boucherie, marché, drive (hors restaurants)" },
  { code: "sante", name: "Pharmacie & médecin", icon: "🩺", color: "#dc2626", locked: true, hint: "médecin, pharmacie, dentiste, analyses, optique, kiné, hôpital" },
  { code: "impots", name: "Impôts", icon: "🏛️", color: "#78716c", groupName: GROUP_BILLS, locked: true, hint: "impôt sur le revenu, taxe foncière, taxe d'habitation, amendes" },
  { code: "telephone", name: "Téléphone", icon: "📱", color: "#2563eb", groupName: GROUP_BILLS, hint: "forfaits mobiles" },
  { code: "internet", name: "Internet", icon: "🌐", color: "#0284c7", groupName: GROUP_BILLS, hint: "box internet, fibre, ADSL" },
  { code: "charges", name: "Charges", icon: "🧾", color: "#4f46e5", groupName: GROUP_BILLS, hint: "charges de copropriété, assurances (habitation, auto, mutuelle), frais bancaires, cantine, garde, abonnements et streaming" },
  { code: "emprunt", name: "Emprunt", icon: "🏠", color: "#7c3aed", groupName: GROUP_BILLS, hint: "mensualités de crédit immobilier ou auto, loyer" },
  { code: "energie", name: "Énergie", icon: "⚡", color: "#ca8a04", hint: "électricité, gaz, eau, fioul, bois, carburant" },
  { code: "hygiene", name: "Hygiène", icon: "🧴", color: "#0891b2", hint: "produits d'hygiène et de beauté, ménage, lessive, couches, coiffeur" },
  { code: "libre", name: "Libre (vêtements, jouets…)", icon: "🎈", color: "#db2777", accrual: "daily", hint: "vêtements, chaussures, jouets, jeux, livres, loisirs créatifs, petits plaisirs ; reçoit aussi l'argent des ventes Vinted, Leboncoin, etc." },
  { code: "vacances", name: "Vacances", icon: "🏖️", color: "#0d9488", groupName: GROUP_LEISURE, rollover: "self", hint: "hébergement, billets, location et activités de vacances" },
  { code: "sorties", name: "Sorties", icon: "🍽️", color: "#ea580c", groupName: GROUP_LEISURE, hint: "restaurants, fast-food, cafés, cinéma, parcs, sport, sorties en famille, cadeaux" },
  { code: "imprevu", name: "Imprévu", icon: "🧯", color: "#64748b", hint: "réparations, pannes, électroménager à remplacer, dépenses exceptionnelles non prévues, divers" },
  { code: "epargne", name: "Épargne", icon: "🐷", color: "#059669", kind: "savings", hint: "virements vers livret, assurance-vie, PEA" },
  { code: "revenus", name: "Revenus", icon: "💶", color: "#15803d", kind: "income", hint: "salaires, allocations, remboursements reçus (pas les ventes Vinted/Leboncoin, qui vont dans Libre)" },
  { code: "virements", name: "Virements internes", icon: "🔄", color: "#94a3b8", kind: "transfer", hint: "virements entre comptes communs ou vers l'épargne commune (pas les virements vers un compte perso, qui vont dans le budget privé de la personne)" },
  { code: "echeance", name: "Échéance déjà comptée", icon: "🧮", color: "#a8a29e", kind: "transfer", hint: "échéance d'un paiement en plusieurs fois, déjà comptée en totalité le mois de l'achat" },
];

const VERSION = 3;

export function seed(db: BetterSQLite3Database<typeof schema>) {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, "categories_version")).get();
  if (row && Number(row.value) >= VERSION) return;
  db.transaction((t) => {
    const existing = t.select().from(schema.categories).all();
    // Reprise par code (v2+, renommages compris), sinon par nom (catégories revenus / épargne / virements de la v1)
    const byCode = new Map(existing.filter((c) => c.code).map((c) => [c.code!, c]));
    const byName = new Map(existing.map((c) => [c.name, c]));
    const renamed: Record<string, string> = { libre: "vetements" };
    const kept: number[] = [];
    DEFAULT_CATEGORIES.forEach((c, i) => {
      const old = byCode.get(c.code!) ?? byCode.get(renamed[c.code!] ?? "") ?? byName.get(c.name);
      if (old && old.kind === (c.kind ?? "expense")) {
        t.update(schema.categories).set({ ...c, sortOrder: i, archived: false }).where(eq(schema.categories.id, old.id)).run();
        kept.push(old.id);
      } else {
        kept.push(t.insert(schema.categories).values({ ...c, sortOrder: i }).returning().get().id);
      }
    });
    // Seules les catégories de la v1 sont retirées : celles ajoutées depuis (provisions privées…) restent
    const fromV1 = !row || Number(row.value) < 2;
    const obsolete = fromV1 ? existing.filter((c) => !kept.includes(c.id)).map((c) => c.id) : [];
    if (obsolete.length) {
      const used = t
        .select({ id: schema.splits.categoryId })
        .from(schema.splits)
        .where(inArray(schema.splits.categoryId, obsolete))
        .groupBy(schema.splits.categoryId)
        .all()
        .map((r) => r.id);
      // Anciennes catégories : supprimées si vides, sinon masquées (l'historique reste consultable)
      if (used.length) t.update(schema.categories).set({ archived: true }).where(inArray(schema.categories.id, used)).run();
      t.delete(schema.categories)
        .where(and(inArray(schema.categories.id, obsolete), used.length ? notInArray(schema.categories.id, used) : undefined))
        .run();
      t.delete(schema.merchantRules).where(inArray(schema.merchantRules.categoryId, obsolete)).run();
    }
    t.insert(schema.settings)
      .values({ key: "categories_version", value: String(VERSION) })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(VERSION) } })
      .run();
  });
}
