# budget

## Projet
- DinD : **sboudet** — dossier `/workspace/budget`
- URL(s) publique(s) : https://budget.samuelboudet.com
- Dépôt : (aucun)

## Ports
Ce projet dispose de la bande de ports internes **8340–8349** dans le DinD.
Le reverse proxy de l'hôte envoie https://budget.samuelboudet.com vers `dind-sboudet:8340` :
**le service web principal doit publier `8340`** dans `docker-compose.yml`
(ex. `ports: ["8340:80"]`). Les autres ports de la bande sont libres pour tes services
(API, admin, etc.). N'utilise PAS de ports hors de ta bande (collision avec les autres projets).

## Déployer / relancer
    cd /workspace/budget && docker compose up -d --build

Les domaines, certificats HTTPS et ports publics sont gérés par le portail
https://projects.data-coeur.com (ne pas éditer nginx à la main).
