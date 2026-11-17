"use client"

import { useEffect, useState } from "react"
import { Users2, Megaphone } from "lucide-react"
import { cn } from "@/lib/utils"
import type { BreakoutGroup } from "./types"
import { BreakoutCountdown } from "./BreakoutCountdown"

// Student-facing banner. Tells them which breakout group they're in, who else
// is in it, and whether the tutor is currently listening/talking to them.
// Collapses to a compact pill after a few seconds so it doesn't take real
// estate during the exercise.

export function BreakoutBanner({
  group,
  allParticipantNames,
  tutorVisiting,
  endsAt,
  closing,
}: {
  group: BreakoutGroup | null
  allParticipantNames: Map<string, string>
  tutorVisiting: boolean
  // Unix ms when the breakout is scheduled to close. `null` = no timer set.
  endsAt: number | null
  // True once the wrap-up countdown back to the main room has started.
  closing: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  // Reset the expanded state whenever we move between groups — React's
  // canonical "reset state on prop change" pattern (comparison in render).
  const [lastGroupId, setLastGroupId] = useState(group?.id ?? null)
  if (group?.id !== lastGroupId) {
    setLastGroupId(group?.id ?? null)
    setExpanded(true)
  }

  useEffect(() => {
    if (!group) return
    const t = setTimeout(() => setExpanded(false), 6000)
    return () => clearTimeout(t)
  }, [group])

  if (!group) return null

  const mateNames = group.memberIds
    .map((id) => allParticipantNames.get(id) ?? id)
    .filter(Boolean)

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-[90%]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-full backdrop-blur-sm shadow-lg transition-all border",
          expanded
            ? "px-4 py-2 bg-black/80 border-primary/40"
            : "px-3 py-1.5 bg-black/60 hover:bg-black/80 border-white/10"
        )}
      >
        <Users2 className={cn("shrink-0", expanded ? "size-4 text-primary" : "size-3.5 text-primary")} />
        <span className={cn("font-bold text-white", expanded ? "text-sm" : "text-xs")}>
          {group.name}
        </span>
        {tutorVisiting && (
          <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 text-[0.625rem] font-bold px-2 py-0.5 rounded-full border border-emerald-500/40">
            <Megaphone className="size-2.5" />
            Tutor is here
          </span>
        )}
        {endsAt && <BreakoutCountdown endsAt={endsAt} closing={closing} />}
        {expanded && mateNames.length > 0 && (
          <span className="text-xs text-zinc-300 truncate max-w-[40ch]">
            · with {mateNames.slice(0, 4).join(", ")}
            {mateNames.length > 4 ? ` +${mateNames.length - 4} more` : ""}
          </span>
        )}
      </button>
    </div>
  )
}
