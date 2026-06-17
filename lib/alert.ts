// Lightweight ops alerting. Posts a short message to an incoming webhook
// (Slack- or Discord-compatible) so the team learns about a server error or
// outage within minutes instead of mid-lesson.
//
// Configure ALERT_WEBHOOK_URL in the environment. If it's unset, alerts are
// logged to the server console only (same fail-soft pattern as lib/email.ts) —
// nothing throws, so alerting can never take the app down.

// In-memory dedupe so one recurring error doesn't flood the channel. Keyed by
// the alert title; the same title is re-sent at most once per window.
const DEDUPE_WINDOW_MS = 60_000
const lastSentAt = new Map<string, number>()

export async function sendAlert(title: string, detail?: string): Promise<void> {
  const now = Date.now()
  const last = lastSentAt.get(title) ?? 0
  if (now - last < DEDUPE_WINDOW_MS) return
  lastSentAt.set(title, now)

  const url = process.env.ALERT_WEBHOOK_URL
  const env = process.env.NODE_ENV ?? "development"
  const line = `🚨 [BSL · ${env}] ${title}${detail ? `\n${detail}` : ""}`

  if (!url) {
    console.warn("[alert] ALERT_WEBHOOK_URL not set — alert not delivered:", line)
    return
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` (Slack) and `content` (Discord) so either webhook type works.
      body: JSON.stringify({ text: line, content: line }),
    })
  } catch (err) {
    console.error("[alert] failed to deliver alert:", err)
  }
}
