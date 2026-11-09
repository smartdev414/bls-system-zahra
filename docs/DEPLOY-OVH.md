# Deploying (OVH)

**To update the live site, push to `main`.** GitHub Actions ([deploy-ovh.yml](../.github/workflows/deploy-ovh.yml))
copies the code to the OVH server, builds it there and restarts it, in about 2–3 minutes. Watch it under the repo's **Actions** tab.
If the new version fails its health check, the previous one keeps running.

Database changes: add a folder under `prisma/migrations/`. It is applied automatically during the release.

## The server

Old OVH dedicated server `ns3207512`. The live site uses IP 198.244.201.81 (SSH port 32984), and the old Apache sites stay on 51.89.187.255.
Everything lives in `/opt/bls`, owned by the `deploy` user:

| | |
|---|---|
| `app.env` | the app's secrets (LiveKit, S3, Mailgun, Pusher, …). Edit it here, then re-run the latest deploy |
| `.env` | domain, DB password, `CRON=on/off` |
| `src/` | the code, only while a deploy is building (deleted afterwards) |
| `backups/` | nightly database dump at 03:15, 14 days kept |

Containers (`docker compose ps` in `/opt/bls`): `caddy` (HTTPS), `web`, `db` (Postgres 18), `cron` (reminders every 10 min).

## Handy commands (on the server, as `deploy`)

```
cd /opt/bls
docker compose logs -f web                    # app logs
docker compose exec db psql -U bls -d bls     # database shell
SKIP_PULL=yes ./deploy.sh <older-sha>         # roll back to an earlier release (first 7 chars of the commit)
```

GitHub needs one secret: `OVH_SSH_KEY` (the private key of the `deploy` user).

`deploy/move-database.sh` was only for the one-time copy from Neon (2026-11-09). Never run it again: it replaces the database.
