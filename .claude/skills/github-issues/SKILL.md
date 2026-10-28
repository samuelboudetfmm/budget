---
name: github-issues
description: Comment travailler une issue GitHub de ce projet (lecture du fil complet, branche, commit, push, rapport). À utiliser quand on te demande de traiter une issue ou quand tu tournes dans le workflow Claude Code (label claude-go / mention @claude).
---

# github-issues

1. Lis le titre, le corps et **tous** les commentaires (`gh issue view <num> --comments`).
   Le dernier mot de l'humain fait foi.
2. Travaille dans le dossier live du projet (voir CLAUDE.md, section « Projet »).
   Mets-toi à jour d'abord : `git pull --rebase` (ou fetch authentifié en CI, cf workflow).
3. Implémente par petits commits clairs : `feat(#<num>): ...`, `fix(#<num>): ...`.
4. Teste avec la skill `test-and-report` (Playwright CLI) AVANT de pousser.
5. Pousse sur la branche indiquée par le workflow (par défaut `dev`), jamais sur `main`/`prod`
   sauf demande explicite.
6. Poste UN commentaire-rapport (ce qui a été fait, tests ✅/❌, captures, comment vérifier).
7. Réellement bloqué (décision produit, accès manquant) ? UN commentaire de question, puis stop.

Sécurité : ne committe jamais `.env*`, clés, tokens, dumps de base.
