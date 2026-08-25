"use client"

// Pre-class slide prep, shown on the session page so a teacher can have the
// lesson loaded and the slides chosen before anyone joins. Whatever is prepared
// here is the same resource the classroom presents, so going live is one click
// with no upload, no conversion wait, and no slide-picking in front of a class.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Presentation, Upload, Loader2, FileText, Film, Trash2, ListChecks, CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { SlidePicker } from "./SlidePicker"
import {
  fetchPreparedPresentation,
  registerPresentation,
  uploadPresentation,
  type PreparedPresentation,
} from "@/lib/slide-upload"
import type { UploadedSlides } from "./room/types"

const ACCEPT =
  ".pdf,.ppt,.pptx,.mp4,.mov,.webm," +
  "application/pdf,application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "video/mp4,video/quicktime,video/webm"

type SlidesUpload = Extract<UploadedSlides, { kind: "slides" }>

export function SlidePrepCard({ sessionId }: { sessionId: string }) {
  const [prepared, setPrepared] = useState<PreparedPresentation | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState(false)
  const [progress, setProgress] = useState("")
  // Non-null while the tutor is choosing which slides to include.
  const [picking,  setPicking]  = useState<SlidesUpload | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const resource = await fetchPreparedPresentation(sessionId)
    setPrepared(resource)
    setLoading(false)
  }, [sessionId])

  useEffect(() => { void reload() }, [reload])

  const isVideo = !!prepared?.mimeType?.startsWith("video/")
  const total    = prepared?.totalPages ?? 0
  const selected = prepared?.selectedPages?.length ?? 0

  async function handleFile(file: File) {
    setBusy(true)
    try {
      const result = await uploadPresentation(sessionId, file, setProgress)
      if (result.kind === "video") {
        toast.success("Video ready for the lesson")
        await reload()
        return
      }
      // Slides go straight into the picker so the deck is fully prepared in one
      // sitting; the upload is already saved if the tutor closes it.
      await reload()
      setPicking(result)
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Upload failed")
    } finally {
      setBusy(false)
      setProgress("")
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handlePicked(selectedPages: number[]) {
    if (!picking) return
    const deck = picking
    setPicking(null)
    setBusy(true)
    try {
      await registerPresentation(sessionId, {
        fileUrl:  deck.url,
        fileName: deck.fileName,
        mimeType: deck.mimeType,
        selectedPages,
        totalPages: deck.total,
      })
      toast.success(
        `${selectedPages.length} slide${selectedPages.length === 1 ? "" : "s"} ready to present`,
      )
      await reload()
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Could not save your slide selection")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      const res = await fetch(`/api/tutor/sessions/${sessionId}/slides`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not remove")
      setPrepared(null)
      toast.success("Slides removed")
    } catch {
      toast.error("Could not remove the slides")
    } finally {
      setBusy(false)
    }
  }

  // Re-open the picker for an already-prepared deck, on the choice already
  // made. Opening on "everything ticked" meant a tutor adjusting one page had
  // to re-exclude all the others from scratch, and losing that work silently is
  // worse than not offering the button.
  function handleReselect() {
    if (!prepared?.mimeType || !prepared.totalPages) return
    setPicking({
      kind: "slides",
      url: prepared.fileUrl,
      total: prepared.totalPages,
      mimeType: prepared.mimeType,
      fileName: prepared.fileName,
      selectedPages: prepared.selectedPages ?? undefined,
    })
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Presentation className="size-4 text-primary" />
            Lesson slides
          </CardTitle>
          {prepared && !busy && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="size-3.5" />
              Ready
            </span>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload your deck before the lesson and choose which slides to show. It
            will be waiting on the stage when you open the classroom — no uploading
            or converting in front of your students.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="size-4 animate-spin" />
              Checking for prepared slides…
            </div>
          ) : busy ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              {progress || "Saving…"}
            </div>
          ) : prepared ? (
            <div className="rounded-xl border bg-muted/40 p-3 space-y-3">
              <div className="flex items-start gap-3">
                {isVideo
                  ? <Film className="size-5 text-primary shrink-0 mt-0.5" />
                  : <FileText className="size-5 text-primary shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{prepared.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {isVideo
                      ? "Video — plays in sync for every student"
                      : total > 0
                        ? selected > 0
                          ? `${selected} of ${total} slides selected`
                          : `${total} slides — none picked yet, all will show`
                        : "Slides ready"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {!isVideo && total > 0 && (
                  <Button size="sm" variant="outline" onClick={handleReselect}>
                    <ListChecks className="size-3.5" />
                    {selected > 0 ? "Change slides" : "Choose slides"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="size-3.5" />
                  Replace
                </Button>
                <Button size="sm" variant="ghost" onClick={handleRemove} className="text-destructive hover:text-destructive">
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed hover:border-primary/60 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all"
            >
              <Upload className="size-5" />
              <span className="text-sm font-medium">Upload slides or a video</span>
              <span className="text-xs">PDF, PowerPoint, MP4, MOV or WebM</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
        </CardContent>
      </Card>

      {picking && (
        <SlidePicker
          fileUrl={picking.url}
          mimeType={picking.mimeType}
          fileName={picking.fileName}
          totalPages={picking.total}
          initialSelected={picking.selectedPages}
          onConfirm={handlePicked}
          onCancel={() => setPicking(null)}
        />
      )}
    </>
  )
}
