"use client"

import { useEffect, useState } from "react"
import { getPusherClient } from "@/lib/pusher-client"

export function MessagesBadge({ userId }: { userId: string }) {
  const [count, setCount] = useState(0)

  function refreshCount() {
    fetch("/api/messages/unread")
      .then((r) => r.json())
      .then((d: { count: number }) => setCount(d.count))
      .catch(() => {})
  }

  // Initial fetch
  useEffect(() => {
    refreshCount()
  }, [])

  // Re-fetch when messages are read in the messaging center
  useEffect(() => {
    window.addEventListener("messages-read", refreshCount)
    return () => window.removeEventListener("messages-read", refreshCount)
  }, [])

  // Real-time updates via Pusher personal channel
  useEffect(() => {
    if (!userId) return
    const pusher = getPusherClient()
    const ch = pusher.subscribe(`private-user-${userId}`)

    ch.bind("new-message", refreshCount)

    return () => {
      ch.unbind("new-message", refreshCount)
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
