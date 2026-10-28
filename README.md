# Budget Famille

Application web installable (PWA) pour gérer le budget familial :

- **Historique** : import CSV/OFX des derniers mois (ou connexion bancaire) → classement automatique par l'IA.
- **Budget** : analyse des médianes par catégorie + assistant IA qui propose un budget aligné sur vos objectifs, et des réallocations en cours de mois.
- **Temps réel** : chaque paiement (iPhone / Android) est envoyé à l'app, classé, puis une **notification push** indique ce qu'il reste dans la catégorie et sur le mois.
- **Tickets & commandes** : les mails transférés sur une boîte dédiée sont lus (IMAP IDLE, instantané) ; un achat au supermarché ou sur Amazon est réparti ligne par ligne sur plusieurs catégories.
- **Apprentissage** : chaque correction peut devenir une règle pour le commerçant.
- **Enveloppes** : Alimentaire, Pharmacie & médecin, Factures mensuelles (Impôts, Téléphone, Internet, Charges, Emprunt), Énergie, Hygiène, Vêtements & jouets, Vacances / Sorties / provisions privées, Imprévu. Suivi au mois ; Vêtements & jouets se débloque **jour après jour**.
- **On ne dépasse pas** : une dépense qui ne rentre pas est repoussée au lendemain jusqu'à ce qu'on choisisse sur quel budget la reporter (jamais Alimentaire, Pharmacie & médecin, Impôts). Rappel push chaque matin.
- **Reste du mois** : reporté au choix le mois suivant, par défaut sur Vêtements & jouets (Vacances et provisions privées s'accumulent).
- **Paiement en plusieurs fois** : compté en totalité le mois de l'achat (on ne s'endette pas), sauf des vacances encore à venir payées par parties. Détection automatique des libellés 4X / Oney / Alma / Klarna…
- **À vérifier** : toutes les suppositions (catégorie devinée, ticket absent, paiement fractionné supposé, livraison inconnue) et les hypothèses sur les règles.
- **Wishlist** : on colle un lien, Playwright lit image et prix ; vendeurs alternatifs ; miniatures avec nom et meilleur prix livraison incluse ; tri par priorité.
- **Connexion** : email + mot de passe, session permanente (cookie renouvelé à chaque visite).

Stack : Next.js 16 (App Router, `output: standalone`), SQLite (better-sqlite3 + Drizzle), Tailwind 4, web-push, imapflow, OpenRouter.

## Déployer

```bash
cp .env.example .env   # puis compléter (au minimum OPENROUTEURAPI)
docker compose up -d --build
docker compose logs web | grep setup   # code d'installation du premier compte
```

Deux conteneurs : `web` (l'app) et `scraper` (Chromium/Playwright pour la wishlist, non exposé). L'app écoute sur le port **8340** → https://budget.samuelboudet.com. Les données (base SQLite, clés VAPID, clé bancaire, images de la wishlist) sont dans `./data` : **c'est ce dossier qu'il faut sauvegarder.**

Au premier lancement, ouvrez l'URL : la page de création du compte demande le code d'installation à 6 chiffres (logs ou `data/setup-code.txt`). Ajoutez ensuite les autres membres dans **Réglages → Famille**.

## Configuration (`.env`)

### IA — OpenRouter

`OPENROUTEURAPI` (clé) ; modèle par défaut `anthropic/claude-haiku-5.5`, modifiable dans **Réglages → IA** sans redémarrer.

### Boîte mail des tickets — IMAP IDLE

Créez une boîte dédiée (ex. `tickets@…` sur votre serveur mail existant, sans rien modifier de sa configuration) et renseignez `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`. L'app reste connectée en IDLE : le serveur la prévient à l'arrivée de chaque mail, en quelques secondes.

Dans vos boîtes perso, créez un filtre de transfert automatique (ex. Gmail : `facture OR commande OR reçu OR receipt OR invoice OR ticket OR order`) vers cette adresse.

Alternative sans boîte : `POST /api/inbound/email` (mail brut MIME, JSON `{from, subject, text, html}` ou formulaire Mailgun) avec `Authorization: Bearer $INBOUND_EMAIL_TOKEN`.

### Banque — Enable Banking (DSP2, lecture seule)

1. Créez un compte sur [enablebanking.com](https://enablebanking.com) → *Control Panel* → *Applications* → nouvelle application en environnement **Production**.
2. Laissez le site générer la clé privée et téléchargez le fichier `.pem` → copiez-le dans `data/enablebanking.pem`.
3. *Redirect URL* : `https://budget.samuelboudet.com/api/bank/callback`.
4. Activez l'application en mode restreint en **liant vos propres comptes** (usage personnel ; vérifiez les conditions et tarifs actuels sur leur site).
5. Dans `.env` : `ENABLE_BANKING_APP_ID=<id de l'application>` et `ENABLE_BANKING_KEY_PATH=/app/data/enablebanking.pem`, puis `docker compose up -d`.
6. **Réglages → Banque** : choisissez votre banque et authentifiez-vous. L'historique (jusqu'à 24 mois selon la banque) est importé puis classé en arrière-plan.

La DSP2 limite les accès sans action de l'utilisateur à **4 par jour** : la synchro automatique tourne toutes les 6 h. C'est pourquoi le temps réel passe par les téléphones ; la banque confirme ensuite et les doublons sont fusionnés (même montant à ±5 jours). L'accord est à renouveler tous les 90 à 180 jours selon la banque.

### Téléphones (temps réel)

Dans **Réglages → Paiements en temps réel**, chaque membre récupère son lien personnel et suit les instructions :

- **iPhone** : app Raccourcis → Automatisation → *Transaction* (paiements Apple Pay) → *Obtenir le contenu de l'URL* en POST JSON `{amount, merchant, card}`. Aucun Mac ni App Store nécessaire.
- **Android** : MacroDroid → déclencheur *Notification reçue* (app bancaire) → *Requête HTTP* POST JSON `{"text": "[notification_title] [notification]"}`. L'IA extrait montant et commerçant et ignore les notifications sans paiement.

Puis **Réglages → Notifications → Activer** sur chaque appareil. Sur iPhone, l'app doit d'abord être ajoutée à l'écran d'accueil depuis Safari (Partager → *Sur l'écran d'accueil*).

## Développement

```bash
npm install
npm run dev            # http://localhost:3000, base dans ./data
npm run db:generate    # après modification de src/lib/db/schema.ts
```

Organisation :

| Dossier | Rôle |
| --- | --- |
| `src/lib/ingest.ts` | Entrée unique des opérations : dédoublonnage, rapprochement téléphone ↔ banque, classement, notification |
| `src/lib/classify.ts` | Ticket mail → règle apprise → IA (par lots de 20) |
| `src/lib/email.ts`, `imap.ts` | Réception et analyse des mails |
| `src/lib/enablebanking.ts` | Connexion DSP2 et synchronisation |
| `src/lib/advisor.ts` | Propositions de budget par l'IA |
| `src/lib/envelopes.ts` | Moteur des enveloppes : déblocage quotidien, dépenses repoussées, reports, reste du mois |
| `src/lib/installments.ts` | Paiements en plusieurs fois (total compté à l'achat, échéances rattachées) |
| `src/lib/uncertain.ts` | Suppositions listées dans « À vérifier » |
| `src/lib/wishlist.ts`, `scraper/` | Wishlist et service Playwright de lecture des pages produit |
| `src/lib/scheduler.ts` | Tâches de fond (IMAP, synchro bancaire, reprise de classement), lancées par `src/instrumentation.ts` |

### Wishlist : sites qui refusent la lecture

Beaucoup de grandes enseignes (Amazon, Fnac, Decathlon, Kiabi, LEGO…) bloquent les navigateurs automatisés (page « Just a moment… », erreur 403). L'app le signale (« Ce site refuse la lecture automatique ») et on saisit le prix à la main dans la fiche ; la miniature reste un 🎁. Les sites qui acceptent (ex. JouéClub) sont lus normalement. Si les frais de livraison ne figurent pas sur la page, l'IA tente de les trouver, sinon ils sont comptés 0 € et signalés dans « À vérifier ».
