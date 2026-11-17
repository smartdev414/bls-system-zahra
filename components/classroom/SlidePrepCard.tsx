"use client"

// Pre-class slide prep, shown on the session page so a teacher can have the
// lesson loaded and the slides chosen before anyone joins. Whatever is prepared
// here is the same resource the classroom presents, so going live is one click
// with no upload, no conversion wait, and no slide-picking in front of a class.
//
// Two things here exist purely because preparing a *second* lesson used to start
// from nothing:
//
//   - The file dialog opens in the folder used last time, sharing its memory
//     with the classroom's panel, instead of dropping the teacher back at
//     Documents to walk down to their decks again.
//   - Decks already presented are listed underneath, so the usual case — showing
//     something taught before — needs no file dialog and no re-upload at all.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Presentation, Upload, Loader2, FileText, Film, Trash2, ListChecks, CheckCircle2,
  Clock, ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { SlidePicker } from "./SlidePicker"
import {
  countPdfPages,
  fetchPreparedPresentation,
  registerPresentation,
  uploadPresentation,
  type PreparedPresentation,
} from "@/lib/slide-upload"
import { byLastUsed, markPresentationUsed, readPresentationUsage } from "@/lib/recent-presentations"
import { pickPresentationFile } from "@/lib/pick-file"
import type { UploadedSlides } from "./room/types"

const ACCEPT =
  ".pdf,.ppt,.pptx,.mp4,.mov,.webm," +
  "application/pdf,application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "video/mp4,video/quicktime,video/webm"

/** Rows shown before the list is collapsed behind "Show all". */
const COLLAPSED_ROWS = 4

type SlidesUpload = Extract<UploadedSlides, { kind: "slides" }>

type RecentPresentation = {
  id: string
  fileName: string
  url: string
  mimeType: string
  totalPages: number | null
  selectedPages: number[] | null
  sessionId: string
  sessionTitle: string | null
  createdAt: string
}

export function SlidePrepCard({ sessionId }: { sessionId: string }) {
  const [prepared, setPrepared] = useState<PreparedPresentation | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState(false)
  const [progress, setProgress] = useState("")
  // Non-null while the tutor is choosing which slides to include.
  const [picking,  setPicking]  = useState<SlidesUpload | null>(null)
  const [recents,  setRecents]  = useState<RecentPresentation[]>([])
  const [showAll,  setShowAll]  = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const resource = await fetchPreparedPresentation(sessionId)
    setPrepared(resource)
    setLoading(false)
  }, [sessionId])

  useEffect(() => { void reload() }, [reload])

  // The teacher's own back catalogue. Best effort: the card is fully usable
  // from the upload button alone if this never arrives.
  useEffect(() => {
    let cancelled = false
    fetch("/api/tutor/presentations/recent")
      .then((r) => (r.ok ? r.json() : { presentations: [] }))
      .then((d: { presentations: RecentPresentation[] }) => {
        if (!cancelled) setRecents(d.presentations ?? [])
      })
      .catch(() => { /* the upload button still works */ })
    return () => { cancelled = true }
  }, [])

  const isVideo = !!prepared?.mimeType?.startsWith("video/")
  const total    = prepared?.totalPages ?? 0
  const selected = prepared?.selectedPages?.length ?? 0

  // Ordered by what this teacher actually reaches for, with whatever is already
  // prepared for this lesson dropped — it is shown above, in full.
  const library = useMemo(() => {
    const items = recents.filter((r) => r.url !== prepared?.fileUrl)
    return byLastUsed(items, readPresentationUsage())
  }, [recents, prepared?.fileUrl])

  const visible = showAll ? library : library.slice(0, COLLAPSED_ROWS)

  async function handleFile(file: File) {
    setBusy(true)
    try {
      const result = await uploadPresentation(sessionId, file, setProgress)
      markPresentationUsed(result.url)
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

  /**
   * Try the picker that remembers the folder first, then fall back to the plain
   * input. Called straight from the click so the user gesture it needs is still
   * live — nothing may be awaited before it.
   */
  async function chooseFile() {
    const result = await pickPresentationFile()
    if (result.status === "picked") { void handleFile(result.file); return }
    if (result.status === "cancelled") return
    fileInputRef.current?.click()
  }

  /**
   * Prepare a deck the teacher has presented before. The file already sits at a
   * stable storage URL, so this re-registers it against this lesson and uploads
   * nothing.
   */
  async function prepareRecent(item: RecentPresentation) {
    setBusy(true)
    setProgress("Getting the deck ready…")
    try {
      if (item.mimeType.startsWith("video/")) {
        await registerPresentation(sessionId, {
          fileUrl: item.url, fileName: item.fileName, mimeType: item.mimeType,
        })
        markPresentationUsed(item.url)
        toast.success("Video ready for the lesson")
        await reload()
        return
      }

      const pages = item.totalPages ?? (await countPdfPages(item.url))
      await registerPresentation(sessionId, {
        fileUrl:  item.url,
        fileName: item.fileName,
        mimeType: item.mimeType,
        totalPages: pages,
        // Carry last time's page choice over, so re-using a deck taught before
        // is genuinely one click. The picker opens on it and can be adjusted.
        ...(item.selectedPages?.length ? { selectedPages: item.selectedPages } : {}),
      })
      markPresentationUsed(item.url)
      await reload()
      setPicking({
        kind: "slides",
        url: item.url,
        total: pages,
        mimeType: item.mimeType,
        fileName: item.fileName,
        selectedPages: item.selectedPages ?? undefined,
      })
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Could not prepare that deck")
    } finally {
      setBusy(false)
      setProgress("")
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
          ) : (
            <>
              {prepared ? (
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
                    <Button size="sm" variant="outline" onClick={() => void chooseFile()}>
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
                  onClick={() => void chooseFile()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed hover:border-primary/60 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all"
                >
                  <Upload className="size-5" />
                  <span className="text-sm font-medium">Upload slides or a video</span>
                  <span className="text-xs">PDF, PowerPoint, MP4, MOV or WebM</span>
                </button>
              )}

              {library.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {prepared ? "Or use one you've presented before" : "Presented before"}
                  </p>

                  {visible.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void prepareRecent(item)}
                      className="w-full flex items-center gap-2.5 rounded-xl border bg-background hover:bg-muted/60 px-3 py-2 text-left transition-colors"
                    >
                      {item.mimeType.startsWith("video/")
                        ? <Film className="size-4 text-primary shrink-0" />
                        : <FileText className="size-4 text-primary shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm truncate">{item.fileName}</span>
                        {item.sessionTitle && item.sessionId !== sessionId && (
                          <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground truncate">
                            <Clock className="size-2.5 shrink-0" />
                            {item.sessionTitle}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}

                  {library.length > COLLAPSED_ROWS && (
                    <button
                      type="button"
                      onClick={() => setShowAll((v) => !v)}
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors pt-0.5"
                    >
                      <ChevronDown className={`size-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
                      {showAll
                        ? "Show fewer"
                        : `Show all ${library.length}`}
                    </button>
                  )}
                </div>
              )}
            </>
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
