"use client"

import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useVideoCleanState } from "@/hooks/use-video-clean"

/**
 * Shows, next to a recorded video, that its background is still being
 * replaced or could not be (see lib/background-clean.ts) — with a retry for
 * the second. Renders nothing for a finished video or one that never needed it.
 */
export function VideoCleanBadge({ url, className, compact = false }: {
  url: string | null | undefined
  className?: string
  /** Icon and Retry only, for tight rows; the wording moves to the tooltip. */
  compact?: boolean
}) {
  const { state, retry } = useVideoCleanState(url)
  const [retrying, setRetrying] = useState(false)

  if (state === "processing") {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
        title={`${compact ? "Replacing background. " : ""}Students can't see this video until its background has been replaced. This takes a few minutes.`}
      >
        <Loader2 className="size-3 shrink-0 animate-spin" />
        {!compact && "Replacing background…"}
      </span>
    )
  }

  if (state === "failed") {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs text-destructive", className)}
        title={`${compact ? "Background not replaced. " : ""}Students can't see this video until its background has been replaced.`}
      >
        <AlertTriangle className="size-3 shrink-0" />
        {!compact && "Background not replaced"}
        <button
          type="button"
          disabled={retrying}
          onClick={async (e) => {
            // Badges sit inside clickable rows and cards.
            e.preventDefault()
            e.stopPropagation()
            setRetrying(true)
            try {
              await retry()
            } catch {
              toast.error("Could not retry — please try again in a moment")
            } finally {
              setRetrying(false)
            }
          }}
          className="rounded border border-destructive/40 px-1.5 py-0.5 font-medium hover:bg-destructive/10 disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      </span>
    )
  }

  return null
}
