import { db, schema } from "@/lib/db";
import { ImportForm } from "@/components/ImportForm";

export default function ImportPage() {
  const accounts = db.select({ id: schema.accounts.id, name: schema.accounts.name }).from(schema.accounts).all();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Importer un relevé</h1>
      <div className="card space-y-2 text-sm text-muted">
        <p>
          Depuis l&apos;espace en ligne de votre banque, exportez les opérations des derniers mois (6 à 12 mois idéalement) au format{" "}
          <strong>CSV</strong> ou <strong>OFX</strong> (parfois appelé « Money » ou « Quicken »), puis déposez le fichier ici.
        </p>
        <p>
          Les doublons sont ignorés : vous pouvez réimporter sans risque. Les opérations sont ensuite classées automatiquement par l&apos;IA en
          arrière-plan (quelques minutes pour plusieurs centaines d&apos;opérations).
        </p>
      </div>
      <ImportForm accounts={accounts} />
    </div>
  );
}
