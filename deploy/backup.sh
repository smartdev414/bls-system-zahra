#!/usr/bin/env bash
# Nightly DeafSign database backup (deploy user's crontab, 03:30 UTC).
# Keeps 14 days in ~/bls-zahra/backups. If BACKUP_S3_URI is set in .env each
# dump is also copied there, using the AWS keys from app.env. Use a PRIVATE
# bucket, never the public media bucket.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
set -a; . ./.env; set +a

mkdir -p backups
FILE="backups/bls-zahra-$(date -u +%Y%m%d-%H%M).dump"
docker compose exec -T zahra-db pg_dump -U bls_zahra -d bls_zahra -Fc > "$FILE.part"
mv "$FILE.part" "$FILE"
find backups -name 'bls-zahra-*.dump' -mtime +14 -delete

if [ -n "${BACKUP_S3_URI:-}" ]; then
  docker run --rm --env-file app.env -v "$PWD/backups:/backups:ro" amazon/aws-cli:2.22.0 \
    s3 cp "/$FILE" "${BACKUP_S3_URI%/}/$(basename "$FILE")" --only-show-errors
fi
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
