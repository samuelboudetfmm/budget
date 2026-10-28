import { getSetting } from "./settings";

/**
 * L'app ne suit que le compte commun. Les budgets privés se dépensent sur les comptes perso :
 * un paiement signalé (téléphone, mail) avec une carte qui n'est pas celle du compte commun est ignoré.
 * Réglage : fins de numéro (« 1234 ») ou noms de carte Wallet (« Visa commune »).
 */
export const jointCards = () => getSetting<string[]>("joint_cards", []);

const ENDING = /(?:(?<![a-z])[xX]{2,}|[*•·]+|\.{3,}|termin[ée]e? par|finissant par)\s?(\d{4})\b/gi;

/** Fins de carte citées dans un texte (« carte ****1234 », « •1234 », « terminée par 1234 »). */
export function cardEndings(text: string): string[] {
  return [...text.matchAll(ENDING)].map((m) => m[1]);
}

const isJoint = (s: string, cards: string[]) => cards.some((c) => s.toLowerCase().includes(c.toLowerCase()));

/** Champ « carte » du Raccourci iPhone : perso si on connaît les cartes communes et qu'aucune ne correspond. */
export function isPersonalCardName(card: string | null | undefined): boolean {
  const cards = jointCards();
  return Boolean(card?.trim()) && cards.length > 0 && !isJoint(card!, cards);
}

/** Texte libre (notification, mail) : perso seulement s'il cite une fin de carte qui n'est pas commune. */
export function mentionsPersonalCard(text: string | null | undefined): boolean {
  const endings = jointCards().filter((c) => /^\d{4}$/.test(c));
  if (!text || !endings.length) return false;
  const found = cardEndings(text);
  return found.length > 0 && !found.some((e) => endings.includes(e));
}

/** Fin de carte donnée explicitement (extraction IA d'un mail). */
export function isPersonalEnding(ending: string | null | undefined): boolean {
  const endings = jointCards().filter((c) => /^\d{4}$/.test(c));
  return Boolean(ending && /^\d{4}$/.test(ending)) && endings.length > 0 && !endings.includes(ending!);
}
