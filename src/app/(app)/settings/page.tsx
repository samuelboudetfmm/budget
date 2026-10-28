import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { aiConfigured } from "@/lib/ai";
import { activeCategories } from "@/lib/classify";
import { bankConfigured } from "@/lib/enablebanking";
import { imapConfigured, imapState } from "@/lib/imap";
import { getModel } from "@/lib/settings";
import { PushToggle } from "@/components/PushToggle";
import { AddMemberForm, BankConnect, CategoryForm, CopyField, ModelForm, SyncButton } from "@/components/SettingsForms";
import {
  ArchiveCategoryButton,
  ClassifyPendingButton,
  DeleteAccountButton,
  DeleteRuleButton,
  LogoutButton,
  RegenerateTokenButton,
} from "@/components/SmallButtons";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20 space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const sp = await searchParams;
  const appUrl = process.env.APP_URL || "https://budget.samuelboudet.com";
  const webhook = `${appUrl}/api/ingest/phone?token=${user.ingestToken}`;
  const members = db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).all();
  const accounts = db.select().from(schema.accounts).all();
  const sessions = db.select().from(schema.bankSessions).all();
  const categories = activeCategories();
  const catName = new Map(categories.map((c) => [c.id, `${c.icon} ${c.name}`]));
  const rules = db.select().from(schema.merchantRules).orderBy(asc(schema.merchantRules.merchantKey)).all();
  const logs = db.select().from(schema.logs).orderBy(desc(schema.logs.id)).limit(40).all();
  const pushCount = db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, user.id)).all().length;
  const bankMsg = typeof sp.bank === "string" ? sp.bank : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Réglages</h1>

      <div className="flex gap-2 text-sm sm:hidden">
        <Link href="/verifier" className="btn-ghost flex-1">⚠️ À vérifier</Link>
        <Link href="/emails" className="btn-ghost flex-1">🧾 Tickets reçus</Link>
      </div>

      <Section title="Notifications">
        <p className="text-sm text-muted">À activer sur chaque téléphone ({pushCount} appareil(s) actif(s) pour vous).</p>
        <PushToggle />
      </Section>

      <Section id="telephone" title="Paiements en temps réel depuis le téléphone">
        <p className="text-sm text-muted">
          Chaque téléphone envoie ses paiements à l&apos;app dès qu&apos;ils ont lieu ; la banque confirme ensuite (jusqu&apos;à 4 fois par jour) et les doublons
          sont fusionnés automatiquement. Chaque membre utilise son propre lien (connectez-vous avec son compte pour voir le sien).
        </p>
        <CopyField label={`Lien personnel de ${user.name} (secret)`} value={webhook} />
        <RegenerateTokenButton />
        <details className="rounded-xl bg-surface-2 p-3 text-sm">
          <summary className="cursor-pointer font-medium">📱 iPhone (Apple Pay) — app Raccourcis</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>App <strong>Raccourcis</strong> → onglet <strong>Automatisation</strong> → <strong>+</strong> → <strong>Transaction</strong>.</li>
            <li>Choisissez vos cartes Wallet, cochez « Lors du paiement », puis <strong>Exécuter immédiatement</strong>.</li>
            <li>Nouveau raccourci vide → action <strong>Obtenir le contenu de l&apos;URL</strong> : collez le lien ci-dessus.</li>
            <li>
              Touchez « Afficher plus » : Méthode <strong>POST</strong>, Corps de la requête <strong>JSON</strong>, ajoutez les champs :
              <code className="mx-1">amount</code> = variable « Montant », <code className="mx-1">merchant</code> = « Commerçant »,{" "}
              <code className="mx-1">card</code> = « Carte ou pass ».
            </li>
            <li>Faites un paiement test : une notification arrive avec le reste du budget.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">Pas besoin de Mac ni d&apos;App Store : tout se fait sur l&apos;iPhone.</p>
        </details>
        <details className="rounded-xl bg-surface-2 p-3 text-sm">
          <summary className="cursor-pointer font-medium">🤖 Android — app MacroDroid (gratuite)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Installez <strong>MacroDroid</strong> depuis le Play Store et autorisez l&apos;accès aux notifications.</li>
            <li>Nouvelle macro → Déclencheur <strong>Notification reçue</strong> → choisissez l&apos;app de votre banque (et/ou Google Wallet).</li>
            <li>
              Action <strong>Requête HTTP</strong> : méthode <strong>POST</strong>, URL = le lien ci-dessus, corps <strong>JSON</strong> :
              <code className="mt-1 block rounded bg-surface p-2 text-xs">{`{"text": "[notification_title] [notification]", "app": "[app_name]"}`}</code>
            </li>
            <li>L&apos;IA lit le texte de la notification, en extrait le montant et le commerçant, et ignore les notifications sans paiement.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">Activez les notifications de paiement dans l&apos;app de votre banque si ce n&apos;est pas déjà fait.</p>
        </details>
      </Section>

      <Section id="banque" title="Banque (lecture seule)">
        {bankMsg && (
          <p className={`text-sm ${bankMsg === "ok" ? "text-ok" : "text-danger"}`}>
            {bankMsg === "ok" ? "Banque connectée : import de l'historique en cours." : `Connexion échouée : ${bankMsg}`}
          </p>
        )}
        {accounts.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {accounts.map((a) => {
              const s = sessions.find((x) => x.id === a.bankSessionId);
              return (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="text-xs text-muted">
                      {a.source === "enablebanking" ? "Synchronisé" : "Import manuel"}
                      {a.lastSyncAt && ` · dernière synchro ${a.lastSyncAt.toLocaleString("fr-FR")}`}
                      {s?.validUntil && ` · accord valable jusqu'au ${s.validUntil.toLocaleDateString("fr-FR")}`}
                    </p>
                    {a.lastSyncError && <p className="text-xs text-danger">{a.lastSyncError}</p>}
                  </div>
                  <DeleteAccountButton id={a.id} />
                </li>
              );
            })}
          </ul>
        )}
        {bankConfigured() ? (
          <>
            <p className="text-sm text-muted">
              Connexion DSP2 via Enable Banking : accès en lecture seule, renouvelé tous les 90 à 180 jours selon la banque. Synchronisation automatique
              toutes les 6 h (la réglementation limite à 4 accès par jour).
            </p>
            {accounts.some((a) => a.bankSessionId) && <SyncButton />}
            <BankConnect />
          </>
        ) : (
          <p className="text-sm text-muted">
            Non configurée : renseignez <code>ENABLE_BANKING_APP_ID</code> et la clé privée dans .env (voir le README). En attendant, utilisez{" "}
            <a className="text-accent underline" href="/import">l&apos;import CSV/OFX</a>.
          </p>
        )}
      </Section>

      <Section title="Boîte mail des tickets">
        {imapConfigured() ? (
          <p className="text-sm">
            <strong>{process.env.IMAP_USER}</strong> —{" "}
            {imapState.connected ? <span className="text-ok">en écoute, réception instantanée</span> : <span className="text-danger">déconnectée {imapState.lastError}</span>}
          </p>
        ) : (
          <p className="text-sm text-muted">Non configurée : renseignez IMAP_HOST, IMAP_USER, IMAP_PASSWORD dans .env.</p>
        )}
        <p className="text-sm text-muted">
          Créez une règle de transfert automatique dans vos boîtes perso (Gmail : filtre sur « facture OR commande OR reçu OR receipt OR invoice OR ticket »)
          vers cette adresse.
        </p>
      </Section>

      <Section title="Intelligence artificielle (OpenRouter)">
        <p className="text-sm text-muted">
          Clé API : {aiConfigured() ? <span className="text-ok">présente</span> : <span className="text-danger">absente (OPENROUTEURAPI dans .env)</span>}. Modèle utilisé
          pour classer, lire les tickets et conseiller le budget :
        </p>
        <ModelForm model={getModel()} />
        <ClassifyPendingButton />
      </Section>

      <Section title="Famille">
        <ul className="text-sm">
          {members.map((m) => (
            <li key={m.id}>
              {m.name} <span className="text-muted">— {m.email}</span>
            </li>
          ))}
        </ul>
        <AddMemberForm />
      </Section>

      <Section title="Catégories">
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <div className="flex-1">
                <CategoryForm category={c} />
              </div>
              <div className="pt-3">
                <ArchiveCategoryButton id={c.id} />
              </div>
            </div>
          ))}
        </div>
        <p className="pt-2 text-sm font-medium">Nouvelle catégorie</p>
        <CategoryForm />
      </Section>

      <Section title={`Règles apprises (${rules.length})`}>
        <p className="text-sm text-muted">Créées quand vous corrigez une catégorie avec « Retenir pour ce commerçant ».</p>
        <ul className="divide-y divide-border text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="truncate font-mono text-xs">{r.merchantKey}</span>
              <span className="truncate text-xs">
                {catName.get(r.categoryId)}
                {r.multi && " (multi)"}
              </span>
              <DeleteRuleButton id={r.id} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Journal">
        <ul className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
          {logs.map((l) => (
            <li key={l.id} className={l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warn" : "text-muted"}>
              {l.createdAt.toLocaleString("fr-FR")} [{l.kind}] {l.message}
            </li>
          ))}
        </ul>
      </Section>

      <LogoutButton />
    </div>
  );
}
