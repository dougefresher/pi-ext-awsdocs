#!/usr/bin/env bash
set -euo pipefail

echo "release branch=${BUILDKITE_BRANCH:-unknown} commit=${BUILDKITE_COMMIT:-unknown}"

export GITHUB_TOKEN="$(github-token-app)"
export GH_TOKEN="$GITHUB_TOKEN"

gh auth status
gh auth setup-git --hostname github.com

git fetch --tags --force
bun install --frozen-lockfile
./node_modules/.bin/changeset version

if git diff --quiet; then
  echo "no changes"
  exit 0
fi

VERSION=$(jq -r .version package.json)
TAG="v${VERSION}"

git config user.name "changesets[bot]"
git config user.email "buildkite[bot]@users.noreply.github.com"
git add -A
git commit -m "chore(release): ${TAG} [skip ci]"

git push origin HEAD:main

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag ${TAG} already exists"
else
  git tag -a "$TAG" -m "$TAG"
  git push origin "$TAG"
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "release ${TAG} already exists"
else
  gh release create "$TAG" --generate-notes --latest=true
fi
