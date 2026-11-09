#!/usr/bin/env bash
# Build and release the code in /opt/bls/src on this server.
# Run by GitHub Actions after it copies the repo here; also usable by hand:
#   /opt/bls/src/deploy/release.sh <git-sha>
set -euo pipefail

TAG="${1:?usage: release.sh <git-sha>}"
SRC=/opt/bls/src
cd "$SRC"

# Browser-side settings are baked in at build time; take them from app.env.
get() { grep -E "^$1=" /opt/bls/app.env | cut -d= -f2- || true; }

echo "==> Building $TAG"
DOCKER_BUILDKIT=1 nice docker build -q -f deploy/web.Dockerfile --target web \
  --build-arg NEXT_PUBLIC_APP_URL="$(get NEXT_PUBLIC_APP_URL)" \
  --build-arg NEXT_PUBLIC_PUSHER_KEY="$(get NEXT_PUBLIC_PUSHER_KEY)" \
  --build-arg NEXT_PUBLIC_PUSHER_CLUSTER="$(get NEXT_PUBLIC_PUSHER_CLUSTER)" \
  --build-arg NEXT_PUBLIC_TLDRAW_LICENSE_KEY="$(get NEXT_PUBLIC_TLDRAW_LICENSE_KEY)" \
  -t "bls-local:$TAG" .
DOCKER_BUILDKIT=1 nice docker build -q -f deploy/web.Dockerfile --target migrate -t "bls-local-migrate:$TAG" .

# Stack files come from git, so edit them there, not on the server.
cp deploy/docker-compose.yml deploy/Caddyfile deploy/deploy.sh deploy/backup.sh /opt/bls/

SKIP_PULL=yes /opt/bls/deploy.sh "$TAG"
# The workflow then deletes /opt/bls/src and the build cache (it holds a copy
# of the source), so only the built images stay on the server.
