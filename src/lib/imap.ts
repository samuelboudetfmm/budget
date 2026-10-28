import { ImapFlow } from "imapflow";
import { getSetting, setSetting } from "./settings";
import { receiveEmail } from "./email";
import { log } from "./log";

export function imapConfigured(): boolean {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
}

export const imapState = { connected: false, lastError: null as string | null, lastEventAt: null as Date | null };

/**
 * Écoute la boîte mail en IMAP IDLE : le serveur prévient dès qu'un mail arrive,
 * sans toucher à la configuration du serveur mail.
 */
export function startImapWorker() {
  if (!imapConfigured()) return;
  const mailbox = process.env.IMAP_MAILBOX || "INBOX";
  let delay = 5_000;

  const run = async () => {
    const client = new ImapFlow({
      host: process.env.IMAP_HOST!,
      port: Number(process.env.IMAP_PORT || 993),
      secure: (process.env.IMAP_TLS ?? "true") !== "false",
      auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
      logger: false,
      tls: { rejectUnauthorized: process.env.IMAP_TLS_INSECURE !== "true" },
    });
    let busy = false;
    let again = false;

    const fetchNew = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        do {
          again = false;
          const lastUid = getSetting<number>("imap_last_uid", 0);
          const raws: { uid: number; source: Buffer }[] = [];
          for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
            if (msg.uid > lastUid && msg.source) raws.push({ uid: msg.uid, source: msg.source });
          }
          for (const { uid, source } of raws) {
            try {
              await receiveEmail({ raw: source });
            } catch (e) {
              log("email", `Mail UID ${uid} illisible : ${(e as Error).message}`, "error");
            }
            setSetting("imap_last_uid", uid);
          }
          imapState.lastEventAt = new Date();
        } while (again);
      } finally {
        busy = false;
      }
    };

    client.on("exists", () => {
      fetchNew().catch((e) => log("email", `IMAP : ${(e as Error).message}`, "error"));
    });
    client.on("error", (e: Error) => {
      imapState.lastError = e.message;
    });

    try {
      await client.connect();
      await client.mailboxOpen(mailbox);
      imapState.connected = true;
      imapState.lastError = null;
      delay = 5_000;
      log("email", `IMAP connecté à ${process.env.IMAP_USER} (${mailbox}), en écoute`);
      await fetchNew();
      // imapflow passe automatiquement en IDLE quand il n'a rien à faire
      await new Promise<void>((resolve) => client.on("close", () => resolve()));
    } catch (e) {
      imapState.lastError = (e as Error).message;
      log("email", `IMAP : ${(e as Error).message}`, "error");
    } finally {
      imapState.connected = false;
      try {
        client.close();
      } catch {}
    }
    setTimeout(run, delay);
    delay = Math.min(delay * 2, 5 * 60_000);
  };

  run();
}
