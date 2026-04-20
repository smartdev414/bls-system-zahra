"use client"

import { useEffect, useState } from "react"
import { Timer, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export function BreakoutCountdown({
  endsAt,
  variant = "default",
}: {
  endsAt: number | null
  variant?: "default" | "compact"
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!endsAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [endsAt])

  if (!endsAt) return null

  const remainingMs = Math.max(0, endsAt - now)
  const totalSec    = Math.ceil(remainingMs / 1000)
  const mm          = Math.floor(totalSec / 60)
  const ss          = totalSec % 60
  const mmss        = `${mm}:${String(ss).padStart(2, "0")}`

  const urgent = totalSec <= 30 && totalSec > 0
  const expired = totalSec === 0

  if (variant === "compact") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border tabular-nums",
          expired
            ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
            : urgent
              ? "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse"
              : "bg-zinc-800 text-zinc-300 border-zinc-700"
        )}
        title={expired ? "Time's up — ending now" : `${mmss} left before breakouts close`}
      >
        {expired ? <AlertTriangle className="size-2.5" /> : <Timer className="size-2.5" />}
        {expired ? "Ending…" : mmss}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border tabular-nums",
        expired
          ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
          : urgent
            ? "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse"
            : "bg-zinc-800 text-zinc-200 border-zinc-700"
      )}
      title={expired ? "Time's up — ending now" : `${mmss} until we return to the main room`}
    >
      {expired ? <AlertTriangle className="size-3" /> : <Timer className="size-3" />}
      {expired ? "Time's up" : `${mmss} left`}
    </span>
  )
}
