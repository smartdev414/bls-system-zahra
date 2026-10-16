"use client"

import { useEffect } from "react"
import { getPusherClient } from "@/lib/pusher-client"

// While the tab is on screen it re-checks this often, in case the realtime
// message below never arrived (a locked-down network that blocks it, say).
const CHECK_EVERY_MS = 60_000

// When the same student account signs in on another device, the server pings
// every open tab. Each tab asks whether it is still the current login; the old
// one is sent to the login page (leaving any live class it was in).
//
// The ping alone is not enough: a tablet or phone that is asleep, or a tab in
// the background, has its connection paused and misses it — then sits showing
// the dashboard as if still signed in until the next click. So the tab also
// checks the moment it comes back on screen, whenever its connection comes
// back, and every minute while it is being looked at.
export function SessionReplacedListener({ userId }: { userId: string }) {
  useEffect(() => {
    if (!userId) return
    let leaving = false

    const check = async () => {
      if (leaving) return
      const res = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null)
      // Only a definite "not signed in" counts — a network blip is not a sign-out.
      if (res?.status === 401 && !leaving) {
        leaving = true
        window.location.href = "/login?reason=signed-in-elsewhere"
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check()
    }
    // iOS restores a page from its back/forward cache without reloading it.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check()
    }

    const pusher = getPusherClient()
    const ch = pusher.subscribe(`private-user-${userId}`)
    ch.bind("session-replaced", check)
    // Messages sent while the connection was down are not replayed.
    const onState = ({ current }: { current: string }) => {
      if (current === "connected") void check()
    }
    pusher.connection.bind("state_change", onState)

    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    window.addEventListener("pageshow", onPageShow)
    const timer = setInterval(onVisible, CHECK_EVERY_MS)

    return () => {
      ch.unbind("session-replaced", check)
      pusher.connection.unbind("state_change", onState)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
      window.removeEventListener("pageshow", onPageShow)
      clearInterval(timer)
    }
  }, [userId])

  return null
}
