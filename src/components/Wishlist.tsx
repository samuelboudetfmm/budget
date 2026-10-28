"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WishWithLinks } from "@/lib/wishlist";
import { formatEUR, parseAmount } from "@/lib/money";
import {
  addWishAction,
  addWishLinkAction,
  deleteWishAction,
  deleteWishLinkAction,
  moveWishAction,
  refreshWishLinkAction,
  updateWishAction,
  updateWishLinkAction,
} from "@/app/actions";

type Cat = { id: number; name: string; icon: string; free: number; dailyRate: number };
type Sort = "priority" | "price" | "recent";

const total = (l: { price: number | null; shipping: number | null }) => (l.price == null ? null : l.price + (l.shipping ?? 0));

export function Wishlist({
  items,
  categories,
  defaultCategoryId,
  openId,
}: {
  items: WishWithLinks[];
  categories: Cat[];
  defaultCategoryId: number | null;
  openId?: number;
}) {
  const [sort, setSort] = useState<Sort>("priority");
  const [showBought, setShowBought] = useState(false);
  const [open, setOpen] = useState<number | null>(openId ?? null);
  const [state, action, adding] = useActionState(addWishAction, undefined);

  const list = useMemo(() => {
    const l = items.filter((i) => (showBought ? i.status === "bought" : i.status !== "bought"));
    if (sort === "price") return [...l].sort((a, b) => (a.bestTotal ?? Infinity) - (b.bestTotal ?? Infinity));
    if (sort === "recent") return [...l].sort((a, b) => b.id - a.id);
    return l;
  }, [items, sort, showBought]);
  const current = items.find((i) => i.id === open);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Wishlist</h1>
        <div className="flex gap-1 text-sm">
          {(["priority", "price", "recent"] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={`rounded-full px-3 py-1 ${sort === s ? "bg-accent-soft text-accent" : "bg-surface-2"}`}>
              {s === "priority" ? "Priorité" : s === "price" ? "Prix" : "Récents"}
            </button>
          ))}
          <button onClick={() => setShowBought((v) => !v)} className={`rounded-full px-3 py-1 ${showBought ? "bg-accent-soft text-accent" : "bg-surface-2"}`}>
            Achetés
          </button>
        </div>
      </div>

      <form action={action} className="card flex flex-wrap gap-2">
        <input className="input w-full sm:w-auto sm:min-w-0 sm:flex-[3]" name="url" type="url" required placeholder="Coller le lien d'un produit…" />
        <select className="input w-auto flex-1" name="categoryId" defaultValue={defaultCategoryId ?? ""}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <button className="btn-primary" disabled={adding}>
          {adding ? "Lecture de la page…" : "Ajouter"}
        </button>
        {state?.error && <p className="w-full text-sm text-danger">{state.error}</p>}
      </form>

      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{showBought ? "Rien d'acheté pour l'instant." : "Aucune envie. Collez un lien ci-dessus."}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((i) => (
            <li key={i.id}>
              <button onClick={() => setOpen(i.id)} className="relative block aspect-square w-full overflow-hidden rounded-2xl border border-border bg-surface-2 text-left">
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/wishlist/image/${i.id}?v=${encodeURIComponent(i.image)}`} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-4xl">{i.links.some((l) => l.status === "pending") ? "⏳" : "🎁"}</span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-2.5 pt-8 text-white">
                  <span className="line-clamp-2 text-sm font-medium leading-tight">{i.title}</span>
                  <span className="tnum mt-0.5 block text-base font-bold">{i.bestTotal != null ? formatEUR(i.bestTotal) : "Prix ?"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {current && <WishSheet item={current} categories={categories} onClose={() => setOpen(null)} />}
    </div>
  );
}

function WishSheet({ item, categories, onClose }: { item: WishWithLinks; categories: Cat[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note ?? "");
  const [newUrl, setNewUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const cat = categories.find((c) => c.id === item.categoryId);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  // Dans le budget aujourd'hui ? Sinon, combien de jours de déblocage (Libre)
  let budgetInfo: string | null = null;
  if (cat && item.bestTotal != null) {
    if (cat.free >= item.bestTotal) budgetInfo = `✓ Rentre aujourd'hui dans ${cat.name} (libre ${formatEUR(cat.free)})`;
    else if (cat.dailyRate > 0) budgetInfo = `Rentre dans ${cat.name} dans ~${Math.ceil((item.bestTotal - cat.free) / cat.dailyRate)} j (libre ${formatEUR(cat.free)}, +${formatEUR(cat.dailyRate)}/jour)`;
    else budgetInfo = `Il manque ${formatEUR(item.bestTotal - cat.free)} dans ${cat.name}`;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          {item.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/wishlist/image/${item.id}?v=${encodeURIComponent(item.image)}`} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <input className="input py-1.5 font-semibold" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== item.title && run(() => updateWishAction(item.id, { title }))} />
            <p className="tnum text-lg font-bold">{item.bestTotal == null
                ? "Prix inconnu"
                : `${formatEUR(item.bestTotal)} ${item.best?.shipping == null ? "+ livraison ?" : "livraison incluse"}`}</p>
          </div>
        </div>
        {budgetInfo && <p className="mt-2 rounded-xl bg-surface-2 p-2 text-xs">{budgetInfo}</p>}

        <h3 className="mt-4 mb-1 text-sm font-semibold">Vendeurs</h3>
        <ul className="divide-y divide-border">
          {item.links.map((l) => (
            <LinkRow key={l.id} link={l} best={l.id === item.best?.id} pending={pending} run={run} />
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input className="input py-1.5" type="url" placeholder="Lien vers un vendeur alternatif" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
          <button
            className="btn-ghost shrink-0 px-3 py-1.5"
            disabled={pending || !newUrl}
            onClick={() =>
              run(async () => {
                const res = await addWishLinkAction(item.id, newUrl);
                setMsg(res?.error ?? null);
                if (!res?.error) setNewUrl("");
              })
            }
          >
            {pending ? "…" : "Ajouter"}
          </button>
        </div>
        {msg && <p className="mt-1 text-xs text-danger">{msg}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="col-span-2 sm:col-span-1">
            <span className="label">Budget</span>
            <select className="input py-1.5" value={item.categoryId ?? ""} onChange={(e) => run(() => updateWishAction(item.id, { categoryId: Number(e.target.value) || null }))}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="col-span-2 sm:col-span-1">
            <span className="label">Priorité</span>
            <div className="flex gap-1">
              <button className="btn-ghost flex-1 px-2 py-1.5" disabled={pending} onClick={() => run(() => moveWishAction(item.id, "top"))} title="En premier">⤒</button>
              <button className="btn-ghost flex-1 px-2 py-1.5" disabled={pending} onClick={() => run(() => moveWishAction(item.id, -1))} title="Monter">▲</button>
              <button className="btn-ghost flex-1 px-2 py-1.5" disabled={pending} onClick={() => run(() => moveWishAction(item.id, 1))} title="Descendre">▼</button>
            </div>
          </div>
        </div>
        <input className="input mt-2 py-1.5" placeholder="Note (taille, couleur…)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (item.note ?? "") && run(() => updateWishAction(item.id, { note: note || null }))} />

        <div className="mt-5 flex gap-2">
          <button className="btn-primary flex-1" disabled={pending} onClick={() => run(async () => { await updateWishAction(item.id, { status: item.status === "bought" ? "wanted" : "bought" }); onClose(); })}>
            {item.status === "bought" ? "Remettre dans les envies" : "✓ Acheté"}
          </button>
          <button className="btn-ghost" onClick={onClose}>Fermer</button>
        </div>
        <button
          className="mt-4 text-xs text-danger underline"
          disabled={pending}
          onClick={() => confirm("Supprimer cette envie ?") && run(async () => { await deleteWishAction(item.id); onClose(); })}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

function LinkRow({
  link: l,
  best,
  pending,
  run,
}: {
  link: WishWithLinks["links"][number];
  best: boolean;
  pending: boolean;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [price, setPrice] = useState(l.price != null ? (l.price / 100).toFixed(2).replace(".", ",") : "");
  const [shipping, setShipping] = useState(l.shipping != null ? (l.shipping / 100).toFixed(2).replace(".", ",") : "");
  const t = total(l);
  return (
    <li className="py-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent underline">
          {best && "⭐ "}
          {l.seller}
        </a>
        <span className="tnum shrink-0 font-semibold">{t != null ? formatEUR(t) : l.status === "pending" ? "…" : "?"}</span>
      </div>
      <p className="text-xs text-muted">
        {l.price != null && `${formatEUR(l.price)} + `}
        {l.shipping == null ? <span className="text-warn">livraison inconnue (comptée 0 €)</span> : l.shipping === 0 ? "livraison gratuite" : `${formatEUR(l.shipping)} de livraison`}
        {l.status === "error" && <span className="text-danger"> · {l.error}</span>}
      </p>
      {edit ? (
        <div className="mt-1 flex gap-2">
          <input className="input tnum py-1" inputMode="decimal" placeholder="Prix €" value={price} onChange={(e) => setPrice(e.target.value)} />
          <input className="input tnum py-1" inputMode="decimal" placeholder="Livraison €" value={shipping} onChange={(e) => setShipping(e.target.value)} />
          <button
            className="btn-ghost shrink-0 px-2 py-1"
            disabled={pending}
            onClick={() => {
              setEdit(false);
              run(() => updateWishLinkAction(l.id, { price: parseAmount(price), shipping: shipping.trim() === "" ? null : parseAmount(shipping) }));
            }}
          >
            OK
          </button>
        </div>
      ) : (
        <div className="mt-1 flex gap-3 text-xs">
          <button className="text-muted underline" disabled={pending} onClick={() => run(() => refreshWishLinkAction(l.id))}>Relire la page</button>
          <button className="text-muted underline" onClick={() => setEdit(true)}>Corriger le prix</button>
          <button className="text-danger underline" disabled={pending} onClick={() => run(() => deleteWishLinkAction(l.id))}>Retirer</button>
        </div>
      )}
    </li>
  );
}
