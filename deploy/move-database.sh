#!/usr/bin/env bash
# Copy the live database from Neon into the OVH Postgres container.
#
#   /opt/bls/move-database.sh 'postgresql://USER:PASS@ep-xxxx.eu-west-2.aws.neon.tech/neondb?sslmode=require'
#
# Use Neon's DIRECT connection string (host without "-pooler").
# WARNING: this REPLACES the OVH database with a fresh copy. It is meant for
# the first copy and for the final copy at cutover; never run it after the
# OVH server has gone live, or everything written since is lost.
set -euo pipefail

NEON_URL="${1:?usage: move-database.sh '<neon direct connection string>'}"
cd "$(dirname "$(readlink -f "$0")")"
set -a; . ./.env; set +a
TAG="$(cat .current-tag 2>/dev/null || cat .last-pulled-tag 2>/dev/null || true)"
[ -n "$TAG" ] || { echo "!! No app image pulled yet — let the CI deploy run once first." >&2; exit 1; }
export IMAGE_TAG="$TAG"

if [ -f .current-tag ] && [ "${FORCE:-}" != "yes" ]; then
  echo "!! OVH is already live (release $(cat .current-tag)). Re-run with FORCE=yes only if you really mean to overwrite it." >&2
  exit 1
fi

PG="postgres:18-alpine"  # must be >= the Neon server version
echo "==> Neon server version:"
docker run --rm "$PG" psql "$NEON_URL" -tAc "show server_version"

mkdir -p backups
DUMP="backups/neon-$(date -u +%Y%m%d-%H%M).dump"
echo "==> Dumping Neon to $DUMP"
docker run --rm "$PG" pg_dump "$NEON_URL" -Fc --no-owner --no-acl > "$DUMP"
ls -lh "$DUMP"

echo "==> Recreating the OVH database"
docker compose stop web cron 2>/dev/null || true
docker compose up -d --wait db
docker compose exec -T db dropdb -U bls --if-exists --force bls
docker compose exec -T db createdb -U bls -O bls bls

echo "==> Restoring"
docker compose exec -T db pg_restore -U bls -d bls --no-owner --no-acl --exit-on-error < "$DUMP"

echo "==> Row counts (Neon vs OVH) for key tables"
for t in '"User"' '"Course"' '"Sign"' '"LiveSession"'; do
  a=$(docker run --rm "$PG" psql "$NEON_URL" -tAc "select count(*) from $t" 2>/dev/null || echo "?")
  b=$(docker compose exec -T db psql -U bls -d bls -tAc "select count(*) from $t" 2>/dev/null || echo "?")
  printf '   %-14s neon=%-8s ovh=%s\n' "$t" "$a" "$b"
done

# Neon never had prisma's migration table (schema changes were applied by
# hand). Compare the copied schema with prisma/schema.prisma; if they match,
# mark every migration as applied so future releases apply new ones
# automatically.
echo "==> Checking the schema against prisma/schema.prisma"
set +e
docker compose --profile tools run --rm -T migrate npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code > backups/schema-drift.sql
DIFF=$?
set -e
if [ "$DIFF" = "2" ] && [ "${ACCEPT_DRIFT:-}" != "yes" ]; then
  echo "!! The live schema differs from prisma/schema.prisma. The SQL that would bring it in line is in" >&2
  echo "   /opt/bls/backups/schema-drift.sql (usually a migration that was never applied to prod)." >&2
  echo "   Read it. If it only adds things, re-run with ACCEPT_DRIFT=yes to apply it to the OVH copy." >&2
  exit 1
elif [ "$DIFF" = "2" ]; then
  echo "==> Applying backups/schema-drift.sql to the OVH copy"
  docker compose exec -T db psql -U bls -d bls -v ON_ERROR_STOP=1 < backups/schema-drift.sql
elif [ "$DIFF" != "0" ]; then
  echo "!! prisma migrate diff failed (exit $DIFF)" >&2; exit 1
fi

echo "==> Schema matches. Baselining migrations"
docker compose --profile tools run --rm -T migrate sh -c \
  'for m in prisma/migrations/*/; do npx prisma migrate resolve --applied "$(basename "$m")" >/dev/null; done; npx prisma migrate status'

echo "==> Done. Now run the deploy (GitHub → Actions → Deploy to OVH → Run workflow)."
