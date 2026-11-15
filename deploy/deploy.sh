#!/usr/bin/env bash
# Release one image tag of DeafSign on the server. Run by the CI pipeline;
# also usable by hand for a rollback:
#   ~/bls-zahra/deploy.sh <git-commit-sha>      (SKIP_PULL=yes)
#
# Steps: apply database migrations → start the new web container and wait for
# its health check → install this site's block in the shared Caddy. If the new
# container never becomes healthy, the previous release is put back and the
# script fails.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image-tag>}"
cd "$(dirname "$(readlink -f "$0")")"
set -a; . ./.env; set +a
export IMAGE_TAG="$TAG"
PREVIOUS="$(cat .current-tag 2>/dev/null || true)"

# The original BLS stack (/opt/bls) owns ports 80/443 and the shared network.
SITES_DIR=/opt/bls/sites
CADDY=bls-caddy-1

[ "${SKIP_PULL:-}" = "yes" ] || docker compose --profile tools pull zahra-web migrate
echo "$TAG" > .last-pulled-tag

docker compose up -d --wait zahra-db

# A fresh database must first get the schema (see docs/DEPLOY-OVH.md).
if ! docker compose exec -T zahra-db psql -U bls_zahra -d bls_zahra -tAc "select 1 from _prisma_migrations limit 1" >/dev/null 2>&1; then
  echo "!! The database has no schema yet. Load it first (docs/DEPLOY-OVH.md, 'How the database was created'), then deploy again." >&2
  exit 1
fi

echo "==> Applying database migrations"
docker compose --profile tools run --rm -T migrate

echo "==> Starting web"
# db-allow.conf holds the IPs allowed through db-gateway (server only, not in
# git). Created empty (= nobody allowed) so the bind mount is never a folder.
[ -f db-allow.conf ] || : > db-allow.conf
SERVICES="zahra-web db-gateway"; [ "${CRON:-on}" = "off" ] || SERVICES="$SERVICES zahra-cron"
if [ "${CRON:-on}" = "off" ]; then docker compose stop zahra-cron 2>/dev/null || true; fi
if docker compose up -d --wait --wait-timeout 180 $SERVICES; then
  echo "$TAG" > .current-tag
  echo "==> Released $TAG"
else
  echo "!! $TAG did not become healthy" >&2
  docker compose logs --tail 80 zahra-web >&2 || true
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TAG" ]; then
    echo "==> Rolling back to $PREVIOUS" >&2
    IMAGE_TAG="$PREVIOUS" docker compose up -d --wait zahra-web || true
  fi
  exit 1
fi

# Route the domain through the shared Caddy. Only rewritten when it changed;
# if Caddy rejects it, it is removed again so the original site never breaks.
echo "==> Routing ${DOMAIN:?set DOMAIN in .env}"
if [ -d "$SITES_DIR" ] && docker inspect "$CADDY" >/dev/null 2>&1; then
  NEW="$(sed "s|__DOMAIN__|$DOMAIN|" Caddyfile)"
  if [ "$NEW" != "$(cat "$SITES_DIR/deafsign.caddy" 2>/dev/null || true)" ]; then
    printf '%s\n' "$NEW" > "$SITES_DIR/deafsign.caddy"
    if ! docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
      echo "!! Caddy rejected the site block; removing it" >&2
      rm -f "$SITES_DIR/deafsign.caddy"
      docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
      exit 1
    fi
  fi
else
  echo "!! $SITES_DIR or $CADDY missing: the original stack must load /opt/bls/sites/*.caddy" >&2
  exit 1
fi

# Keep about ten days of old images for manual rollbacks (same rule as the
# original stack's deploy.sh, which also prunes server-wide).
docker image prune -af --filter "until=240h" >/dev/null || true
