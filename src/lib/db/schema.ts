import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  // Jeton personnel utilisé par les raccourcis iPhone / MacroDroid Android
  ingestToken: text("ingest_token").notNull().unique(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable("sessions", {
  // sha256 du jeton stocké dans le cookie
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  createdAt: createdAt(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("📦"),
  color: text("color").notNull().default("#64748b"),
  // expense | income | savings | transfer
  kind: text("kind").notNull().default("expense"),
  // Budget mensuel par défaut, en centimes (positif)
  budget: integer("budget").notNull().default(0),
  // Indication pour l'IA (ex : "supermarché alimentaire uniquement")
  hint: text("hint"),
  // Identifiant stable des enveloppes par défaut (alimentaire, vetements…)
  code: text("code").unique(),
  // Regroupement à l'affichage (ex : "Factures mensuelles")
  groupName: text("group_name"),
  // monthly : tout le budget est disponible le 1er | daily : il se débloque jour après jour
  accrual: text("accrual").notNull().default("monthly"),
  // Enveloppe dans laquelle on n'a pas le droit de puiser pour couvrir un dépassement
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  // default : le reste du mois part sur l'enveloppe choisie (vêtements/jouets par défaut) | self : il s'accumule (provision)
  rollover: text("rollover").notNull().default("default"),
  // Provision privée d'un membre
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const budgetOverrides = sqliteTable(
  "budget_overrides",
  {
    month: text("month").notNull(), // YYYY-MM
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.month, t.categoryId] })],
);

export const bankSessions = sqliteTable("bank_sessions", {
  id: text("id").primaryKey(), // session_id Enable Banking
  aspspName: text("aspsp_name").notNull(),
  aspspCountry: text("aspsp_country").notNull(),
  validUntil: integer("valid_until", { mode: "timestamp" }),
  createdAt: createdAt(),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // enablebanking | manual
  source: text("source").notNull().default("manual"),
  externalId: text("external_id").unique(),
  bankSessionId: text("bank_session_id").references(() => bankSessions.id, { onDelete: "set null" }),
  iban: text("iban"),
  currency: text("currency").notNull().default("EUR"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  lastSyncError: text("last_sync_error"),
  createdAt: createdAt(),
});

export const emails = sqliteTable("emails", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: text("message_id").notNull().unique(),
  fromAddr: text("from_addr"),
  subject: text("subject"),
  receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
  body: text("body").notNull(),
  // pending | parsed | matched | ignored | error
  status: text("status").notNull().default("pending"),
  // JSON : { merchant, total, date, items: [{ label, amount, categoryId }] }
  extracted: text("extracted"),
  error: text("error"),
  createdAt: createdAt(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    date: text("date").notNull(), // YYYY-MM-DD
    // Montant signé en centimes : négatif = dépense
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("EUR"),
    label: text("label").notNull(),
    merchant: text("merchant"),
    // pending | booked
    status: text("status").notNull().default("booked"),
    // bank | phone | import | manual
    source: text("source").notNull(),
    // rule | ai | email | user
    classifiedBy: text("classified_by"),
    aiConfidence: real("ai_confidence"),
    aiReason: text("ai_reason"),
    emailId: integer("email_id").references(() => emails.id, { onDelete: "set null" }),
    note: text("note"),
    // Échéance rattachée à un paiement en plusieurs fois
    installmentPlanId: integer("installment_plan_id"),
    notifiedAt: integer("notified_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("tx_account_external").on(t.accountId, t.externalId),
    index("tx_date").on(t.date),
  ],
);

export const splits = sqliteTable(
  "splits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    // Même signe que la transaction
    amount: integer("amount").notNull(),
    note: text("note"),
  },
  (t) => [index("splits_tx").on(t.transactionId), index("splits_cat").on(t.categoryId)],
);

export const merchantRules = sqliteTable("merchant_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  merchantKey: text("merchant_key").notNull().unique(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  // Commerçant multi-catégories (supermarché, Amazon…) : attendre un ticket
  multi: integer("multi", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
});

export const logs = sqliteTable("logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // phone | email | bank | ai | push
  kind: text("kind").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  createdAt: createdAt(),
});

/** Report d'un budget vers un autre (couverture d'un dépassement). */
export const budgetTransfers = sqliteTable(
  "budget_transfers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(), // YYYY-MM-DD, jour où le report prend effet
    fromCategoryId: integer("from_category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    toCategoryId: integer("to_category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(), // centimes, positif
    note: text("note"),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("transfers_date").on(t.date)],
);

/** Destination choisie pour le reste non dépensé d'une enveloppe à la fin d'un mois. */
export const carryovers = sqliteTable(
  "carryovers",
  {
    month: text("month").notNull(), // mois qui se termine
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    targetCategoryId: integer("target_category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.month, t.categoryId] })],
);

/** Paiement en plusieurs fois : compté en totalité le mois de l'achat (sauf vacances à venir). */
export const installmentPlans = sqliteTable("installment_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  firstTransactionId: integer("first_transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  // Opération virtuelle qui porte le reste du montant total
  complementTransactionId: integer("complement_transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  merchantKey: text("merchant_key").notNull(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  count: integer("count").notNull(),
  total: integer("total").notNull(), // centimes, positif
  installment: integer("installment").notNull(), // centimes, positif
  // upfront : tout compte le mois de l'achat | parts : chaque échéance compte quand elle est payée (vacances à venir)
  mode: text("mode").notNull().default("upfront"),
  tripDate: text("trip_date"),
  // Détecté automatiquement : nombre d'échéances et total supposés
  assumed: integer("assumed", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const wishlistItems = sqliteTable("wishlist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  note: text("note"),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  // Ordre de priorité (1 = le plus prioritaire)
  rank: integer("rank").notNull().default(0),
  // wanted | bought
  status: text("status").notNull().default("wanted"),
  // Fichier dans DATA_DIR/wishlist
  image: text("image"),
  createdAt: createdAt(),
});

/** Un lien vendeur d'une envie (le premier ajouté + les vendeurs alternatifs). */
export const wishlistLinks = sqliteTable("wishlist_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => wishlistItems.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  seller: text("seller").notNull(),
  title: text("title"),
  price: integer("price"), // centimes
  shipping: integer("shipping"), // centimes ; null = inconnu
  // pending | ok | error
  status: text("status").notNull().default("pending"),
  error: text("error"),
  checkedAt: integer("checked_at", { mode: "timestamp" }),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Split = typeof splits.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type InstallmentPlan = typeof installmentPlans.$inferSelect;
export type WishlistItem = typeof wishlistItems.$inferSelect;
export type WishlistLink = typeof wishlistLinks.$inferSelect;
