"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, Clock, FileText, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload"
import { releaseFromIso, releaseToIso } from "@/components/courses/ReleaseField"
import { useFetch } from "@/hooks/use-fetch"

type Handout = { id: string; title: string; fileName: string; fileUrl: string; releaseAt: string }

const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/**
 * Files the students of a class keep — opened to them at a date and time the
 * tutor sets (the end of the class unless changed), when they get an email.
 */
export function ClassHandoutsDialog({ sessionId, sessionTitle, onClose }: {
  sessionId: string
  sessionTitle: string
  onClose: () => void
}) {
  const url = `/api/tutor/sessions/${sessionId}/handouts`
  const { data, loading, mutate } = useFetch<{ handouts: Handout[]; classEndsAt: string }>(url, {
    errorMessage: "Could not load the handouts",
  })
  const handouts = data?.handouts ?? []
  // The time new files open; starts at the end of the class, or now if that has passed.
  const [releaseAt, setReleaseAt] = useState<string | null>(null)
  const defaultRelease = data
    ? releaseFromIso(new Date(Math.max(new Date(data.classEndsAt).getTime(), Date.now())).toISOString())
    : ""
  const releaseValue = releaseAt ?? defaultRelease
  const [saving, setSaving] = useState(false)

  async function add(file: UploadedFile) {
    setSaving(true)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseAt: releaseToIso(releaseValue) ?? undefined,
          files: [{ fileUrl: file.fileUrl, fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType }],
        }),
      })
      const body = await res.json().catch(() => ({})) as { handouts?: Handout[]; message?: string }
      if (!res.ok || !body.handouts) throw new Error(body.message ?? "Could not add the handout")
      mutate((d) => d && { ...d, handouts: body.handouts! })
      const opens = releaseToIso(releaseValue)
      toast.success(!opens || new Date(opens) <= new Date()
        ? "Handout added — students have been told"
        : `Handout added — students get it ${whenLabel(opens)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the handout")
    } finally {
      setSaving(false)
    }
  }

  async function move(h: Handout, local: string) {
    const iso = releaseToIso(local)
    if (!iso || iso === h.releaseAt) return
    const res = await fetch(`${url}/${h.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseAt: iso }),
    })
    if (!res.ok) return toast.error("Could not change the time")
    mutate((d) => d && { ...d, handouts: d.handouts.map((x) => (x.id === h.id ? { ...x, releaseAt: iso } : x)) })
  }

  async function remove(h: Handout) {
    if (!window.confirm(`Remove "${h.title}"? Students will no longer be able to download it.`)) return
    const res = await fetch(`${url}/${h.id}`, { method: "DELETE" })
    if (!res.ok) return toast.error("Could not remove the handout")
    mutate((d) => d && { ...d, handouts: d.handouts.filter((x) => x.id !== h.id) })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4 text-primary" /> Class handouts
          </DialogTitle>
          <DialogDescription>
            For &quot;{sessionTitle}&quot;. Students can download these from the date and time you set, and get an
            email when they open.
          </DialogDescription>
        </DialogHeader>

        {loading && !data ? (
          <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : (
          <div className="flex flex-col gap-4">
            {handouts.length > 0 && (
              <ul className="flex flex-col gap-2">
                {handouts.map((h) => {
                  const open = new Date(h.releaseAt) <= new Date()
                  return (
                    <li key={h.id} className="rounded-xl border bg-muted/30 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <a href={h.fileUrl} target="_blank" rel="noopener noreferrer"
                          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                          {h.title}
                        </a>
                        <Button type="button" variant="ghost" size="icon"
                          className="size-7 shrink-0 text-destructive hover:text-destructive"
                          aria-label={`Remove ${h.title}`} onClick={() => remove(h)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6 text-xs">
                        {open ? (
                          <span className="flex items-center gap-1 font-medium text-emerald-700">
                            <CheckCircle2 className="size-3.5" /> Students have it
                          </span>
                        ) : (
                          <>
                            <span className="flex items-center gap-1 text-amber-700">
                              <Clock className="size-3.5" /> Opens
                            </span>
                            <Input
                              type="datetime-local"
                              defaultValue={releaseFromIso(h.releaseAt)}
                              onBlur={(e) => move(h, e.target.value)}
                              className="h-7 w-auto text-xs"
                              aria-label={`When students get ${h.title}`}
                            />
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
              <Label htmlFor="handout-release">Students get new handouts on</Label>
              <Input
                id="handout-release"
                type="datetime-local"
                value={releaseValue}
                onChange={(e) => setReleaseAt(e.target.value)}
                className="w-auto"
              />
              <p className="text-xs text-muted-foreground">
                Starts at the end of the class. Set the date and time first, then add the file.
              </p>
              {saving ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Saving…
                </div>
              ) : (
                <FileUpload
                  accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.ppt,.pptx,image/*,audio/*,video/*"
                  label="Add a handout (PDF, Word, PowerPoint, image, audio, video)"
                  uploaded={null}
                  onUploaded={add}
                />
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
