// Petit service HTTP interne : ouvre une page produit dans Chromium et en extrait titre, image, prix et livraison.
// POST /scrape {"url": "..."} → {title, price, shipping, currency, imageBase64, imageType, text, finalUrl}
import http from "node:http";
import { chromium } from "playwright-core";

const PORT = Number(process.env.PORT ?? 3000);

let browserPromise;
function browser() {
  browserPromise ??= chromium.launch().catch((e) => {
    browserPromise = undefined;
    throw e;
  });
  return browserPromise;
}

// Pages de blocage / d'erreur : rien à extraire, la famille saisira le prix à la main
const BLOCKED = /^(?:un instant|just a moment|attention required|access denied|accès refusé|toutes nos excuses|.*maintenance|.*captcha)/i;

const CONSENT = [
  "#onetrust-accept-btn-handler",
  "#sp-cc-accept",
  "#didomi-notice-agree-button",
  "#axeptio_btn_acceptAll",
  "button#accept-all",
  "[data-testid='uc-accept-all-button']",
  "button:has-text('Tout accepter')",
  "button:has-text('Accepter et fermer')",
  "button:has-text('Accepter')",
  "button:has-text('J\\'accepte')",
  "button:has-text('Accept all')",
];

/** Exécuté dans la page : JSON-LD Product, balises meta, sélecteurs Amazon, puis texte visible. */
function extract() {
  const num = (v) => {
    if (v == null) return null;
    if (typeof v === "number") return v;
    let s = String(v).replace(/[\s  €$£]|EUR/gi, "");
    const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
    s = c > d ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  const out = { title: null, price: null, shipping: null, currency: null, image: null };
  const products = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const t = [].concat(n["@type"] ?? []);
    if (t.includes("Product") || t.includes("ProductGroup")) products.push(n);
    if (n["@graph"]) walk(n["@graph"]);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(s.textContent));
    } catch {}
  }
  const p = products[0];
  if (p) {
    out.title = p.name ?? null;
    const img = [].concat(p.image ?? [])[0];
    out.image = typeof img === "string" ? img : (img?.url ?? img?.contentUrl ?? null);
    const offers = [].concat(p.offers ?? (p.hasVariant?.[0]?.offers ?? []));
    const o = offers.flatMap((x) => (x?.offers ? [].concat(x.offers) : [x]))[0];
    if (o) {
      out.price = num(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
      out.currency = o.priceCurrency ?? null;
      const ship = [].concat(o.shippingDetails ?? [])[0]?.shippingRate;
      if (ship?.value != null) out.shipping = num(ship.value);
    }
  }
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") ?? null;
  out.title ??= meta('meta[property="og:title"]') ?? document.title;
  out.image ??= meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');
  out.price ??= num(meta('meta[property="product:price:amount"]') ?? meta('meta[property="og:price:amount"]') ?? meta('[itemprop="price"]'));
  out.price ??= num(document.querySelector('[itemprop="price"]')?.textContent);
  // Amazon
  const az = document.querySelector("#productTitle");
  if (az) {
    out.title = az.textContent.trim();
    const im = document.querySelector("#landingImage, #imgBlkFront");
    out.image = im?.getAttribute("data-old-hires") || im?.getAttribute("src") || out.image;
    const pr = document.querySelector(
      "#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, #apex_desktop .a-offscreen, #price_inside_buybox",
    );
    if (pr) out.price = num(pr.textContent);
    const del = document.querySelector("#mir-layout-DELIVERY_BLOCK, #deliveryBlockMessage")?.textContent ?? "";
    if (/gratuite|free/i.test(del)) out.shipping = 0;
    else {
      const m = del.match(/(\d+[.,]\d{2})\s?€/);
      if (m) out.shipping = num(m[1]);
    }
  }
  const text = document.body?.innerText?.replace(/\n{2,}/g, "\n").slice(0, 8000) ?? "";
  if (out.shipping == null) {
    if (/livraison (?:offerte|gratuite|incluse)|frais de port (?:offerts|gratuits)|free (?:shipping|delivery)/i.test(text)) out.shipping = 0;
    else {
      const m = text.match(/(?:livraison|frais de port|exp[ée]dition)[^\n€]{0,40}?(\d+[.,]\d{2})\s?€/i);
      if (m) out.shipping = num(m[1]);
    }
  }
  if (out.image && out.image.startsWith("//")) out.image = location.protocol + out.image;
  if (out.image) out.image = new URL(out.image, location.href).href;
  return { ...out, text };
}

async function scrape(url) {
  const b = await browser();
  const context = await b.newContext({
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6" },
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const status = response?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    for (const sel of CONSENT) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
        await btn.click({ timeout: 1_500 }).catch(() => {});
        await page.waitForTimeout(500);
        break;
      }
    }
    const data = await page.evaluate(extract);
    if (data.price == null && (status >= 400 || BLOCKED.test((data.title ?? "").trim()))) {
      return { blocked: true, title: null, price: null, shipping: null, text: "", finalUrl: page.url(), imageBase64: null, imageType: null };
    }
    let imageBase64 = null;
    let imageType = null;
    if (data.image) {
      const res = await context.request.get(data.image, { headers: { Referer: page.url() }, timeout: 15_000 }).catch(() => null);
      const type = res?.headers()["content-type"] ?? "";
      if (res?.ok() && type.startsWith("image/")) {
        imageBase64 = (await res.body()).toString("base64");
        imageType = type.split(";")[0];
      }
    }
    if (!imageBase64) {
      // Pas d'image exploitable : capture du haut de la page
      imageBase64 = (await page.screenshot({ type: "jpeg", quality: 70 })).toString("base64");
      imageType = "image/jpeg";
    }
    return { ...data, finalUrl: page.url(), imageBase64, imageType };
  } finally {
    await context.close();
  }
}

http
  .createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
    if (req.method !== "POST" || req.url !== "/scrape") return send(404, { error: "not found" });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const { url } = JSON.parse(raw);
      if (!/^https?:\/\//i.test(url ?? "")) return send(400, { error: "URL http(s) attendue" });
      send(200, await scrape(url));
    } catch (e) {
      send(500, { error: e.message });
    }
  })
  .listen(PORT, () => console.log(`scraper prêt sur :${PORT}`));
