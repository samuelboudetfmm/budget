import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getSetting, setSetting } from "./settings";

export const SESSION_COOKIE = "budget_session";
// Les navigateurs plafonnent la durée d'un cookie à 400 jours : il est renouvelé à chaque visite (proxy.ts)
export const SESSION_MAX_AGE = 400 * 24 * 3600;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Code exigé pour créer le tout premier compte (évite qu'un inconnu le crée avant vous
 * sur l'URL publique). Affiché dans les logs et écrit dans DATA_DIR/setup-code.txt.
 */
export function setupCode(): string {
  let code = getSetting<string | null>("setup_code", null);
  if (!code) {
    code = crypto.randomInt(100000, 999999).toString();
    setSetting("setup_code", code);
  }
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  fs.writeFileSync(path.join(dataDir, "setup-code.txt"), `${code}\n`);
  console.log(`[setup] Code d'installation : ${code}`);
  return code;
}

export function hasUsers(): boolean {
  return Boolean(db.select({ id: schema.users.id }).from(schema.users).limit(1).get());
}

export async function createUser(email: string, name: string, password: string) {
  return db
    .insert(schema.users)
    .values({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      passwordHash: await bcrypt.hash(password, 12),
      ingestToken: newToken(24),
    })
    .returning()
    .get();
}

export async function verifyPassword(email: string, password: string) {
  const user = db.select().from(schema.users).where(eq(schema.users.email, email.trim().toLowerCase())).get();
  if (!user) {
    await bcrypt.hash(password, 12); // temps constant
    return null;
  }
  return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
}

/** Ouvre une session sans date d'expiration côté serveur (seule la déconnexion la ferme). */
export async function startSession(userId: number) {
  const token = newToken();
  const ua = (await headers()).get("user-agent");
  db.insert(schema.sessions).values({ id: hash(token), userId, userAgent: ua, lastSeenAt: new Date() }).run();
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) db.delete(schema.sessions).where(eq(schema.sessions.id, hash(token))).run();
  jar.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .select({ user: schema.users, session: schema.sessions })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, hash(token)))
    .get();
  if (!row) return null;
  if (Date.now() - row.session.lastSeenAt.getTime() > 3600_000) {
    db.update(schema.sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.sessions.id, row.session.id))
      .run();
  }
  return row.user;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect(hasUsers() ? "/login" : "/setup");
  return user;
}

/** Pour les webhooks du téléphone : jeton personnel en Bearer ou en ?token=. */
export function userFromIngestToken(token: string | null | undefined) {
  if (!token) return null;
  return db.select().from(schema.users).where(eq(schema.users.ingestToken, token)).get() ?? null;
}
