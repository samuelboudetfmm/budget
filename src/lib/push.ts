import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getSetting, setSetting } from "./settings";
import { monthSummary } from "./budget";
import { computeEnvelopes } from "./envelopes";
import { formatEUR } from "./money";
import { log } from "./log";

type Vapid = { publicKey: string; privateKey: string };

/** Clés VAPID générées au premier lancement et conservées en base. */
export function vapidKeys(): Vapid {
  let keys = getSetting<Vapid | null>("vapid", null);
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    setSetting("vapid", keys);
  }
  return keys;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

export async function sendToAll(payload: PushPayload) {
  const keys = vapidKeys();
  const appUrl = process.env.APP_URL ?? "";
  // Les services push exigent un sujet https: ou mailto:
  const subject = appUrl.startsWith("https://") ? appUrl : "https://budget.samuelboudet.com";
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  const subs = db.select().from(schema.pushSubscriptions).all();
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 24 * 3600, urgency: "high" },
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id)).run();
        } else {
          log("push", `Échec d'envoi (${status ?? "?"}) : ${(e as Error).message}`, "warn");
        }
      }
    }),
  );
}

/** Notification "dépense + reste du budget" pour une transaction. */
export async function notifyTransaction(txId: number) {
  const tx = db.select().from(schema.transactions).where(eq(schema.transactions.id, txId)).get();
  if (!tx || tx.notifiedAt || tx.amount >= 0) return;
  db.update(schema.transactions).set({ notifiedAt: new Date() }).where(eq(schema.transactions.id, txId)).run();

  const parts = db
    .select({ id: schema.splits.id, amount: schema.splits.amount, categoryId: schema.splits.categoryId })
    .from(schema.splits)
    .where(eq(schema.splits.transactionId, txId))
    .all()
    .sort((a, b) => a.amount - b.amount);
  const who = tx.merchant || tx.label;
  const lines: string[] = [];
  if (!parts.length) {
    lines.push("Catégorie à confirmer.");
  }
  const envelopes = computeEnvelopes();
  const summary = monthSummary(undefined, envelopes);
  const deferred = new Set(envelopes.deferred.map((d) => d.splitId));
  let blocked = false;
  for (const p of parts.slice(0, 3)) {
    const l = summary.lines.find((x) => x.id === p.categoryId);
    if (!l) continue;
    const amount = parts.length > 1 ? ` (${formatEUR(-p.amount)})` : "";
    const env = l.envelope;
    if (l.kind !== "expense") {
      lines.push(`${l.icon} ${l.name}`);
    } else if (deferred.has(p.id)) {
      blocked = true;
      const d = envelopes.deferred.find((x) => x.splitId === p.id)!;
      lines.push(
        `⛔ ${l.icon} ${l.name}${amount} : il manque ${formatEUR(d.missing)}. Dépense reportée à demain — choisissez sur quoi reporter.`,
      );
    } else if (env) {
      lines.push(
        `${l.icon} ${l.name}${amount} : reste ${formatEUR(env.remainingToday)}${
          env.dailyRate ? ` aujourd'hui (+${formatEUR(env.dailyRate)}/jour)` : ` / ${formatEUR(env.monthAvailable)}`
        }`,
      );
    } else if (l.budgetAmount > 0) {
      const over = l.remaining < 0;
      lines.push(
        `${l.icon} ${l.name}${amount} : ${over ? `dépassé de ${formatEUR(-l.remaining)}` : `reste ${formatEUR(l.remaining)}`} / ${formatEUR(l.budgetAmount)}`,
      );
    } else {
      lines.push(`${l.icon} ${l.name} : ${formatEUR(l.spent)} ce mois (pas de budget)`);
    }
  }
  if (summary.totalBudget > 0 && !blocked) {
    lines.push(
      summary.remaining >= 0
        ? `Budget du mois : reste ${formatEUR(summary.remaining)} (${summary.daysLeft} j)`
        : `Budget du mois dépassé de ${formatEUR(-summary.remaining)}`,
    );
  }
  await sendToAll({
    title: `${blocked ? "⛔ " : ""}${formatEUR(tx.amount)} · ${who}`,
    body: lines.join("\n"),
    url: blocked ? "/#depassements" : `/transactions?tx=${tx.id}`,
    tag: `tx-${tx.id}`,
  });
}

/** Rappel quotidien des dépenses en attente de report. */
export async function remindDeferred() {
  const { deferred } = computeEnvelopes();
  const waiting = deferred.filter((d) => d.coveredInDays == null);
  if (!waiting.length) return;
  const total = waiting.reduce((a, d) => a + d.missing, 0);
  await sendToAll({
    title: `⛔ ${waiting.length} dépense(s) en attente de report`,
    body: `Il manque ${formatEUR(total)}. Tant que le report n'est pas fait, elles sont repoussées au lendemain.`,
    url: "/#depassements",
    tag: "deferred",
  });
}
