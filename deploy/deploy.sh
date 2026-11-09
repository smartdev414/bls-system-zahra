#!/usr/bin/env bash
# Release one image tag on the server. Run by the CI pipeline; also usable by
# hand for a rollback:   /opt/bls/deploy.sh <git-commit-sha>
#
# Steps: pull images → apply database migrations → start the new web container
# and wait for its health check. If the new container never becomes healthy,
# the previous release is put back and the script fails.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image-tag>}"
cd "$(dirname "$(readlink -f "$0")")"
export IMAGE_TAG="$TAG"
PREVIOUS="$(cat .current-tag 2>/dev/null || true)"

echo "==> Pulling $TAG"
docker compose --profile tools pull web migrate
echo "$TAG" > .last-pulled-tag

docker compose up -d --wait db

# The database must have been copied over from Neon first (move-database.sh).
if ! docker compose exec -T db psql -U bls -d bls -tAc "select 1 from _prisma_migrations limit 1" >/dev/null 2>&1; then
  echo "!! The database is empty or not baselined. Run /opt/bls/move-database.sh first, then deploy again." >&2
  exit 1
fi

echo "==> Applying database migrations"
docker compose --profile tools run --rm -T migrate

echo "==> Starting web"
if docker compose up -d --wait --wait-timeout 180 --remove-orphans web caddy cron; then
  echo "$TAG" > .current-tag
  echo "==> Released $TAG"
else
  echo "!! $TAG did not become healthy" >&2
  docker compose logs --tail 80 web >&2 || true
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TAG" ]; then
    echo "==> Rolling back to $PREVIOUS" >&2
    IMAGE_TAG="$PREVIOUS" docker compose up -d --wait web || true
  fi
  exit 1
fi

# Keep about ten days of old images for manual rollbacks.
docker image prune -af --filter "until=240h" >/dev/null || true
