"use client"

/**
 * "Add to a class" from the library: attach the file to one of the person's
 * upcoming live classes as a resource, ready to present in the classroom.
 */

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { LibraryItem } from "@/lib/library"

type SessionRow = {
  id: string
  title: string
  scheduledAt: string
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
  isCoTutor: boolean
  tutorId?: string
  course: { title: string } | null
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

type Props = {
  file: LibraryItem | null
  onClose: () => void
}

export function UseInClassDialog({ file, onClose }: Props) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      {file && <Body file={file} onClose={onClose} />}
    </Dialog>
  )
}

function Body({ file, onClose }: { file: LibraryItem; onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [sessionId, setSessionId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/tutor/sessions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { sessions: SessionRow[] }) => { if (!cancelled) setSessions(d.sessions) })
      .catch(() => { if (!cancelled) setError("Could not load your classes") })
    return () => { cancelled = true }
  }, [])

  // Resources can only be added to a class the person runs themselves, and
  // there is no point adding to one that has already happened.
  const upcoming = useMemo(() => {
    let me: string | null = null
    try { me = sessionStorage.getItem("userId") } catch { /* private mode */ }
    return (sessions ?? [])
      .filter((s) => (s.status === "SCHEDULED" || s.status === "LIVE") && !s.isCoTutor && (!s.tutorId || !me || s.tutorId === me))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  }, [sessions])

  async function add() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tutor/sessions/${sessionId}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: file.title,
          fileUrl: file.fileUrl,
          fileName: file.fileName,
          fileSize: file.fileSize ?? undefined,
          mimeType: file.mimeType ?? undefined,
          presentationUrl: file.presentationUrl ?? undefined,
          presentationMimeType: file.presentationMimeType ?? undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string }
        throw new Error(d.message ?? "Could not add the file to the class")
      }
      const chosen = upcoming.find((s) => s.id === sessionId)
      toast.success(`Added to ${chosen?.title ?? "the class"}`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the file to the class")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Add to a class</DialogTitle>
        <DialogDescription>
          <span className="font-medium">{file.title}</span> becomes a resource of the class, to present in the classroom.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="use-session">Class</Label>
        {sessions === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading classes…</p>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no upcoming classes. Schedule one first, then add the file to it.</p>
        ) : (
          <select id="use-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)} className={selectClass} disabled={saving}>
            <option value="">Choose a class</option>
            {upcoming.map((s) => (
              <option key={s.id} value={s.id}>
                {format(new Date(s.scheduledAt), "EEE d MMM, HH:mm")} — {s.title}{s.course ? ` (${s.course.title})` : ""}
              </option>
            ))}
          </select>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={add} disabled={!sessionId || saving}>
          {saving && <Loader2 className="size-4 animate-spin mr-1.5" />} Add to class
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
