"use client"

/**
 * Record a video straight into the library, to be picked into a lesson, a
 * test or a class later — rather than recording inside one lesson's form and
 * losing it if that lesson is never saved.
 */

import { useState } from "react"
import { format } from "date-fns"
import { Camera, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CameraRecorder } from "@/components/ui/camera-recorder"
import type { UploadedFile } from "@/components/ui/file-upload"
import { COURSE_LEVELS, levelLabel, type CourseLevel } from "@/lib/levels"
import { cn } from "@/lib/utils"

type Props = {
  /** Admins file the recording under a level in the school's library. */
  canManage: boolean
  selectClass: string
  onAdded: () => void
  onClose: () => void
}

export function RecordToLibraryCard({ canManage, selectClass, onAdded, onClose }: Props) {
  const [title, setTitle] = useState(() => `Recording ${format(new Date(), "d MMM yyyy HH:mm")}`)
  const [level, setLevel] = useState<CourseLevel | "">("")
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null)
  const [saving, setSaving] = useState(false)

  async function addToLibrary(file: UploadedFile) {
    setSaving(true)
    try {
      const res = await fetch("/api/tutor/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [{ ...file, title: title.trim() || file.fileName }], level: level || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string }
        throw new Error(d.message ?? "Could not add the recording to the library")
      }
      toast.success("Recording added to the library")
      onAdded()
      onClose()
    } catch (e) {
      // The video is uploaded; only the library entry failed, so offer to try again.
      toast.error(e instanceof Error ? e.message : "Could not add the recording to the library")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-4 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Camera className="size-4 text-primary" /> Record a video
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pause whenever you like; after Stop you can cut the start and end before it is saved. The video goes
            into {canManage ? "the school's library" : "your library"}, ready to add to a lesson, a test or a class.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={onClose} aria-label="Close recorder">
          <X className="size-4" />
        </Button>
      </div>

      <div className={cn("grid gap-3", canManage ? "sm:grid-cols-[1fr_auto]" : "")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="library-recording-title">Title</Label>
          <Input
            id="library-recording-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Greetings — the short story"
            disabled={saving}
          />
        </div>
        {canManage && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="library-recording-level">Level</Label>
            <select
              id="library-recording-level"
              value={level}
              onChange={(e) => setLevel(e.target.value as CourseLevel | "")}
              className={selectClass}
              disabled={saving}
            >
              <option value="">Any level</option>
              {COURSE_LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
            </select>
          </div>
        )}
      </div>

      <CameraRecorder
        uploaded={uploaded}
        onUploaded={(file) => { setUploaded(file); void addToLibrary(file) }}
        onRemove={() => setUploaded(null)}
        disabled={saving}
      />

      {uploaded && !saving && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => addToLibrary(uploaded)}>Add to library</Button>
        </div>
      )}
      {saving && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Adding to the library…
        </p>
      )}
    </section>
  )
}
