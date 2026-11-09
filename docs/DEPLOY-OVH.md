# Deploying to OVH

Production runs on one OVH server with Docker:

| Container | What it does |
|---|---|
| `caddy` | HTTPS (automatic certificates) → forwards to `web` |
| `web` | The Next.js app (image built by GitHub Actions) |
| `db` | PostgreSQL 17 (data in a Docker volume, port 5432 on 127.0.0.1 only) |
| `cron` | Calls `/api/cron/reminders` every 10 minutes |

Files: [deploy/](../deploy/) and [.github/workflows/deploy-ovh.yml](../.github/workflows/deploy-ovh.yml).
On the server everything lives in `/opt/bls`. `.env` holds the domain and the DB password, and `app.env` holds the app's secrets.

## How a release works

Push to `main` → GitHub Actions builds the image → copies `deploy/*` to the server → `deploy.sh <commit>`:
pull → apply new `prisma/migrations` → start the new app → wait for `/api/health`.
If the new version never becomes healthy, the previous one is put back automatically.

**Schema changes:** add a migration folder under `prisma/migrations/`. It is applied on deploy. No more
manual SQL on prod.

## First-time setup

1. **Order the server.** An OVH VPS with Ubuntu 24.04, at least 4 vCPU / 8 GB RAM / 80 GB disk. Add your SSH key when you order it.
2. **Create a deploy key** (on any computer): `ssh-keygen -t ed25519 -f bls-deploy -N ""`.
3. **Bootstrap** (as root):
   ```
   scp deploy/bootstrap-server.sh deploy/app.env.example root@SERVER:/root/
   ssh root@SERVER "bash /root/bootstrap-server.sh classroom.tms.webcam '$(cat bls-deploy.pub)'"
   ```
4. **Fill in `/opt/bls/app.env`** with the values from Vercel → Settings → Environment Variables (Production).
   Leave out `DATABASE_URL`. `CRON_SECRET` is already generated.
5. **GitHub → Settings → Secrets and variables → Actions:**
   - Secrets: `OVH_HOST` (server IP), `OVH_SSH_KEY` (contents of `bls-deploy`),
     `OVH_KNOWN_HOSTS` (output of `ssh-keyscan SERVER`)
   - Variables: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`,
     `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` (same values as Vercel), then `OVH_DEPLOY` = `on`
6. **Run the workflow once** (Actions → Deploy to OVH → Run workflow). It pulls the images and then
   stops with "database is empty": this is expected.
7. **Lower the DNS TTL** of `classroom.tms.webcam` to 300 s a day before the switch.

## Switch-over (about 15 minutes of downtime, at a quiet time)

1. Tell users. In Vercel, turn on maintenance mode or pause the project so nothing else writes to Neon.
2. On the server: `sudo -u deploy /opt/bls/move-database.sh '<Neon DIRECT connection string>'`.
   It copies the data, compares row counts, checks the schema and baselines the migrations.
   If it reports schema drift, read `backups/schema-drift.sql` before re-running with `ACCEPT_DRIFT=yes`.
3. Re-run the workflow. The app starts on OVH.
4. Point the DNS A record of `classroom.tms.webcam` at the server IP. Caddy gets the certificate within
   a minute or two of DNS updating.
5. Check `https://classroom.tms.webcam/api/health`: every `config` value should be `true`. Log in and start a test class
   (check that recording and captions work).
6. In GitHub/Vercel, disconnect the Vercel project's Git integration so pushes only deploy to OVH.
   Keep Neon for a couple of weeks as a fallback copy, then delete it.

## Day to day

- Logs: `cd /opt/bls && docker compose logs -f web`
- Database shell: `docker compose exec db psql -U bls -d bls`
- Rollback: `/opt/bls/deploy.sh <older-commit-sha>` (or re-run the workflow from an older commit)
- Backups: nightly at 03:15 in `/opt/bls/backups` (14 days). Set `BACKUP_S3_URI` in `/opt/bls/.env`
  to also copy them off-site, to a **private** bucket. Restore:
  `docker compose exec -T db pg_restore -U bls -d bls --clean --if-exists < backups/<file>.dump`
- Never run `move-database.sh` after the switch-over: it replaces the database.
