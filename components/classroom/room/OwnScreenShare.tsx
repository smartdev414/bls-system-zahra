"use client"

// What the person sharing sees in place of their own screen share.
//
// Drawing your own share back onto the page makes it infinite when the whole
// screen (or the browser window) is shared: the capture includes the page, the
// page shows the capture, and each frame nests one more copy inside itself. The
// students received that stack of copies. Picking the classroom tab is already
// kept out of the picker (SCREEN_SHARE_CAPTURE), but whole screen and window
// can't be, so the sharer sees this note instead, with an opt-in preview.

import { useState } from "react"
import { VideoTrack } from "@livekit/components-react"
import type { TrackReference } from "@livekit/components-react"
import { Monitor, Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

export function OwnScreenShare({
  trackRef,
  compact = false,
}: {
  trackRef: TrackReference
  /** Tiles and small windows: icon and one line only. */
  compact?: boolean
}) {
  const [preview, setPreview] = useState(false)

  if (preview) {
    return (
      <div className="relative w-full h-full">
        <VideoTrack trackRef={trackRef} className="w-full h-full object-contain" />
        <button
          type="button"
          onClick={() => setPreview(false)}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-black/75 backdrop-blur-sm ring-1 ring-white/15 px-3 py-1 text-[11px] font-medium text-white/90 hover:text-white"
          title="Hide the preview of your own screen"
        >
          <EyeOff className="size-3.5" />
          Hide preview
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-3 px-4 text-center text-zinc-400 bg-zinc-950">
      <Monitor className={cn("opacity-60", compact ? "size-8" : "size-12")} />
      <span className={cn("font-medium text-zinc-200", compact ? "text-xs" : "text-sm")}>
        You&apos;re sharing your screen
      </span>
      {!compact && (
        <>
          <span className="max-w-sm text-xs text-zinc-500">
            Everyone else can see it. It isn&apos;t shown here, because showing it
            on this page makes it repeat inside itself.
          </span>
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 h-8 text-xs text-zinc-300 transition-colors"
            title="Show your own share here. If you're sharing your whole screen, it will repeat inside itself."
          >
            <Eye className="size-3.5" />
            Show preview
          </button>
        </>
      )}
    </div>
  )
}
