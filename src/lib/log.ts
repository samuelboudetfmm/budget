import { lt, sql } from "drizzle-orm";
import { db, schema } from "./db";

export function log(kind: string, message: string, level: "info" | "warn" | "error" = "info") {
  const line = `[${kind}] ${message}`;
  if (level === "error") console.error(line);
  else console.log(line);
  try {
    db.insert(schema.logs).values({ kind, level, message: message.slice(0, 2000) }).run();
    // Garde 30 jours d'historique
    db.delete(schema.logs)
      .where(lt(schema.logs.createdAt, sql`unixepoch() - 30 * 86400`))
      .run();
  } catch {
    // la journalisation ne doit jamais casser le traitement
  }
}
