import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import type { WishlistItem, WishlistLink } from "./db/schema";
import { askJSON, aiConfigured } from "./ai";
import { log } from "./log";

const SCRAPER_URL = process.env.SCRAPER_URL ?? "http://localhost:8341";

export const imageDir = () => path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "wishlist");

type Scraped = {
  title: string | null;
  price: number | null; // euros
  shipping: number | null;
  currency: string | null;
  imageBase64: string | null;
  imageType: string | null;
  text: string;
  finalUrl: string;
  blocked?: boolean;
};

export function sellerOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const cents = (euros: number | null | undefined) => (euros == null || !Number.isFinite(euros) ? null : Math.round(euros * 100));

/** Total livraison incluse (livraison inconnue comptée 0 € : hypothèse signalée dans « À vérifier »). */
export const linkTotal = (l: WishlistLink) => (l.price == null ? null : l.price + (l.shipping ?? 0));

export function bestLink(links: WishlistLink[]): WishlistLink | undefined {
  return links
    .filter((l) => linkTotal(l) != null)
    .sort((a, b) => linkTotal(a)! - linkTotal(b)!)[0];
}

/** Ouvre le lien dans Chromium (service scraper), complète au besoin avec l'IA à partir du texte de la page. */
export async function scrapeLink(linkId: number) {
  const link = db.select().from(schema.wishlistLinks).where(eq(schema.wishlistLinks.id, linkId)).get();
  if (!link) return;
  try {
    const res = await fetch(`${SCRAPER_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: link.url }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json()) as Scraped & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `scraper ${res.status}`);
    if (data.blocked) throw new Error("Ce site refuse la lecture automatique : saisissez le prix à la main");
    let { title, price, shipping } = data;
    if ((price == null || shipping == null) && aiConfigured() && data.text) {
      try {
        const ai = await askJSON<{ title?: string | null; price?: number | null; shipping?: number | null }>(
          [
            {
              role: "system",
              content: `Tu lis le texte d'une page produit d'un site marchand français.
Donne le nom court du produit, son prix TTC en euros et les frais de livraison standard en euros (0 si livraison gratuite, null si la page ne permet pas de le savoir).
Réponds uniquement en JSON : {"title":string|null,"price":number|null,"shipping":number|null}`,
            },
            { role: "user", content: `URL : ${data.finalUrl}\nTitre : ${title ?? ""}\n\n${data.text.slice(0, 6000)}` },
          ],
          { maxTokens: 200 },
        );
        price ??= ai.price ?? null;
        shipping ??= ai.shipping ?? null;
        title ??= ai.title ?? null;
      } catch (e) {
        log("ai", `Wishlist : extraction IA impossible (${(e as Error).message})`, "warn");
      }
    }
    db.update(schema.wishlistLinks)
      .set({
        title: title?.trim().slice(0, 200) || null,
        price: cents(price),
        shipping: cents(shipping),
        status: price == null ? "error" : "ok",
        error: price == null ? "Prix introuvable sur la page" : null,
        checkedAt: new Date(),
      })
      .where(eq(schema.wishlistLinks.id, link.id))
      .run();
    const item = db.select().from(schema.wishlistItems).where(eq(schema.wishlistItems.id, link.itemId)).get();
    if (item && data.imageBase64 && !item.image) saveImage(item, data.imageBase64, data.imageType);
    // Titre par défaut = celui de la première page lue
    if (item && title && item.title === sellerOf(link.url)) {
      db.update(schema.wishlistItems).set({ title: title.trim().slice(0, 120) }).where(eq(schema.wishlistItems.id, item.id)).run();
    }
  } catch (e) {
    db.update(schema.wishlistLinks)
      .set({ status: "error", error: (e as Error).message.slice(0, 300), checkedAt: new Date() })
      .where(eq(schema.wishlistLinks.id, link.id))
      .run();
    log("app", `Wishlist : lecture de ${link.url} impossible (${(e as Error).message})`, "warn");
  }
}

function saveImage(item: WishlistItem, base64: string, type: string | null) {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "jpg";
  const file = `${item.id}.${ext}`;
  fs.mkdirSync(imageDir(), { recursive: true });
  fs.writeFileSync(path.join(imageDir(), file), Buffer.from(base64, "base64"));
  db.update(schema.wishlistItems).set({ image: file }).where(eq(schema.wishlistItems.id, item.id)).run();
}

export function deleteItemImage(item: WishlistItem) {
  if (item.image) fs.rmSync(path.join(imageDir(), path.basename(item.image)), { force: true });
}

export type WishWithLinks = WishlistItem & { links: WishlistLink[]; best?: WishlistLink; bestTotal: number | null };

export function listWishes(): WishWithLinks[] {
  const items = db.select().from(schema.wishlistItems).orderBy(asc(schema.wishlistItems.rank), asc(schema.wishlistItems.id)).all();
  const links = db.select().from(schema.wishlistLinks).orderBy(asc(schema.wishlistLinks.id)).all();
  return items.map((i) => {
    const own = links.filter((l) => l.itemId === i.id);
    const best = bestLink(own);
    return { ...i, links: own, best, bestTotal: best ? linkTotal(best) : null };
  });
}
