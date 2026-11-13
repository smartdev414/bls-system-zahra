"use client"

import { useState } from "react"
import { Link2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { UploadedFile } from "@/components/ui/file-upload"
import { parseVideoLink, videoLinkUrl, VIDEO_LINK_LABEL, VIDEO_LINK_MIME } from "@/lib/video-link"

/** A YouTube or Vimeo link in the shape of an uploaded file, so it is saved as a lesson asset like one. */
export function videoLinkAsFile(raw: string): UploadedFile | null {
  const link = parseVideoLink(raw)
  if (!link) return null
  return {
    fileUrl: videoLinkUrl(link),
    fileName: VIDEO_LINK_LABEL[link.provider],
    fileSize: 0,
    mimeType: VIDEO_LINK_MIME[link.provider],
    assetType: "VIDEO",
  }
}

/** A link already chosen, in place of the uploaded-file card. */
export function VideoLinkCard({ url, onRemove }: { url: string; onRemove?: () => void }) {
  const link = parseVideoLink(url)
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3 overflow-hidden">
      <div className="rounded-lg bg-primary/10 p-2 shrink-0">
        <Link2 className="size-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{link ? VIDEO_LINK_LABEL[link.provider] : "Video link"}</p>
        <a href={url} target="_blank" rel="noopener noreferrer" className="block text-xs text-muted-foreground truncate hover:underline">
          {url}
        </a>
      </div>
      {onRemove && (
        <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" onClick={onRemove} aria-label="Remove video link">
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

/** Paste a YouTube or Vimeo link instead of uploading a video. */
export function VideoLinkInput({ onAdded }: { onAdded: (file: UploadedFile) => void }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const file = videoLinkAsFile(value)
    if (!file) {
      setError("That isn't a YouTube or Vimeo video link. Copy the address of the video's own page.")
      return
    }
    setError(null)
    setValue("")
    onAdded(file)
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border-2 border-dashed p-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="https://www.youtube.com/watch?v=… or https://vimeo.com/…"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }}
          />
        </div>
        <Button type="button" onClick={add} disabled={!value.trim()}>Add video</Button>
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          The video plays inside the lesson. It must be public or unlisted, and allowed to be embedded.
        </p>
      )}
    </div>
  )
}
