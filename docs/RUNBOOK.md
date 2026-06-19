# BSL Platform — Operations Runbook

Practical guide for keeping the platform running and diagnosing the common
classroom failures. Aimed at whoever is on support — including someone who
didn't build it.

> **Fill this in:** primary on-call = ______ · backup = ______ · hosting
> dashboard = ______ · LiveKit dashboard = ______ · Pusher dashboard = ______

---

## 1. Architecture at a glance

| Concern | Service | Where it's configured |
|---|---|---|
| Web app | Next.js 16 (App Router) | this repo |
| Database | PostgreSQL via Prisma | `DATABASE_URL` |
| Live audio/video | LiveKit | `LIVEKIT_API_KEY/SECRET/WS_URL` |
| In-room sync (slides, whiteboard, mute) | LiveKit **data channels** | (no extra config) |
| Live captions | LiveKit agent + **Deepgram** | `DEEPGRAM_API_KEY`, run `npm run transcriber` |
| Realtime across pages (messaging badge, **co-teacher pull-in**) | Pusher | `PUSHER_*`, `NEXT_PUBLIC_PUSHER_*` |
| File uploads & recordings | AWS S3 | `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID/SECRET`, `AWS_REGION` |
| Session recording | LiveKit Egress → S3 | LiveKit + S3 |
| Email (invites, notifications) | Mailgun | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` |
| Ops alerts | Webhook (Slack/Discord) | `ALERT_WEBHOOK_URL` |

---

## 2. First thing to check: `/api/health`

`GET https://<your-domain>/api/health` returns JSON, no auth, no secrets:

```json
{ "status": "ok", "db": true,
  "config": { "database": true, "livekit": true, "pusher": true,
              "email": false, "storage": true, "alerting": true } }
```

- `status: "ok"` + HTTP 200 → app and DB are up.
- HTTP 503 / `db: false` → database is unreachable (see §4.8).
- Any `config.*: false` → that integration's env vars are missing — explains a
  whole class of "feature X doesn't work" reports (e.g. `email: false` ⇒ no
  invite emails are being sent).

**Set up monitoring:** point an external uptime monitor (UptimeRobot,
BetterStack, Pingdom — free tiers are fine) at `/api/health` every 1–5 min with
alerts to email/SMS/Slack. That's the "know within minutes" safety net.

---

## 3. Alerting

Two channels fire on any server 5xx (and uncaught SSR errors):
- **Email** → `DEV_EMAIL` (via Mailgun), with full request/error detail. (`lib/audit.ts`)
- **Webhook** → `ALERT_WEBHOOK_URL` (Slack/Discord incoming webhook), a one-line
  instant ping. (`lib/audit.ts` + `instrumentation.ts` → `lib/alert.ts`)

Messages are de-duped to once per minute per error so a recurring fault won't
flood the channel. Both are fail-soft — if a channel isn't configured the error
is just logged to the server console; alerting never blocks or breaks the app.

**To turn the webhook on, follow `docs/SETUP-ALERTING.md`** (create a Slack/Discord
webhook, set `ALERT_WEBHOOK_URL`, add an uptime monitor on `/api/health`).

---

## 4. Common failures & fixes

### 4.1 "Could not open classroom" / token request fails (503)
LiveKit env not configured. Check `/api/health` → `config.livekit`. Set
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WS_URL`, redeploy.

### 4.2 Room frozen — video/audio stopped, data not flowing
The tutor has a **"Refresh all"** button in the controls bar — it reloads every
client (including the tutor) and auto-rejoins. First resort for a stuck room.
If it persists for everyone, check the LiveKit dashboard for the project/region
and that `LIVEKIT_WS_URL` is reachable (wss://).

### 4.3 Camera shows "half a face" / wrong crop
The tutor's main camera uses `object-contain` (full frame, no crop). If a feed
looks cropped, it's almost always a participant pinned with `object-cover`
tiles — unpin, or have them re-toggle their camera.

### 4.4 Captions don't appear
Captions are **server-side** (Deepgram via a LiveKit agent). Checklist:
- `DEEPGRAM_API_KEY` is set (`/api/health` → `config.captions: true`).
- The transcriber worker is running: `npm run transcriber` (dev) or deploy it as a separate process in production.
- The speaking participant's **mic must be ON** (tutor always; students after the tutor approves "Request to speak").
- Works in every browser — no Chrome-only Web Speech API requirement.
If captions are slow, confirm the transcriber agent is connected in the LiveKit dashboard for that room.

### 4.5 Invites/notifications not received
Email is **silently skipped** when Mailgun isn't configured (`/api/health` →
`config.email: false`). The in-app notification (bell) is still created. Fix:
set `MAILGUN_API_KEY` + `MAILGUN_DOMAIN`. Also confirm the recipient's address
and Mailgun's sending domain/allowed-recipients in the Mailgun dashboard.

### 4.6 Co-teacher invite didn't arrive
- The invitee **must already have a TUTOR account** (only tutors can enter
  `/tutor/*`). A student account can't be a co-teacher.
- They get an in-app notification + (if online) an instant "Join now" toast via
  Pusher. If the toast never shows, check `config.pusher`.
- The session also appears in their **/tutor/sessions** list tagged
  "Co-teaching".

### 4.7 Chat file upload fails
Allowed: images, video, PDF, Word, PowerPoint, Excel, .txt; **max 50 MB**.
Larger or other types are rejected client-side. If all uploads fail, check
`config.storage` and the S3 bucket's CORS (must allow PUT from the app origin).

### 4.8 Database errors / `/api/health` 503
Check `DATABASE_URL` and that Postgres is reachable. After any change to
`prisma/schema.prisma` the DB must be synced (see §5).

### 4.9 Recording missing after a session
- Card shows "Recording processing…" (egressId set, no URL yet) → wait; LiveKit
  Egress is still finalising the MP4 to S3.
- Never appears → check LiveKit Egress is enabled for the project and S3
  credentials/bucket are valid. Each pause/resume creates a separate segment.

---

## 5. Deploys & schema changes

- Build runs `prisma generate && next build` (see `package.json`).
- This project syncs the DB with **`npx prisma db push`** (no migrations
  folder). After editing `prisma/schema.prisma`:
  1. `npx prisma generate`
  2. `npx prisma db push` (additive changes are safe; `--accept-data-loss` only
     if you intend destructive changes)
- `app/generated/prisma` is the generated client (imported as
  `@/app/generated/prisma` / `.../enums`). Don't hand-edit it.

---

## 6. Environment variable checklist

```
DATABASE_URL
LIVEKIT_API_KEY  LIVEKIT_API_SECRET  LIVEKIT_WS_URL
PUSHER_APP_ID  PUSHER_SECRET  NEXT_PUBLIC_PUSHER_KEY  NEXT_PUBLIC_PUSHER_CLUSTER
AWS_S3_BUCKET  AWS_ACCESS_KEY_ID  AWS_SECRET_ACCESS_KEY  AWS_REGION
MAILGUN_API_KEY  MAILGUN_DOMAIN  (optional: MAILGUN_FROM, MAILGUN_API_BASE)
NEXT_PUBLIC_APP_URL          # used in email links
ALERT_WEBHOOK_URL            # optional: ops alerts
```

Verify quickly any time with `GET /api/health`.

---

## 7. Escalation

1. Check `/api/health` and the alert channel.
2. Work the matching section above.
3. If unresolved, capture: what the user did, the time, any error on screen,
   and the `/api/health` output — then escalate to the developer on record.
