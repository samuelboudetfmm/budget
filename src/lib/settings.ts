import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  const v = JSON.stringify(value);
  db.insert(schema.settings)
    .values({ key, value: v })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: v } })
    .run();
}

export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-5.5";

export function getModel(): string {
  return getSetting("llm_model", DEFAULT_MODEL);
}
