"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  createUser,
  endSession,
  hasUsers,
  newToken,
  requireUser,
  setupCode,
  startSession,
  verifyPassword,
} from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { classifyPending, classifyTransactions, learnRule, setSplits } from "@/lib/classify";
import { analyzeEmail } from "@/lib/email";
import { currentMonth, normalizeDate, today } from "@/lib/dates";
import { parseAmount } from "@/lib/money";
import { getSetting, setSetting } from "@/lib/settings";
import { computeEnvelopes, transferSources } from "@/lib/envelopes";
import { createPlan, deletePlanOf } from "@/lib/installments";
import { GROUP_LEISURE } from "@/lib/db/seed";
import { deleteItemImage, scrapeLink, sellerOf } from "@/lib/wishlist";

export type FormState = { error?: string; ok?: string } | undefined;

// ---------- Connexion ----------

export async function setupAction(_: FormState, form: FormData): Promise<FormState> {
  if (hasUsers()) redirect("/login");
  if (String(form.get("code") ?? "").trim() !== setupCode()) {
    return { error: "Code d'installation incorrect (voir les logs du serveur ou data/setup-code.txt)." };
  }
  const email = String(form.get("email") ?? "");
  const name = String(form.get("name") ?? "");
  const password = String(form.get("password") ?? "");
  if (!email.includes("@") || !name || password.length < 8) {
    return { error: "Email, prénom et mot de passe (8 caractères min.) requis." };
  }
  const user = await createUser(email, name, password);
  await startSession(user.id);
  redirect("/");
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await verifyPassword(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!user) return { error: "Email ou mot de passe incorrect." };
  await startSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function addMemberAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const email = String(form.get("email") ?? "");
  const name = String(form.get("name") ?? "");
  const password = String(form.get("password") ?? "");
  if (!email.includes("@") || !name || password.length < 8) {
    return { error: "Email, prénom et mot de passe (8 caractères min.) requis." };
  }
  try {
    await createUser(email, name, password);
  } catch {
    return { error: "Cet email existe déjà." };
  }
  revalidatePath("/settings");
  return { ok: `${name} peut maintenant se connecter.` };
}

export async function regenerateTokenAction() {
  const user = await requireUser();
  db.update(schema.users).set({ ingestToken: newToken(24) }).where(eq(schema.users.id, user.id)).run();
  revalidatePath("/settings");
}

// ---------- Opérations ----------

/** Enregistre la répartition choisie par l'utilisateur (une ou plusieurs catégories). */
export async function saveSplitsAction(
  txId: number,
  parts: { categoryId: number; amount: number }[],
  opts: { remember: boolean; note?: string },
) {
  await requireUser();
  const tx = db.select().from(schema.transactions).where(eq(schema.transactions.id, txId)).get();
  if (!tx) return;
  const sign = tx.amount < 0 ? -1 : 1;
  const clean = parts.filter((p) => p.categoryId && p.amount > 0).map((p) => ({ categoryId: p.categoryId, amount: p.amount * sign }));
  setSplits(txId, clean, { classifiedBy: "user", aiConfidence: null });
  db.update(schema.transactions).set({ note: opts.note ?? tx.note }).where(eq(schema.transactions.id, txId)).run();
  if (opts.remember && clean.length) {
    const main = [...clean].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    learnRule(tx, main.categoryId, clean.length > 1);
  }
  revalidatePath("/", "layout");
}

export async function reclassifyAction(txId: number) {
  await requireUser();
  db.update(schema.transactions).set({ classifiedBy: null }).where(eq(schema.transactions.id, txId)).run();
  await classifyTransactions([txId], { force: true });
  revalidatePath("/", "layout");
}

export async function deleteTransactionAction(txId: number) {
  await requireUser();
  db.delete(schema.transactions).where(eq(schema.transactions.id, txId)).run();
  revalidatePath("/", "layout");
}

export async function addManualTransactionAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const value = parseAmount(String(form.get("amount") ?? ""));
  const label = String(form.get("label") ?? "").trim();
  const date = normalizeDate(String(form.get("date") ?? "")) ?? today();
  if (!value || !label) return { error: "Montant et libellé requis." };
  const amount = form.get("type") === "income" ? Math.abs(value) : -Math.abs(value);
  const { ingestTransactions } = await import("@/lib/ingest");
  await ingestTransactions([{ date, amount, label, merchant: label, source: "manual" }], { notify: false });
  revalidatePath("/", "layout");
  return { ok: "Opération ajoutée." };
}

// ---------- Budget ----------

/** Montants en euros ; scope "default" = budget permanent, sinon uniquement le mois en cours. */
export async function saveBudgetsAction(values: { categoryId: number; amount: number }[], scope: "default" | "month") {
  await requireUser();
  const month = currentMonth();
  // Les règles (pas de dépassement, reports) s'appliquent à partir du mois du premier budget enregistré
  if (!getSetting<string | null>("rules_start", null)) setSetting("rules_start", month);
  db.transaction((t) => {
    for (const v of values) {
      const cents = Math.max(0, Math.round(v.amount * 100));
      if (scope === "default") {
        t.update(schema.categories).set({ budget: cents }).where(eq(schema.categories.id, v.categoryId)).run();
        t.delete(schema.budgetOverrides)
          .where(and(eq(schema.budgetOverrides.month, month), eq(schema.budgetOverrides.categoryId, v.categoryId)))
          .run();
      } else {
        t.insert(schema.budgetOverrides)
          .values({ month, categoryId: v.categoryId, amount: cents })
          .onConflictDoUpdate({
            target: [schema.budgetOverrides.month, schema.budgetOverrides.categoryId],
            set: { amount: cents },
          })
          .run();
      }
    }
  });
  revalidatePath("/", "layout");
}

export async function saveGoalsAction(goals: string) {
  await requireUser();
  setSetting("goals", goals.slice(0, 4000));
  revalidatePath("/budget");
}

// ---------- Catégories ----------

export async function saveCategoryAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const id = Number(form.get("id")) || null;
  const values = {
    name: String(form.get("name") ?? "").trim(),
    icon: String(form.get("icon") ?? "").trim() || "📦",
    color: String(form.get("color") ?? "#64748b"),
    kind: String(form.get("kind") ?? "expense"),
    hint: String(form.get("hint") ?? "").trim() || null,
  };
  if (!values.name) return { error: "Nom requis." };
  if (id) db.update(schema.categories).set(values).where(eq(schema.categories.id, id)).run();
  else db.insert(schema.categories).values({ ...values, sortOrder: 1000 }).run();
  revalidatePath("/", "layout");
  return { ok: "Catégorie enregistrée." };
}

export async function archiveCategoryAction(id: number) {
  await requireUser();
  db.update(schema.categories).set({ archived: true }).where(eq(schema.categories.id, id)).run();
  revalidatePath("/", "layout");
}

export async function deleteRuleAction(id: number) {
  await requireUser();
  db.delete(schema.merchantRules).where(eq(schema.merchantRules.id, id)).run();
  revalidatePath("/settings");
}

// ---------- Réglages ----------

export async function saveModelAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const model = String(form.get("model") ?? "").trim();
  if (!/^[\w.~-]+\/[\w.:~-]+$/.test(model)) return { error: "Identifiant OpenRouter attendu, ex. anthropic/claude-haiku-5.5" };
  setSetting("llm_model", model);
  revalidatePath("/settings");
  return { ok: `Modèle : ${model}` };
}

export async function retryEmailAction(id: number) {
  await requireUser();
  await analyzeEmail(id);
  revalidatePath("/emails");
}

export async function deleteAccountAction(id: number) {
  await requireUser();
  db.delete(schema.accounts).where(eq(schema.accounts.id, id)).run();
  revalidatePath("/settings");
}

export async function classifyAllPendingAction() {
  await requireUser();
  classifyPending(2000).catch(() => {});
  revalidatePath("/", "layout");
}

// ---------- Enveloppes : reports et reste du mois ----------

/** Couvre un dépassement en prenant sur une autre enveloppe (jamais alimentaire, pharmacie, impôts). */
export async function transferAction(fromId: number, toId: number, amount: number): Promise<FormState> {
  const user = await requireUser();
  const state = computeEnvelopes();
  const source = transferSources(state, user.id, toId).find((s) => s.category.id === fromId);
  if (!source) return { error: "On ne peut pas puiser dans ce budget." };
  const cents = Math.round(amount);
  if (cents <= 0) return { error: "Montant invalide." };
  if (cents > source.free) return { error: `Il ne reste que ${(source.free / 100).toFixed(2).replace(".", ",")} € dans ${source.category.name}.` };
  db.insert(schema.budgetTransfers)
    .values({ date: today(), fromCategoryId: fromId, toCategoryId: toId, amount: cents, userId: user.id })
    .run();
  revalidatePath("/", "layout");
  return { ok: "Report effectué." };
}

export async function cancelTransferAction(id: number) {
  await requireUser();
  db.delete(schema.budgetTransfers).where(and(eq(schema.budgetTransfers.id, id), eq(schema.budgetTransfers.date, today()))).run();
  revalidatePath("/", "layout");
}

/** Où part le reste non dépensé d'une enveloppe à la fin d'un mois. */
export async function setCarryoverAction(month: string, categoryId: number, targetCategoryId: number) {
  await requireUser();
  db.insert(schema.carryovers)
    .values({ month, categoryId, targetCategoryId })
    .onConflictDoUpdate({ target: [schema.carryovers.month, schema.carryovers.categoryId], set: { targetCategoryId } })
    .run();
  revalidatePath("/", "layout");
}

/** Provision privée d'un membre (elle s'accumule de mois en mois). */
export async function addProvisionAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim();
  const amount = parseAmount(String(form.get("amount") ?? "")) ?? 0;
  if (!name) return { error: "Nom requis." };
  const last = db.select({ n: sql<number>`max(${schema.categories.sortOrder})` }).from(schema.categories)
    .where(eq(schema.categories.groupName, GROUP_LEISURE)).get();
  db.insert(schema.categories)
    .values({
      name: `${user.name} · ${name}`,
      icon: "🔒",
      color: "#8b5cf6",
      groupName: GROUP_LEISURE,
      rollover: "self",
      ownerUserId: user.id,
      budget: Math.max(0, amount),
      hint: `dépenses personnelles de ${user.name} : ${name}`,
      sortOrder: Number(last?.n ?? 100) + 1,
    })
    .run();
  if (!getSetting<string | null>("rules_start", null)) setSetting("rules_start", currentMonth());
  revalidatePath("/", "layout");
  return { ok: "Provision ajoutée." };
}

// ---------- Paiement en plusieurs fois ----------

export async function saveInstallmentAction(txId: number, opts: { count: number; total: number; tripDate?: string | null } | null) {
  await requireUser();
  const tx = db.select().from(schema.transactions).where(eq(schema.transactions.id, txId)).get();
  if (!tx) return;
  if (!opts) {
    const freed = deletePlanOf(txId);
    if (freed.length) await classifyTransactions(freed);
  } else {
    createPlan(tx, { count: Math.min(24, Math.max(2, Math.round(opts.count))), total: Math.round(opts.total), tripDate: opts.tripDate || null });
  }
  revalidatePath("/", "layout");
}

// ---------- À vérifier ----------

/** L'hypothèse était bonne : la catégorie devient un choix de la famille. */
export async function confirmGuessAction(txId: number) {
  await requireUser();
  db.update(schema.transactions).set({ classifiedBy: "user", aiConfidence: null }).where(eq(schema.transactions.id, txId)).run();
  db.update(schema.installmentPlans).set({ assumed: false }).where(eq(schema.installmentPlans.firstTransactionId, txId)).run();
  revalidatePath("/", "layout");
}

// ---------- Wishlist ----------

const validUrl = (u: string) => /^https?:\/\/[^\s]+$/i.test(u);

export async function addWishAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const url = String(form.get("url") ?? "").trim();
  if (!validUrl(url)) return { error: "Collez un lien http(s) vers la page du produit." };
  const categoryId = Number(form.get("categoryId")) || null;
  const last = db.select({ n: sql<number>`max(${schema.wishlistItems.rank})` }).from(schema.wishlistItems).get();
  const item = db
    .insert(schema.wishlistItems)
    .values({ title: sellerOf(url), categoryId, userId: user.id, rank: Number(last?.n ?? 0) + 1 })
    .returning()
    .get();
  const link = db.insert(schema.wishlistLinks).values({ itemId: item.id, url, seller: sellerOf(url) }).returning().get();
  await scrapeLink(link.id);
  revalidatePath("/wishlist");
  return { ok: "Ajouté." };
}

export async function addWishLinkAction(itemId: number, url: string): Promise<FormState> {
  await requireUser();
  url = url.trim();
  if (!validUrl(url)) return { error: "Lien http(s) attendu." };
  const link = db.insert(schema.wishlistLinks).values({ itemId, url, seller: sellerOf(url) }).returning().get();
  await scrapeLink(link.id);
  revalidatePath("/wishlist");
  revalidatePath("/verifier");
  return { ok: "Vendeur ajouté." };
}

export async function refreshWishLinkAction(linkId: number) {
  await requireUser();
  db.update(schema.wishlistLinks).set({ status: "pending" }).where(eq(schema.wishlistLinks.id, linkId)).run();
  await scrapeLink(linkId);
  revalidatePath("/wishlist");
  revalidatePath("/verifier");
}

export async function updateWishLinkAction(linkId: number, values: { price: number | null; shipping: number | null }) {
  await requireUser();
  db.update(schema.wishlistLinks)
    .set({ price: values.price, shipping: values.shipping, status: values.price == null ? "error" : "ok", error: null })
    .where(eq(schema.wishlistLinks.id, linkId))
    .run();
  revalidatePath("/wishlist");
  revalidatePath("/verifier");
}

export async function deleteWishLinkAction(linkId: number) {
  await requireUser();
  db.delete(schema.wishlistLinks).where(eq(schema.wishlistLinks.id, linkId)).run();
  revalidatePath("/wishlist");
}

export async function updateWishAction(id: number, values: { title?: string; note?: string | null; categoryId?: number | null; status?: string }) {
  await requireUser();
  const clean = { ...values, title: values.title?.trim() || undefined };
  db.update(schema.wishlistItems).set(clean).where(eq(schema.wishlistItems.id, id)).run();
  revalidatePath("/wishlist");
}

/** Déplace une envie dans l'ordre de priorité (-1 = plus prioritaire). */
export async function moveWishAction(id: number, direction: -1 | 1 | "top") {
  await requireUser();
  const items = db.select().from(schema.wishlistItems).orderBy(asc(schema.wishlistItems.rank), asc(schema.wishlistItems.id)).all();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [moved] = items.splice(i, 1);
  const to = direction === "top" ? 0 : Math.max(0, Math.min(items.length, i + direction));
  items.splice(to, 0, moved);
  db.transaction((t) => {
    items.forEach((x, k) => t.update(schema.wishlistItems).set({ rank: k + 1 }).where(eq(schema.wishlistItems.id, x.id)).run());
  });
  revalidatePath("/wishlist");
}

export async function deleteWishAction(id: number) {
  await requireUser();
  const item = db.select().from(schema.wishlistItems).where(eq(schema.wishlistItems.id, id)).get();
  if (!item) return;
  deleteItemImage(item);
  db.delete(schema.wishlistItems).where(eq(schema.wishlistItems.id, id)).run();
  revalidatePath("/wishlist");
}
