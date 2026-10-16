import webpush from "web-push"
import { after } from "next/server"
import prisma from "@/lib/prisma"

/**
 * Web push to phones and desktops that turned on "Phone notifications".
 *
 * Called from lib/notifications.ts after the in-app notification is written,
 * so every notification the app already sends also reaches the lock screen.
 * Never throws. With the VAPID env vars unset (local, preview) it does nothing.
 *
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — `npx web-push generate-vapid-keys`
 *   VAPID_SUBJECT                        — mailto: contact for the push services
 *
 * The browser fetches the public key from GET /api/push/subscription at run
 * time, so no NEXT_PUBLIC_ copy is needed.
 */

let configured: boolean | null = null

export function pushConfigured(): boolean {
  if (configured !== null) return configured
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subject) return (configured = false)
  try {
    webpush.setVapidDetails(subject, pub, priv)
    configured = true
  } catch (err) {
    console.error("[push] VAPID keys are set but invalid — push is off", err)
    configured = false
  }
  return configured
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string }

/** Pushes to every device the user subscribed. Resolves to the number delivered. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } })
    if (subs.length === 0) return 0

    const json = JSON.stringify({ ...payload, url: payload.url ?? "/" })
    const results = await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            json,
            { TTL: 60 * 60 }, // an hour-old "class is starting" is no use to anyone
          )
          return true
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          // 404/410: the browser dropped this subscription (uninstalled, turned
          // off, cleared data). It will never work again, so forget it.
          if (status === 404 || status === 410) {
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
          } else {
            console.error(`[push] send failed (user=${userId}, status=${status ?? "?"})`, err)
          }
          return false
        }
      }),
    )
    return results.filter(Boolean).length
  } catch (err) {
    console.error(`[push] sendPushToUser failed (user=${userId})`, err)
    return 0
  }
}

/**
 * Runs `task` without holding up the caller. Inside a request it uses Next's
 * `after()`, so Vercel keeps the function alive until the push is handed off;
 * outside one (scripts, tests) it just fires the promise.
 */
export function inBackground(task: () => Promise<unknown>): void {
  try {
    after(task)
  } catch {
    void task().catch(() => {})
  }
}
