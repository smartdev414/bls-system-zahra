"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { getPusherClient } from "@/lib/pusher-client"

type SessionStatusEvent = {
  sessionId: string
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
  title: string
}

export const SESSION_STATUS_EVENT = "bsl:session-status"

// Listens for session status changes (e.g. host ended the class) and surfaces
// them to any open tutor page — especially co-teachers who can't end sessions.
export function SessionStatusListener({ userId }: { userId: string }) {
  const router = useRouter()

  useEffect(() => {
    if (!userId) return
    const pusher = getPusherClient()
    const ch = pusher.subscribe(`private-user-${userId}`)

    const handler = (data: SessionStatusEvent) => {
      if (!data?.sessionId || !data?.status) return

      window.dispatchEvent(new CustomEvent(SESSION_STATUS_EVENT, { detail: data }))

      if (data.status === "COMPLETED") {
        toast.info(`"${data.title}" has ended`, { duration: 8000 })
      } else if (data.status === "CANCELLED") {
        toast.info(`"${data.title}" was cancelled`, { duration: 8000 })
      }

      // If the co-teacher is sitting on the sessions list, nudge a refresh.
      if (data.status === "COMPLETED" || data.status === "CANCELLED") {
        router.refresh()
      }
    }

    ch.bind("session-status", handler)
    return () => {
      ch.unbind("session-status", handler)
      pusher.unsubscribe(`private-user-${userId}`)
    }
  }, [userId, router])

  return null
}
