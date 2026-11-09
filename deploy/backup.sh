#!/usr/bin/env bash
# Nightly database backup (installed in cron by bootstrap-server.sh).
# Keeps 14 days in /opt/bls/backups. If BACKUP_S3_URI is set in /opt/bls/.env
# (e.g. s3://bls-db-backups/prod) each dump is also copied there, using the
# AWS keys from app.env. Use a PRIVATE bucket — never the public media bucket.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
set -a; . ./.env; set +a

mkdir -p backups
FILE="backups/bls-$(date -u +%Y%m%d-%H%M).dump"
docker compose exec -T db pg_dump -U bls -d bls -Fc > "$FILE.part"
mv "$FILE.part" "$FILE"
find backups -name 'bls-*.dump' -mtime +14 -delete

if [ -n "${BACKUP_S3_URI:-}" ]; then
  docker run --rm --env-file app.env -v "$PWD/backups:/backups:ro" amazon/aws-cli:2.22.0 \
    s3 cp "/$FILE" "${BACKUP_S3_URI%/}/$(basename "$FILE")" --only-show-errors
fi
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
