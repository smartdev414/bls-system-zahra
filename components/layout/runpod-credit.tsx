"use client"

import { useEffect, useState } from "react"
import { Cpu } from "lucide-react"
import { cn } from "@/lib/utils"

// Below this the pill turns red: a few hours of video processing left.
const LOW_BALANCE_USD = 5

/** Credit left on the RunPod account that cleans video backgrounds. Admins only. */
export function RunpodCredit() {
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    fetch("/api/admin/runpod-balance")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { balance: number | null } | null) => setBalance(d?.balance ?? null))
      .catch(() => {})
  }, [])

  if (balance === null) return null

  return (
    <a
      href="https://console.runpod.io/user/billing"
      target="_blank"
      rel="noreferrer"
      title="RunPod credit left for video background replacement"
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors hover:bg-muted",
        balance < LOW_BALANCE_USD ? "text-destructive" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Cpu className="size-3.5" />
      ${balance.toFixed(2)}
    </a>
  )
}
