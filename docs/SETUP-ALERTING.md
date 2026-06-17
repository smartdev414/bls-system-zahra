# Setup: alerting & uptime monitoring

The code is wired; these are the one-time external steps to turn it on. ~10 min.

## What's already in place (no action needed)
- **Email alerts** on any server 5xx → sent to `DEV_EMAIL` (already set) via
  Mailgun. (`lib/audit.ts`)
- **Webhook alerts** on any server 5xx and on uncaught SSR errors → sent to
  `ALERT_WEBHOOK_URL` if set. (`lib/audit.ts`, `instrumentation.ts`, `lib/alert.ts`)
- **Health probe**: `GET /api/health`.

---

## Step 1 — Create a chat webhook (pick Slack *or* Discord)

### Slack
1. Go to <https://api.slack.com/apps> → **Create New App** → *From scratch*.
2. Name it (e.g. "BSL Alerts"), pick your workspace → **Create App**.
3. Left menu → **Incoming Webhooks** → toggle **Activate** on.
4. **Add New Webhook to Workspace** → choose the channel (e.g. `#bsl-alerts`) → **Allow**.
5. Copy the **Webhook URL** (`https://hooks.slack.com/services/...`).

### Discord (alternative)
1. Server → **Edit Channel** (the channel you want) → **Integrations** → **Webhooks**.
2. **New Webhook** → name it → **Copy Webhook URL**.

> The code sends both `text` (Slack) and `content` (Discord) fields, so either URL works as-is.

## Step 2 — Add it to the environment
In `.env` (and your hosting provider's env settings for production):
```
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
```
Restart `npm run dev` (or redeploy) so the new value is picked up.

## Step 3 — Test it
Trigger any server error, or temporarily add a throwing test route, and confirm
a `🚨 [BSL · ...] ...` message lands in the channel. Then remove the test route.
(Alerts for the same title are de-duped to once per minute.)

---

## Step 4 — External uptime monitor on `/api/health`
Use a free tier (UptimeRobot shown; BetterStack/Pingdom are equivalent).

1. Sign up at <https://uptimerobot.com> → **+ New monitor**.
2. **Monitor type:** HTTP(s). **URL:** `https://<your-domain>/api/health`.
3. **Monitoring interval:** 1–5 minutes.
4. (Recommended) **Advanced → Keyword monitoring:** alert if the response does
   **not** contain `"status":"ok"` — this catches DB-down (503) and degraded states.
5. Add an **alert contact** (email/SMS/Slack) and attach it to the monitor.
6. Save. You'll now be paged within minutes if the app or DB goes down.

---

## Step 5 — Fill in the runbook header
Open `docs/RUNBOOK.md` and complete the top block: primary/backup on-call,
hosting dashboard URL, LiveKit dashboard, Pusher dashboard. This is what lets a
second person cover support.
