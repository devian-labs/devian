#!/usr/bin/env bash
# Bump the version everywhere, commit, and push a tag. CI does the rest
# (.github/workflows/release.yml builds, publishes, and updates the cask).
#
# Usage: ./scripts/release.sh 1.3.0
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Usage: $0 <semver>   e.g. $0 1.3.0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty; commit or stash first." >&2
  exit 1
fi
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists." >&2
  exit 1
fi

echo "Bumping to $VERSION"
npm pkg set version="$VERSION" -w @devian/desktop -w @devian/landing
printf '{\n  "version": "%s"\n}\n' "$VERSION" > "$DESKTOP/version.json"
# First `version = ` line only, i.e. the [package] version.
perl -0pi -e "s/^version = \".*?\"/version = \"$VERSION\"/m" "$DESKTOP/src-tauri/Cargo.toml"

npm install --package-lock-only --silent
(cd "$DESKTOP/src-tauri" && cargo update -p devian-desktop --quiet)

git add package-lock.json apps/desktop/package.json apps/landing/package.json \
  apps/desktop/version.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"
git push origin HEAD "v$VERSION"

echo "Pushed v$VERSION. Watch the Release workflow on GitHub."
