"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { getPusherClient } from "@/lib/pusher-client"

type CoTutorInvite = {
  sessionId: string
  sessionTitle: string
  from: string
  live?: boolean
}

// Listens on the tutor's personal Pusher channel for co-teaching invites and
// surfaces a toast with a one-click "Join now" action — so an online tutor is
// pulled into a live room immediately instead of waiting to notice the
// in-app notification. The notification + email remain the fallback.
export function CoTutorInviteListener({ userId }: { userId: string }) {
  const router = useRouter()

  useEffect(() => {
    if (!userId) return
    const pusher = getPusherClient()
    const ch = pusher.subscribe(`private-user-${userId}`)

    const handler = (data: CoTutorInvite) => {
      if (!data?.sessionId) return
      toast(
        data.live
          ? `${data.from} needs you in a live class`
          : `${data.from} invited you to co-teach`,
        {
          description: data.live
            ? `"${data.sessionTitle}" is live now — join as a second teacher.`
            : `"${data.sessionTitle}" — open the classroom when you're ready.`,
          duration: data.live ? 30_000 : 12_000,
          action: {
            label: data.live ? "Join now" : "Open",
            onClick: () => router.push(`/tutor/classroom/${data.sessionId}`),
          },
        },
      )
    }

    ch.bind("cotutor-invite", handler)
    return () => {
      ch.unbind("cotutor-invite", handler)
      pusher.unsubscribe(`private-user-${userId}`)
    }
  }, [userId, router])

  return null
}
