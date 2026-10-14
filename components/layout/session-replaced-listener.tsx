"use client"

import { useEffect } from "react"
import { getPusherClient } from "@/lib/pusher-client"

// When the same student account signs in on another device, the server pings
// every open tab. Each tab asks whether it is still the current login; the old
// one is sent to the login page (leaving any live class it was in).
export function SessionReplacedListener({ userId }: { userId: string }) {
  useEffect(() => {
    if (!userId) return
    const pusher = getPusherClient()
    const ch = pusher.subscribe(`private-user-${userId}`)

    const handler = async () => {
      const res = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null)
      if (res?.status === 401) {
        window.location.href = "/login?reason=signed-in-elsewhere"
      }
    }

    ch.bind("session-replaced", handler)
    return () => {
      ch.unbind("session-replaced", handler)
    }
  }, [userId])

  return null
}
