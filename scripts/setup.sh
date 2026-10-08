#!/usr/bin/env bash
# One-time setup: creates the GitHub repository, switches GitHub Pages to "GitHub Actions", and pushes.
# After this, every push to main tests, builds and deploys by itself.
set -euo pipefail
REPO="${1:-practice-timer}"
command -v gh  >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
command -v git >/dev/null || { echo "Install git first."; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login
cd "$(dirname "$0")/.."
[ -d .git ] || git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo dev)}" -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo dev@example.com)}" commit -q -m "Practice Timer" || true
OWNER="$(gh api user --jq .login)"
# Public, because GitHub Pages on private repositories needs a paid plan. The app contains no secrets.
gh repo create "$OWNER/$REPO" --public --source=. --remote=origin >/dev/null
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || echo "Could not switch Pages on automatically. In the repo: Settings > Pages > Source: GitHub Actions."
git push -u origin main
echo
echo "Pushed. The first deploy takes about a minute: https://$OWNER.github.io/$REPO/"
gh run watch --exit-status "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" || true
