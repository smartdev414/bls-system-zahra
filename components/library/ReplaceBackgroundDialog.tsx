"use client"

/**
 * Give a library video a new background. The work is done by the same
 * server-side worker that handles recordings made with a colour chosen (see
 * lib/background-clean.ts); the original is kept and a new library file plays
 * the result once it is ready.
 */

import { useState } from "react"
import { Loader2, Wand2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { setVideoCleanState, type CleanState } from "@/hooks/use-video-clean"
import { BACKGROUND_IMAGES, BACKGROUND_PRESETS, DICTIONARY_BACKGROUND, backgroundImage } from "@/lib/background-presets"
import type { LibraryItem } from "@/lib/library"

type Props = {
  file: LibraryItem | null
  onClose: () => void
  /** The new library file, once the job has been handed over. */
  onStarted: (item: LibraryItem) => void
}

export function ReplaceBackgroundDialog({ file, onClose, onStarted }: Props) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      {file && <Body file={file} onClose={onClose} onStarted={onStarted} />}
    </Dialog>
  )
}

function Body({ file, onClose, onStarted }: { file: LibraryItem } & Omit<Props, "file">) {
  // The studio blue first, so a video filmed elsewhere matches the rest.
  const [color, setColor] = useState<string>(DICTIONARY_BACKGROUND)
  const [title, setTitle] = useState(() => `${file.title.replace(/\.[^.]+$/, "")} (new background)`)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const custom = !backgroundImage(color) && !BACKGROUND_PRESETS.some((p) => p.value === color)

  async function start() {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch("/api/upload/clean-background/from-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: file.fileUrl, color, title: title.trim() }),
      })
      const data = await res.json().catch(() => ({})) as { item?: LibraryItem; state?: CleanState; message?: string }
      if (!res.ok || !data.item) throw new Error(data.message ?? "Could not start background replacement")
      setVideoCleanState(data.item.fileUrl, data.state ?? "processing")
      if (data.state === "failed") {
        toast.error("The video was copied but the background job could not start. Press Retry next to it.")
      } else {
        toast.success("Replacing the background — you'll get a notification when it's ready")
      }
      onStarted(data.item)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start background replacement")
    } finally {
      setStarting(false)
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Wand2 className="size-4 text-primary" /> Replace the background</DialogTitle>
        <DialogDescription>
          The person in <span className="font-medium">{file.title}</span> is cut out and placed on the background you pick, with
          the logo added. The original video is kept; the result is a new video in the library.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Background</Label>
          <div className="flex flex-wrap items-center gap-2">
            {BACKGROUND_IMAGES.map((preset) => (
              <button
                key={preset.value}
                type="button"
                disabled={starting}
                onClick={() => setColor(preset.value)}
                aria-label={`${preset.label} background`}
                aria-pressed={color === preset.value}
                title={preset.label}
                className={cn(
                  "size-8 rounded-full border bg-cover bg-center transition-shadow disabled:opacity-50",
                  color === preset.value && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundImage: `url("${preset.value}")` }}
              />
            ))}
            {BACKGROUND_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                disabled={starting}
                onClick={() => setColor(preset.value)}
                aria-label={`${preset.label} background`}
                aria-pressed={color === preset.value}
                title={preset.label}
                className={cn(
                  "size-8 rounded-full border transition-shadow disabled:opacity-50",
                  color === preset.value && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: preset.value }}
              />
            ))}
            <label
              title="Custom colour"
              className={cn(
                "relative size-8 overflow-hidden rounded-full border",
                custom && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                starting && "opacity-50",
              )}
              style={{
                background: custom
                  ? color
                  : "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
              }}
            >
              <input
                type="color"
                aria-label="Custom background colour"
                disabled={starting}
                value={backgroundImage(color)?.average ?? color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clean-title">Name of the new video</Label>
          <Input id="clean-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={starting} />
        </div>

        <p className="text-xs text-muted-foreground">
          Works best when one person is filmed against a plain, still background in good light. It takes a few
          minutes — about twice the length of the video. Students can&apos;t see the new video until it is ready.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={starting}>Cancel</Button>
        <Button onClick={start} disabled={starting || !title.trim()}>
          {starting && <Loader2 className="size-4 animate-spin mr-1.5" />} Start
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
