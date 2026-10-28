import Link from "next/link";
import { activeCategories } from "@/lib/classify";
import { currentMonth } from "@/lib/dates";
import { formatEUR } from "@/lib/money";
import { listTransactions } from "@/lib/queries";
import { MonthNav } from "@/components/MonthNav";
import { TxList } from "@/components/TxList";
import { ManualTxForm } from "@/components/ManualTxForm";

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const month = str("m") && /^\d{4}-\d{2}$/.test(str("m")!) ? str("m")! : currentMonth();
  const categoryId = Number(str("c")) || undefined;
  const unclassified = str("f") === "unclassified";
  const search = str("q")?.trim() || undefined;
  const openId = Number(str("tx")) || undefined;
  const categories = activeCategories();
  const txs = listTransactions({ month: search ? undefined : month, categoryId, unclassified, search });
  // Une opération ouverte depuis une notification peut être hors du mois affiché
  if (openId && !txs.some((t) => t.id === openId)) {
    const found = listTransactions({ limit: 2000 }).find((t) => t.id === openId);
    if (found) txs.unshift(found);
  }
  const cat = categories.find((c) => c.id === categoryId);
  const out = txs.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);
  const inc = txs.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const extra = `${categoryId ? `&c=${categoryId}` : ""}${unclassified ? "&f=unclassified" : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Opérations</h1>
        {!search && <MonthNav month={month} base="/transactions" extra={extra} />}
      </div>

      <form className="flex gap-2" action="/transactions">
        <input type="hidden" name="m" value={month} />
        <input className="input" name="q" placeholder="Rechercher un commerçant, un libellé…" defaultValue={search} />
        <select className="input w-auto" name="c" defaultValue={categoryId ?? ""}>
          <option value="">Toutes</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <button className="btn-ghost">OK</button>
      </form>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={`/transactions?m=${month}`} className={`rounded-full px-3 py-1 ${!unclassified && !categoryId ? "bg-accent-soft text-accent" : "bg-surface-2"}`}>
          Toutes
        </Link>
        <Link href={`/transactions?m=${month}&f=unclassified`} className={`rounded-full px-3 py-1 ${unclassified ? "bg-accent-soft text-accent" : "bg-surface-2"}`}>
          À classer
        </Link>
        {cat && <span className="rounded-full bg-accent-soft px-3 py-1 text-accent">{cat.icon} {cat.name}</span>}
        <Link href="/import" className="ml-auto rounded-full bg-surface-2 px-3 py-1">
          Importer un relevé
        </Link>
      </div>

      <div className="card">
        <div className="mb-2 flex justify-between text-xs text-muted">
          <span>{txs.length} opération(s)</span>
          <span className="tnum">
            {formatEUR(out)} · <span className="text-ok">+{formatEUR(inc)}</span>
          </span>
        </div>
        <TxList transactions={txs} categories={categories} openId={openId} />
      </div>

      <ManualTxForm />
    </div>
  );
}
