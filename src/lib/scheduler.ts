import { startImapWorker } from "./imap";
import { syncAll, bankConfigured } from "./enablebanking";
import { classifyPending } from "./classify";
import { remindDeferred, vapidKeys } from "./push";
import { today } from "./dates";
import { log } from "./log";
import { getSetting, setSetting } from "./settings";

const g = globalThis as unknown as { __budgetScheduler?: boolean };

// La DSP2 limite les accès sans action de l'utilisateur à 4 par jour et par compte
const BANK_SYNC_INTERVAL = 6 * 3600_000;

export function startBackgroundJobs() {
  if (g.__budgetScheduler) return;
  g.__budgetScheduler = true;
  vapidKeys();
  startImapWorker();
  // Vérifie toutes les 10 min s'il est temps de synchroniser (survit aux redémarrages)
  const maybeSync = () => {
    if (!bankConfigured()) return;
    const last = getSetting<number>("bank_last_auto_sync", 0);
    if (Date.now() - last < BANK_SYNC_INTERVAL) return;
    setSetting("bank_last_auto_sync", Date.now());
    syncAll().catch((e) => log("bank", (e as Error).message, "error"));
  };
  setTimeout(maybeSync, 30_000);
  setInterval(maybeSync, 10 * 60_000);
  // Chaque matin à partir de 8 h : rappel des dépenses repoussées faute de report
  const maybeRemind = () => {
    const hour = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Paris" }).format(new Date()));
    if (hour < 8 || getSetting("deferred_reminder_day", "") === today()) return;
    setSetting("deferred_reminder_day", today());
    remindDeferred().catch((e) => log("push", (e as Error).message, "error"));
  };
  setInterval(maybeRemind, 10 * 60_000);
  setInterval(() => classifyPending().catch((e) => log("ai", (e as Error).message, "error")), 15 * 60_000);
  log("app", "Tâches de fond démarrées");
}
