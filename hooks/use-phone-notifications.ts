"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { netJson } from "@/lib/net-fetch"

/**
 * Web push on this device: whether it's on, and one call to turn it on or off.
 * The service worker (public/sw.js) shows the notifications; the server sends
 * them from lib/notifications.ts via lib/push.ts.
 *
 *   unsupported  — this browser can't do web push at all
 *   needs-install — iPhone/iPad in a Safari tab: push only works once the site
 *                   is added to the Home Screen and opened from there
 *   blocked      — the person said no; only the browser's site settings can undo it
 *   off / on     — the switch
 */
export type PhoneNotificationState = "loading" | "unsupported" | "needs-install" | "blocked" | "off" | "on"

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for a Home Screen web app
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false
  // iPadOS reports itself as a Mac; the touch points give it away
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

function base64UrlToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function saveSubscription(sub: PushSubscription) {
  await netJson("/api/push/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  })
}

export function usePhoneNotifications() {
  const [state, setState] = useState<PhoneNotificationState>("loading")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let next: PhoneNotificationState
      if (!pushSupported()) {
        next = isIOS() && !isStandalone() ? "needs-install" : "unsupported"
      } else if (Notification.permission === "denied") {
        next = "blocked"
      } else {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager.getSubscription()
        next = sub && Notification.permission === "granted" ? "on" : "off"
        // Re-save quietly: covers a different person having signed in on this
        // phone since, or the row having been cleaned up server-side.
        if (sub && next === "on") void saveSubscription(sub).catch(() => {})
      }
      if (!cancelled) setState(next)
    })()
    return () => { cancelled = true }
  }, [])

  const enable = useCallback(async () => {
    setBusy(true)
    try {
      const { publicKey } = await netJson<{ publicKey: string | null }>("/api/push/subscription")
      if (!publicKey) {
        toast.error("Phone notifications aren't available yet.")
        return false
      }
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off")
        return false
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register("/sw.js"))
      await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }))
      await saveSubscription(sub)
      setState("on")
      toast.success("Phone notifications are on")
      return true
    } catch (err) {
      console.error("[push] enable failed", err)
      toast.error("Couldn't turn on notifications. Please try again.")
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await netJson("/api/push/subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {}) // the unsubscribe below is what actually stops them
        await sub.unsubscribe()
      }
      setState("off")
    } catch (err) {
      console.error("[push] disable failed", err)
      toast.error("Couldn't turn off notifications. Please try again.")
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, busy, enable, disable }
}
