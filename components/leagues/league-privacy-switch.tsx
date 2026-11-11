"use client"

import { useEffect, useState } from "react"
import { EyeOff } from "lucide-react"
import { usePutCallback } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

/**
 * A student's "keep my name and scores off the league tables". Shown under
 * the table itself and in Settings → Privacy. Other students stop seeing them;
 * they still see their own place, and staff still see everyone.
 */
export function LeaguePrivacySwitch({ hidden, onChanged, className }: {
  hidden: boolean
  onChanged?: (hidden: boolean) => void
  className?: string
}) {
  const [on, setOn] = useState(hidden)
  useEffect(() => { setOn(hidden) }, [hidden])
  const { execute: save, loading: saving } = usePutCallback<
    { user: { hideFromLeagueTables: boolean } },
    { hideFromLeagueTables: boolean }
  >("/api/user/settings", {
    successMessage: (d) => d.user.hideFromLeagueTables
      ? "Your name and scores are hidden from other students"
      : "Other students can see you on the league tables again",
    errorMessage: "Could not save",
    onSuccess: (d) => onChanged?.(d.user.hideFromLeagueTables),
    onError: (_e, body) => setOn(!body.hideFromLeagueTables),
  })

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={saving}
      onClick={() => { setOn(!on); void save({ hideFromLeagueTables: !on }) }}
      className={cn(
        "w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed",
        on ? "border-primary bg-primary/5" : "hover:bg-muted/50",
        className,
      )}
    >
      <EyeOff className="size-4 text-muted-foreground shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">Keep my scores private</span>
        <span className="block text-xs text-muted-foreground mt-0.5">
          {on
            ? "Other students don't see your name or scores on any league table. You still see your own place."
            : "Turn on and other students won't see your name or scores on league tables."}
        </span>
      </span>
      <span className={cn("relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-input")}>
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-background shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
      </span>
    </button>
  )
}
