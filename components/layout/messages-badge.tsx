"use client"

import { useEffect, useState } from "react"
import { getPusherClient } from "@/lib/pusher-client"

export function MessagesBadge({ userId }: { userId: string }) {
  const [count, setCount] = useState(0)

  // Initial fetch
  useEffect(() => {
    fetch("/api/messages/unread")
      .then((r) => r.json())
      .then((d: { count: number }) => setCount(d.count))
      .catch(() => {})
  }, [])

  // Real-time updates via Pusher personal channel
  useEffect(() => {
    if (!userId) return
    const pusher = getPusherClient()
    const ch = pusher.subscribe(`private-user-${userId}`)

    ch.bind("new-message", () => {
      fetch("/api/messages/unread")
        .then((r) => r.json())
        .then((d: { count: number }) => setCount(d.count))
        .catch(() => {})
    })

    return () => {
      ch.unbind("new-message")
      pusher.unsubscribe(`private-user-${userId}`)
    }
  }, [userId])

  if (count === 0) return null

  return (
    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold min-w-[16px] h-4 px-1 leading-none">
      {count > 99 ? "99+" : count}
    </span>
  )
}
