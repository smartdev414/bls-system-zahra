"use client"

import { useState } from "react"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SegmentedVideoPlayer } from "@/components/ui/segmented-video-player"

/**
 * "Watch recording" for one class: fetches the recording's segments when
 * pressed and plays them in a dialog, watch-only.
 */
export function RecordingButton({
  sessionId,
  title,
  label = "Watch recording",
  ...buttonProps
}: {
  sessionId: string
  title: string
  label?: string
} & Omit<React.ComponentProps<typeof Button>, "onClick" | "children">) {
  const [open, setOpen] = useState(false)
  const [segments, setSegments] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  async function openRecording() {
    setLoading(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/recording`)
      const data = (await res.json()) as { url?: string; segments?: string[]; message?: string }
      if (!res.ok) {
        toast.error(data.message ?? "Recording is not available yet")
        return
      }
      const segs = data.segments ?? (data.url ? [data.url] : [])
      if (segs.length) {
        setSegments(segs)
        setOpen(true)
      }
    } catch {
      toast.error("Could not load the recording")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button {...buttonProps} disabled={loading || buttonProps.disabled} onClick={openRecording}>
        {loading ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Play className="size-3.5 mr-1.5" />}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{title} — Recording</DialogTitle>
          </DialogHeader>
          {segments.length > 0 && (
            <SegmentedVideoPlayer
              segments={segments}
              className="w-full rounded-lg bg-black"
              style={{ maxHeight: "60vh" }}
              autoPlay
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
