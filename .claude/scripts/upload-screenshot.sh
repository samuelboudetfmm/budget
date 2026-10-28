#!/usr/bin/env bash
# Upload une capture d'écran sur la branche `gh-assets` et imprime un markdown
# EMBARQUABLE dans un commentaire d'issue GitHub (l'image s'affiche, pas juste un chemin local).
#
# Usage : ./.claude/scripts/upload-screenshot.sh <chemin_image.png> <nom-unique>
#   ex.  ./.claude/scripts/upload-screenshot.sh e2e/shots/login.png issue-42-login
#
# Env (fournis automatiquement dans GitHub Actions) :
#   GITHUB_REPOSITORY (owner/repo) + GITHUB_TOKEN (ou GH_TOKEN)
set -euo pipefail

IMG="${1:?usage: upload-screenshot.sh <image> <nom-unique>}"
NAME="${2:?usage: upload-screenshot.sh <image> <nom-unique>}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY manquant}"
export GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:?GITHUB_TOKEN manquant}}"

FILE="screenshots/${NAME}.png"
SHA="$(gh api "repos/${REPO}/contents/${FILE}?ref=gh-assets" -q .sha 2>/dev/null || true)"

# IMPORTANT : python lit l'image LUI-MÊME (seul le chemin passe en argv) — sinon le base64
# d'une grosse capture dépasse ARG_MAX ("Argument list too long").
TMP="$(mktemp)"
python3 - "$IMG" "$FILE" "$SHA" >"$TMP" <<'PY'
import json, sys, base64
img, path, sha = sys.argv[1], sys.argv[2], sys.argv[3]
with open(img, "rb") as f:
    content = base64.b64encode(f.read()).decode()
body = {"message": f"screenshot: {path}", "content": content, "branch": "gh-assets"}
if sha:
    body["sha"] = sha
print(json.dumps(body))
PY
gh api "repos/${REPO}/contents/${FILE}" --method PUT --input "$TMP" >/dev/null
rm -f "$TMP"

echo "![${NAME}](https://github.com/${REPO}/blob/gh-assets/${FILE}?raw=true)"
