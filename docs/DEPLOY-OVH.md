# Deploying DeafSign (OVH)

**To update the live site, push to `main`.** GitHub Actions ([deploy-ovh.yml](../.github/workflows/deploy-ovh.yml))
copies the code to the OVH server, builds it there and restarts it, in about 2–3 minutes. Watch it under the repo's **Actions** tab.
If the new version fails its health check, the previous one keeps running.

Database changes: add a folder under `prisma/migrations/`. It is applied automatically during the release.

## Two separate platforms on one server

This repo (`smartdev414/bls-system-zahra`, site **https://bsl.deafsigns.co.uk**) began as a copy of the
Teach Me Sign platform (`smartdev414/bls-system`, **https://classroom.tms.webcam**) on 2026-11-14. The two are now
separate products for separate clients: change each one only in its own repo, and each deploys only its own stack.

| | Original (Teach Me Sign) | This repo (DeafSign) |
|---|---|---|
| Folder on the server | `/opt/bls` | `/home/deploy/bls-zahra` |
| Compose project | `bls` | `bls-zahra` |
| Containers | `bls-web-1`, `bls-db-1`, `bls-cron-1`, `bls-caddy-1` | `bls-zahra-zahra-web-1`, `bls-zahra-zahra-db-1`, `bls-zahra-zahra-cron-1` |
| Database | `bls` (port 5432 on localhost) | `bls_zahra`, user `bls_zahra` (port 5434 on localhost) |
| Images | `bls-local:<sha>` | `bls-zahra:<sha>` |

**The one shared piece is HTTPS.** The original stack's Caddy owns ports 80/443 (the server's other IP belongs to an
old OpenVidu install). It also loads every `/opt/bls/sites/*.caddy` file. This repo's `deploy.sh` writes
`/opt/bls/sites/deafsign.caddy` (from [deploy/Caddyfile](../deploy/Caddyfile)) and reloads that Caddy, which then
proxies `bsl.deafsigns.co.uk` to `zahra-web:3000` over the original's `bls_default` network. Consequences:

- Don't remove the `sites` import or volume from the original repo's `deploy/Caddyfile` / `docker-compose.yml`.
- In this repo, never name a compose service `web` or `db`: it joins `bls_default`, where the original's Caddy and cron
  call `web:3000`.
- If someone runs `docker compose down` on the original stack, its network is recreated and DeafSign drops off it:
  re-run the latest DeafSign deploy (or `docker compose up -d zahra-web` in `~/bls-zahra`).

Shared third-party accounts (same keys as the original): LiveKit (incl. the classroom-transcriber agent), Pusher,
AWS S3 bucket, Mailgun, OpenAI, CloudConvert, RunPod, Google sign-in. Room names, S3 keys and Pusher channels use
random ids, so the sites don't see each other's data. `JWT_SECRET` and `CRON_SECRET` are this site's own.
Google sign-in needs `https://bsl.deafsigns.co.uk` added to the OAuth client's authorised origins / redirect URIs.

## The server

OVH dedicated server `ns3207512`, IP 198.244.201.81, SSH port 32984, user `deploy`. DeafSign lives in
`/home/deploy/bls-zahra`:

| | |
|---|---|
| `app.env` | the app's secrets. Edit it here, then re-run the latest deploy (`NEXT_PUBLIC_*` values need a rebuild: re-run the workflow) |
| `.env` | `DOMAIN`, DB password, `IMAGE_REPO=bls-zahra`, `CRON=on/off` |
| `src/` | the code, only while a deploy is building (deleted afterwards) |
| `backups/` | nightly database dump at 03:30 UTC, 14 days kept |

## Handy commands (on the server, as `deploy`)

```
cd ~/bls-zahra
docker compose logs -f zahra-web                              # app logs
docker compose exec zahra-db psql -U bls_zahra -d bls_zahra   # database shell
SKIP_PULL=yes ./deploy.sh <older-sha>                         # roll back (first 7 chars of the commit)
```

GitHub needs one secret: `OVH_SSH_KEY` (the private key of the `deploy` user).

## How the database was created

The migrations in `prisma/migrations/` start from a baseline and can't build an empty database. On 2026-11-14 the
DeafSign database got the original's schema (`pg_dump --schema-only`, no rows) plus the rows of `_prisma_migrations`,
so later migrations apply normally. No user data was copied.
