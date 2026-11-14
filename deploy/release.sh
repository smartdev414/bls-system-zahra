#!/usr/bin/env bash
# Build and release the code in ~/bls-zahra/src on this server.
# Run by GitHub Actions after it copies the repo here; also usable by hand:
#   ~/bls-zahra/src/deploy/release.sh <git-sha>
set -euo pipefail

TAG="${1:?usage: release.sh <git-sha>}"
HOME_DIR=/home/deploy/bls-zahra
SRC="$HOME_DIR/src"
cd "$SRC"

# Browser-side settings are baked in at build time; take them from app.env.
get() { grep -E "^$1=" "$HOME_DIR/app.env" | cut -d= -f2- || true; }

echo "==> Building $TAG"
DOCKER_BUILDKIT=1 nice docker build -q -f deploy/web.Dockerfile --target web \
  --build-arg NEXT_PUBLIC_APP_URL="$(get NEXT_PUBLIC_APP_URL)" \
  --build-arg NEXT_PUBLIC_PUSHER_KEY="$(get NEXT_PUBLIC_PUSHER_KEY)" \
  --build-arg NEXT_PUBLIC_PUSHER_CLUSTER="$(get NEXT_PUBLIC_PUSHER_CLUSTER)" \
  --build-arg NEXT_PUBLIC_TLDRAW_LICENSE_KEY="$(get NEXT_PUBLIC_TLDRAW_LICENSE_KEY)" \
  -t "bls-zahra:$TAG" .
DOCKER_BUILDKIT=1 nice docker build -q -f deploy/web.Dockerfile --target migrate -t "bls-zahra-migrate:$TAG" .

# Stack files come from git, so edit them there, not on the server.
cp deploy/docker-compose.yml deploy/Caddyfile deploy/deploy.sh deploy/backup.sh "$HOME_DIR/"

SKIP_PULL=yes "$HOME_DIR/deploy.sh" "$TAG"
# The workflow then deletes the source dir (it holds a copy of the source).
