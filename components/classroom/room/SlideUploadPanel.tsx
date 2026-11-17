"use client"

/**
 * The slide library, opened mid-lesson.
 *
 * It used to be an upload box with the current session's own materials listed
 * underneath. That made every deck a one-session object: to show something
 * taught last week a teacher had to go back out to their computer, find the
 * folder again, and upload the same file a second time — in front of a class.
 * Reported as "the library goes back to the beginning every time".
 *
 * Three things fix it, and all three matter:
 *
 *   - **Everything the teacher has ever presented is here**, not just this
 *     session's uploads. The files sit at stable storage URLs, so presenting one
 *     again costs nothing and re-uploads nothing.
 *   - **Ordered by what they actually use**, not by when it was uploaded. A deck
 *     taught every week belongs at the top even if it was uploaded in March.
 *   - **The list keeps its place**, and the file dialog keeps its folder, so
 *     going back for a second deck resumes where they were rather than
 *     restarting the search.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import {
  Presentation, Upload, X, Loader2, FileText, Film, Search, Clock, Link2,
} from "lucide-react"
import type { UploadedSlides } from "./types"
import { countPdfPages, registerPresentation, uploadPresentation } from "@/lib/slide-upload"
import { byLastUsed, markPresentationUsed, readPresentationUsage } from "@/lib/recent-presentations"
import { pickPresentationFile } from "@/lib/pick-file"
import { cn } from "@/lib/utils"
import { parseVideoLink, videoLinkUrl, VIDEO_LINK_LABEL, VIDEO_LINK_MIME } from "@/lib/video-link"

type SessionMaterial = {
  id: string
  fileName: string
  fileUrl: string | null
  mimeType: string | null
  presentationUrl: string | null
  presentationMimeType: string | null
  totalPages: number | null
  selectedPages: number[] | null
}

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

/** A row in the library, from either source, in one shape. */
type LibraryItem = {
  key: string
  fileName: string
  url: string
  mimeType: string
  totalPages: number | null
  /** The page choice made last time, when this deck has been prepared before. */
  selectedPages: number[] | null
  /** Null for this session's own materials, which need no "from" line. */
  fromSessionTitle: string | null
  /** True when the deck is not attached to this session and should be. */
  needsRegistering: boolean
}

/**
 * Scroll offset, kept outside React so it survives the panel unmounting — which
 * is what happens every single time the teacher presents something. This is the
 * literal "returns to the beginning" complaint.
 */
let rememberedScrollTop = 0
let rememberedQuery = ""

/** Above this many items the list is worth searching rather than scrolling. */
const SEARCH_THRESHOLD = 6

export function SlideUploadPanel({
  sessionId,
  onSlidesReady,
  onClose,
  previousSlides,
}: {
  sessionId: string
  onSlidesReady: (data: UploadedSlides) => void
  onClose: () => void
  previousSlides: UploadedSlides | null
}) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress]   = useState("")
  const [error, setError]         = useState("")
  // Non-blocking: the upload still goes ahead. WebM plays in Chrome and Firefox
  // and not in Safari, so a teacher who uploads one has silently excluded every
  // student on an iPad or a Mac — and the first they hear of it is a student
  // saying they can see nothing.
  const [warning, setWarning]     = useState("")
  const [materials, setMaterials] = useState<SessionMaterial[]>([])
  const [recents, setRecents]     = useState<RecentPresentation[]>([])
  const [query, setQuery]         = useState(rememberedQuery)
  const [link, setLink]           = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRef      = useRef<HTMLDivElement>(null)

  useEffect(() => { rememberedQuery = query }, [query])

  // ── Load both sources ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    fetch(`/api/tutor/sessions/${sessionId}/resources`)
      .then((r) => (r.ok ? r.json() : { resources: [] }))
      .then((d: { resources: SessionMaterial[] }) => {
        if (cancelled) return
        // PDFs prepared for the stage, and videos attached as session materials.
        // Mid-class uploads also land in "recents" via `__presentation__` rows.
        setMaterials(
          (d.resources ?? []).filter((r) => {
            if (r.presentationUrl && (r.presentationMimeType === "application/pdf" || !r.presentationMimeType)) {
              return true
            }
            return !!(r.fileUrl && r.mimeType?.startsWith("video/"))
          }),
        )
      })
      .catch(() => { /* the library still works from recents alone */ })

    fetch("/api/tutor/presentations/recent")
      .then((r) => (r.ok ? r.json() : { presentations: [] }))
      .then((d: { presentations: RecentPresentation[] }) => {
        if (cancelled) return
        setRecents(d.presentations ?? [])
      })
      .catch(() => { /* fall back to this session's own materials */ })

    return () => { cancelled = true }
  }, [sessionId])

  // ── One list, ordered by use ────────────────────────────────────────────────

  const items = useMemo<LibraryItem[]>(() => {
    const own: LibraryItem[] = materials.map((m) => {
      const isVideo = !!m.mimeType?.startsWith("video/") && !m.presentationUrl
      const url = isVideo ? m.fileUrl! : m.presentationUrl!
      const mimeType = isVideo
        ? m.mimeType!
        : (m.presentationMimeType ?? "application/pdf")
      return {
        key: `material:${m.id}`,
        fileName: isVideo ? m.fileName : m.fileName.replace(/\.pptx?$/i, ".pdf"),
        url,
        mimeType,
        totalPages: isVideo ? null : (m.totalPages ?? null),
        selectedPages: Array.isArray(m.selectedPages) ? m.selectedPages : null,
        fromSessionTitle: null,
        needsRegistering: false,
      }
    })

    const sessionUrls = new Set(own.map((m) => m.url).filter(Boolean))

    const elsewhere: LibraryItem[] = recents
      // A deck already attached here is listed once, as this session's own.
      .filter((r) => !sessionUrls.has(r.url))
      .map((r) => ({
        key: `recent:${r.id}`,
        fileName: r.fileName,
        url: r.url,
        mimeType: r.mimeType,
        totalPages: r.totalPages,
        selectedPages: r.selectedPages,
        fromSessionTitle: r.sessionId === sessionId ? null : r.sessionTitle,
        needsRegistering: r.sessionId !== sessionId,
      }))

    // This session's own materials first — a teacher who prepared for *this*
    // lesson meant it — then everything else by how recently it was used.
    return [...own, ...byLastUsed(elsewhere, readPresentationUsage())]
  }, [materials, recents, sessionId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.fileName.toLowerCase().includes(q) ||
        (i.fromSessionTitle?.toLowerCase().includes(q) ?? false),
    )
  }, [items, query])

  // ── Restore and remember the scroll position ────────────────────────────────

  useEffect(() => {
    const el = listRef.current
    if (!el || rememberedScrollTop === 0) return
    // After the first paint that has rows in it, so there is something to
    // scroll. Two frames is enough for the list to have laid out.
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = rememberedScrollTop
      })
    })
    return () => cancelAnimationFrame(id)
  }, [filtered.length])

  const rememberScroll = useCallback(() => {
    if (listRef.current) rememberedScrollTop = listRef.current.scrollTop
  }, [])

  // ── Presenting ──────────────────────────────────────────────────────────────

  const present = async (item: LibraryItem) => {
    setError("")
    setUploading(true)
    setProgress("Opening…")
    try {
      if (item.mimeType.startsWith("video/")) {
        markPresentationUsed(item.url)
        onSlidesReady({
          kind: "video", url: item.url, mimeType: item.mimeType, fileName: item.fileName,
        })
        return
      }

      const total = item.totalPages ?? (await countPdfPages(item.url))

      // Bringing a deck across from another lesson: attach it here too, so
      // students on this session can download it and so it appears in this
      // session's materials afterwards. Best-effort — failing to file the
      // paperwork must never stop the class seeing the slides.
      if (item.needsRegistering) {
        try {
          await registerPresentation(sessionId, {
            fileUrl: item.url,
            fileName: item.fileName,
            mimeType: item.mimeType,
            totalPages: total,
          })
        } catch (err) {
          console.warn("[slides] could not attach the deck to this session", err)
        }
      }

      markPresentationUsed(item.url)
      onSlidesReady({
        kind: "slides",
        url: item.url,
        total,
        mimeType: item.mimeType,
        fileName: item.fileName,
        selectedPages: item.selectedPages ?? undefined,
      })
    } catch (err: unknown) {
      setError((err as Error).message ?? "Could not load slides")
    } finally {
      setUploading(false)
      setProgress("")
    }
  }

  const handleFile = async (file: File) => {
    setError("")
    setWarning(
      /\.webm$/i.test(file.name) || file.type === "video/webm"
        ? "Heads up: WebM won't play for students on Safari, iPhone or iPad. MP4 plays everywhere."
        : "",
    )
    setUploading(true)
    try {
      const result = await uploadPresentation(sessionId, file, setProgress)
      markPresentationUsed(result.url)
      onSlidesReady(result)
    } catch (err: unknown) {
      setError((err as Error).message ?? "Upload failed")
    } finally {
      setUploading(false)
      setProgress("")
    }
  }

  /**
   * Try the picker that remembers the folder first; fall back to the plain
   * input on browsers without it. Called straight from the click so the user
   * gesture the API needs is still live.
   */
  const chooseFile = async () => {
    const result = await pickPresentationFile()
    if (result.status === "picked") { void handleFile(result.file); return }
    if (result.status === "cancelled") return
    fileInputRef.current?.click()
  }

  /** A YouTube or Vimeo video, played to the class in that site's player. Nothing is uploaded. */
  const presentLink = () => {
    const parsed = parseVideoLink(link)
    if (!parsed) {
      setError("That isn't a YouTube or Vimeo video link. Copy the address of the video's own page.")
      return
    }
    setError("")
    setLink("")
    onSlidesReady({
      kind: "video",
      url: videoLinkUrl(parsed),
      mimeType: VIDEO_LINK_MIME[parsed.provider],
      fileName: VIDEO_LINK_LABEL[parsed.provider],
    })
  }

  const showSearch = items.length > SEARCH_THRESHOLD

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-full max-w-md shadow-2xl mx-4 flex flex-col max-h-[85%]">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Presentation className="size-4 text-primary" />
            <h3 className="font-bold text-sm text-white">Slides &amp; video</h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {error && (
          <p className="text-xs text-rose-400 bg-rose-900/20 border border-rose-800/40 rounded-lg px-3 py-2 mb-3 shrink-0">
            {error}
          </p>
        )}

        {warning && (
          <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2 mb-3 shrink-0">
            {warning}
          </p>
        )}

        {uploading ? (
          <div className="flex items-center gap-3 py-8 justify-center text-zinc-400">
            <Loader2 className="size-5 animate-spin text-primary" />
            <span className="text-sm">{progress}</span>
          </div>
        ) : (
          <>
            {showSearch && (
              <div className="relative mb-2 shrink-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your slides…"
                  className="w-full rounded-xl bg-zinc-800 border border-zinc-700 pl-8 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-primary/60"
                />
              </div>
            )}

            <div
              ref={listRef}
              onScroll={rememberScroll}
              className="flex flex-col gap-1.5 overflow-y-auto overscroll-contain min-h-0 -mx-1 px-1"
            >
              {filtered.length === 0 && (
                <p className="text-xs text-zinc-500 py-6 text-center">
                  {items.length === 0
                    ? "Nothing here yet. Choose a file below and it will be waiting for you next lesson."
                    : "Nothing matches that."}
                </p>
              )}

              {filtered.map((item) => {
                const isVideo = item.mimeType.startsWith("video/")
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => { rememberScroll(); void present(item) }}
                    className={cn(
                      "w-full flex items-center gap-2.5 py-2 px-3 rounded-xl text-left transition-colors",
                      "bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-sm text-zinc-200",
                    )}
                  >
                    {isVideo
                      ? <Film className="size-4 text-primary shrink-0" />
                      : <FileText className="size-4 text-primary shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.fileName}</span>
                      {item.fromSessionTitle && (
                        <span className="flex items-center gap-1 text-[0.625rem] text-zinc-500 truncate">
                          <Clock className="size-2.5 shrink-0" />
                          {item.fromSessionTitle}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="shrink-0 pt-3 mt-1 border-t border-zinc-800 flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.ppt,.pptx,.mp4,.mov,.webm,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                  // Let the same file be chosen again after a failed attempt.
                  e.target.value = ""
                }}
              />
              <form
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); presentLink() }}
              >
                <div className="relative flex-1 min-w-0">
                  <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500" />
                  <input
                    // Not type="url": people paste "youtube.com/…" without the https://.
                    type="text"
                    inputMode="url"
                    value={link}
                    onChange={(e) => { setLink(e.target.value); setError("") }}
                    placeholder="Paste a YouTube or Vimeo link"
                    aria-label="YouTube or Vimeo link"
                    className="w-full rounded-xl bg-zinc-800 border border-zinc-700 pl-8 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-primary/60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!link.trim()}
                  className="shrink-0 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  Play
                </button>
              </form>

              <button
                onClick={chooseFile}
                className="w-full flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl border-2 border-dashed border-zinc-700 hover:border-primary/60 hover:bg-primary/5 text-zinc-400 hover:text-primary transition-all text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <Upload className="size-4" />
                  Choose a file from your computer
                </span>
                <span className="text-[0.6875rem] font-normal text-zinc-500">
                  PDF, PowerPoint, MP4, MOV or WebM
                </span>
              </button>

              {previousSlides && (
                <button
                  onClick={() => onSlidesReady(previousSlides)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-all text-sm font-medium"
                >
                  <Presentation className="size-4" />
                  Resume previous {previousSlides.kind === "video" ? "video" : "slides"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
