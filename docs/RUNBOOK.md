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
| Live captions | LiveKit agent + **Inference STT** | LiveKit creds; deploy agent on LiveKit Cloud |
| Realtime across pages (messaging badge, **co-teacher pull-in**) | Pusher | `PUSHER_*`, `NEXT_PUBLIC_PUSHER_*` |
| File uploads & recordings | AWS S3 | `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID/SECRET`, `AWS_REGION` |
| Session recording | LiveKit Egress → S3 | LiveKit + S3 |
| Email (invites, notifications) | Mailgun | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` |
| Ops alerts | Webhook (Slack/Discord) | `ALERT_WEBHOOK_URL` |
| Locked-down student networks (NHS, police, schools) | Network modes + connection check | (no extra config) — see `docs/SECURE-NETWORKS.md` |

### 1.1 Roles & permissions

Four roles, defined once in **`lib/permissions.ts`**. Routes ask for a
*capability* (`can(session.role, "sessions.create")`), never for a role name, so
changing what a role may do is one edit in `ROLE_CAPABILITIES` — not a sweep
through 60 route handlers.

| Role | Dashboard | What it's for |
|---|---|---|
| `STUDENT` | `/student` | Learners |
| `TUTOR` | `/tutor` | Teaching staff — own their courses, lessons and classes |
| `SUPPORT` | `/support` | **Support Team** — office staff |
| `ADMIN` | `/admin` (and `/support`) | Full platform access |

**Support Team** exists so office staff can run the day-to-day without seeing
confidential material. They **can**:

- schedule classes and build the timetable (they name the tutor who takes it)
- create courses and enrol students onto them
- add and edit student/tutor accounts, and send invites
- run connection/webcam checks with someone on the phone
- work the support-ticket queue

They **cannot**:

- open lesson resources, attach or download course materials, or play recordings
- open the sign **dictionary**
- enter a classroom or start/stop a live session
- see audit logs, platform settings, categories or certifications
- see or change `ADMIN`/`SUPPORT` accounts, or promote anyone to a staff role

Creating one: an admin opens `/admin/users`, finds the person, and sets their
role to **Support Team**. Only admins see that option — `users.assignStaffRole`
is enforced server-side in `PATCH /api/admin/users/[id]`, not just hidden in
the UI.

Because support staff can't teach, `POST /api/tutor/sessions` and
`POST /api/tutor/courses` require an explicit `tutorId` from them — a class
always ends up owned by a real tutor.

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

Students have their own **Refresh** button next to it, which reloads only their
tab and rejoins without the lobby.

### 4.2b Student joined late (or refreshed) and sees no slides / no chat
Both are restored from the server, so this is a data problem rather than a
timing one:
- **Slides/video** come from `GET /api/sessions/[id]/live-state`, written by the
  tutor on every start / slide change / stop. If it 500s, the
  `LiveSessionPresentation` table is missing — run the schema sync in §5. The
  room still works: it falls back to asking the tutor's browser directly.
- **Chat** comes from `GET /api/sessions/[id]/chat` (last 500 messages). A
  student who is neither invited nor approved for an INVITE_ONLY session gets a
  403 and an empty panel — check their invite/join request.
- A half-typed message, the current slide and a raised hand are also mirrored
  into that tab's `sessionStorage`, so a reload restores them instantly. Private
  browsing with storage disabled loses only that instant restore — the server
  copies still arrive a moment later.
- A student stuck on the *wrong* slide (rather than none) self-corrects within
  ~20s: while a lesson is on screen, students re-read the stored stage after any
  quiet spell and follow it. If one student stays behind for minutes, their tab
  can't reach the API — check the browser console, not LiveKit.
- The stored stage is deleted when the session completes or is cancelled, so an
  old deck can never reappear in a session that goes live again.

### 4.3 Camera shows "half a face" / wrong crop
The tutor's main camera uses `object-contain` (full frame, no crop). If a feed
looks cropped, it's almost always a participant pinned with `object-cover`
tiles — unpin, or have them re-toggle their camera.

### 4.4 Captions don't appear
Captions are **server-side** (LiveKit Inference STT via a `classroom-transcriber` agent).
No separate Deepgram API key — STT is billed through your LiveKit Cloud plan.

Checklist:
- LiveKit is configured (`/api/health` → `config.captions: true`, same as `livekit`).
- **Production:** the transcriber agent is deployed on LiveKit Cloud (`lk agent deploy`).
  **Local dev:** `npm run transcriber` in a second terminal alongside `npm run dev`.
- The speaking participant's **mic must be ON** (tutor always; students after the tutor approves "Request to speak").
- Works in every browser — no Chrome-only Web Speech API requirement.

If captions are slow or missing, confirm the agent is connected in the LiveKit dashboard
for that room. Free/Build plans allow **5 concurrent STT** streams — enough for typical
request-to-speak classrooms; upgrade if many people speak at once.

**Production agent (LiveKit Cloud):** `classroom-transcriber` — agent ID `CA_uQD4KLT29Emo`,
region `eu-central`. Redeploy after code changes:

```bash
npm run transcriber:deploy
```

First-time setup (already done): `lk agent create --config agents/classroom-transcriber/livekit.toml --region eu-central --secrets-file agents/classroom-transcriber/secrets.env -y .`
Local dev only: `npm run transcriber` in a second terminal — **stop the local worker** when
testing against the cloud agent to avoid duplicate dispatch.

**Do not run local + cloud transcriber at the same time** — they compete for the same room jobs.

### 4.4b "It works at home but not at my hospital / station / school"

The platform has first-class support for locked-down networks. Full detail in
**`docs/SECURE-NETWORKS.md`**; the 30-second version:

1. Send them to **`/student/connection-check`**, run **on the work computer**.
   It makes a real classroom connection and reports what the network allows.
2. If it recommends **Restricted network mode**, have them press the button.
   That relays all media over TLS on TCP 443 instead of UDP.
3. If it says the network is blocking us, have them press **Copy test report**
   and send it, plus the public **`/it-requirements`** link, to their IT team.

The classroom also escalates by itself: a student whose connection fails is
retried in Restricted, then Minimal data, before being shown the blocked screen.
So a report of "connection lost" is a *different* fault from "this network is
blocking the classroom" — the second one means every path was tried.

Key thing to tell an IT team: **UDP does not need to be opened.** Restricted
mode is TLS on 443 to `*.livekit.cloud`, which is what most refusals are about.

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
- This project syncs the DB with **`npx prisma db push`**. After editing
  `prisma/schema.prisma`:
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
