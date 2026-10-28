---
name: test-and-report
description: Après un changement, écrire/étendre des tests Playwright (CLI, headless) couvrant tous les cas d'usage, les exécuter sur le site live du projet, puis EMBARQUER les captures dans le commentaire-rapport de l'issue GitHub. À utiliser à chaque run claude-go / @claude.
---

# test-and-report

But : **prouver, captures à l'appui visibles dans l'issue**, que le changement fonctionne.
On teste avec le **Playwright CLI** (pas le MCP : moins de tokens, rejouable, specs commitées).

## Règles
1. Specs dans `e2e/tests/*.spec.js`, lancées par `cd e2e && npx playwright test --reporter=line`.
   Si `e2e/` n'existe pas, crée-le : `package.json` (devDependency `@playwright/test`) +
   `playwright.config.js` avec `use.baseURL` = l'URL publique du projet (voir CLAUDE.md).
   Chromium est déjà installé dans le DinD.
2. **Tous les cas d'usage** : nominal, anonyme ET connecté si applicable, erreurs / cas limites,
   régression des parcours voisins, mobile si l'UI change.
3. Chaque état clé → `await page.screenshot({ path: 'shots/<nom>.png' })`.
4. Identifiants de test : `.claude/test-fixtures.yaml` s'il existe (jamais de creds en dur).

## Procédure
1. Écris/étends les specs, exécute, corrige jusqu'au vert (le rapport reflète l'état FINAL).
2. Pour chaque capture : `MD=$(.claude/scripts/upload-screenshot.sh e2e/shots/<nom>.png issue-<num>-<nom>)`
   (commite l'image sur la branche `gh-assets` et renvoie un markdown `![...](...)` affichable).
3. UN commentaire-rapport sur l'issue (`gh issue comment <num> --body-file rapport.md`) :
   checklist ✅/❌ des cas testés, captures embarquées, URL où tester, limites à valider.
