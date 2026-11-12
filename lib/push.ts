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

/**
 * The Teach Me Sign phone app (Expo) registers its device token through
 * POST /api/push/expo. It is kept in PushSubscription like a browser's, with
 * the token as `endpoint` and this marker in p256dh/auth, so no extra table is
 * needed. Expo's push service needs no keys; EXPO_ACCESS_TOKEN is only used if
 * the owner turns on "enhanced push security" in their Expo account.
 */
export const EXPO_MARKER = "expo"
export const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[.+\]$/.test(t)

/** Pushes to every device the user subscribed. Resolves to the number delivered. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  try {
    // A suspended student gets no class reminders or alerts until they're back.
    const subs = await prisma.pushSubscription.findMany({ where: { userId, user: { status: { not: "SUSPENDED" } } } })
    if (subs.length === 0) return 0

    const expoSubs = subs.filter((s) => s.p256dh === EXPO_MARKER)
    const webSubs = pushConfigured() ? subs.filter((s) => s.p256dh !== EXPO_MARKER) : []

    const json = JSON.stringify({ ...payload, url: payload.url ?? "/" })
    const results = await Promise.all(
      webSubs.map(async (s) => {
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
    const expoDelivered = expoSubs.length ? await sendExpo(userId, expoSubs, payload) : 0
    return results.filter(Boolean).length + expoDelivered
  } catch (err) {
    console.error(`[push] sendPushToUser failed (user=${userId})`, err)
    return 0
  }
}

type ExpoTicket = { status: "ok" | "error"; message?: string; details?: { error?: string } }

async function sendExpo(
  userId: string,
  subs: { id: string; endpoint: string }[],
  payload: PushPayload,
): Promise<number> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" }
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify(
        subs.map((s) => ({
          to: s.endpoint,
          title: payload.title,
          body: payload.body,
          sound: "default",
          channelId: "default",
          ttl: 60 * 60,
          data: { url: payload.url ?? null },
        })),
      ),
    })
    const out = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null
    if (!res.ok || !out?.data) {
      console.error(`[push] expo send failed (user=${userId}, status=${res.status})`)
      return 0
    }
    let ok = 0
    await Promise.all(
      out.data.map(async (t, i) => {
        if (t.status === "ok") return void ok++
        // The app was uninstalled or the token is dead: forget it.
        if (t.details?.error === "DeviceNotRegistered") {
          await prisma.pushSubscription.delete({ where: { id: subs[i].id } }).catch(() => {})
        } else {
          console.error(`[push] expo ticket error (user=${userId}): ${t.details?.error ?? t.message}`)
        }
      }),
    )
    return ok
  } catch (err) {
    console.error(`[push] expo send failed (user=${userId})`, err)
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
