"use client"

import { useEffect } from "react"

/** Stores the current user's ID in sessionStorage so Pusher channels can use it. */
export function UserIdSeeder({ userId }: { userId: string }) {
  useEffect(() => {
    if (userId) sessionStorage.setItem("userId", userId)
  }, [userId])
  return null
}
