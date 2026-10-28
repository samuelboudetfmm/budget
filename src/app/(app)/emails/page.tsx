import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import { imapConfigured, imapState } from "@/lib/imap";
import { RetryEmailButton } from "@/components/SmallButtons";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "En analyse", cls: "bg-surface-2 text-muted" },
  parsed: { label: "En attente du débit", cls: "bg-amber-500/15 text-warn" },
  matched: { label: "Rattaché", cls: "bg-accent-soft text-accent" },
  ignored: { label: "Sans achat", cls: "bg-surface-2 text-muted" },
  error: { label: "Erreur", cls: "bg-danger-soft text-danger" },
};

export default function EmailsPage() {
  const emails = db.select().from(schema.emails).orderBy(desc(schema.emails.receivedAt)).limit(100).all();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tickets &amp; commandes</h1>
      <div className="card text-sm text-muted">
        {imapConfigured() ? (
          <p>
            Boîte <strong className="text-text">{process.env.IMAP_USER}</strong> :{" "}
            {imapState.connected ? <span className="text-ok">en écoute (IMAP IDLE)</span> : <span className="text-danger">déconnectée {imapState.lastError && `— ${imapState.lastError}`}</span>}.
            Transférez-y factures, tickets et confirmations de commande : chaque achat est détaillé ligne par ligne et réparti dans les bonnes catégories dès que le débit
            correspondant arrive.
          </p>
        ) : (
          <p>Aucune boîte mail configurée : renseignez IMAP_HOST, IMAP_USER et IMAP_PASSWORD dans .env (voir Réglages).</p>
        )}
      </div>
      <ul className="space-y-2">
        {emails.map((e) => {
          const ex = e.extracted ? (JSON.parse(e.extracted) as { merchant?: string; total?: number; items?: { label: string; amount: number }[] }) : null;
          const st = STATUS[e.status] ?? STATUS.pending;
          return (
            <li key={e.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.subject || "(sans objet)"}</p>
                  <p className="truncate text-xs text-muted">
                    {e.fromAddr} · {e.receivedAt.toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
              </div>
              {ex?.total != null && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer">
                    {ex.merchant} · <span className="tnum font-medium">{formatEUR(Math.round(ex.total * 100))}</span> · {ex.items?.length ?? 0} ligne(s)
                  </summary>
                  <ul className="mt-2 space-y-0.5 text-xs text-muted">
                    {ex.items?.map((it, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">{it.label}</span>
                        <span className="tnum">{formatEUR(Math.round(it.amount * 100))}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {e.error && <p className="mt-1 text-xs text-danger">{e.error}</p>}
              {(e.status === "error" || e.status === "ignored") && <RetryEmailButton id={e.id} />}
            </li>
          );
        })}
        {!emails.length && <li className="py-8 text-center text-sm text-muted">Aucun mail reçu pour l&apos;instant.</li>}
      </ul>
    </div>
  );
}
