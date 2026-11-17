"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, X, Check, CheckSquare, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { openPdf, safeRenderScale } from "@/lib/pdfjs"

interface SlidePickerProps {
  fileUrl:    string
  mimeType:   string
  fileName:   string
  totalPages: number
  /**
   * Pages to tick on open. Defaults to all of them — the right answer for a
   * deck nobody has looked at yet, and the wrong one for a deck being shown for
   * the fifth time with the same six pages skipped every lesson.
   */
  initialSelected?: number[]
  onConfirm:  (selectedPages: number[]) => void   // 1-based slide numbers, ascending
  onCancel:   () => void
}

/**
 * Modal shown after the upload finishes. Renders a **full-size preview** of
 * every slide in a vertical scrolling list; each has a checkbox (default on)
 * so the tutor can exclude slides from the presentation.
 *
 * Renderers:
 *   - PDF   → pdfjs-dist, canvas at a scale matched to the container width.
 *   - PPTX  → @aiden0z/pptx-renderer's standalone `renderSlide()` (the viewer-
 *             based `renderSlideToContainer` silently produces empty containers
 *             in the installed build). The returned element is absolutely
 *             positioned inside a fixed-size stage and CSS-scaled to fit.
 *
 * A shared IntersectionObserver renders slides lazily as they scroll into view
 * (with 500px rootMargin) so a 60-slide deck doesn't try to draw everything up
 * front and freeze the modal.
 */
export function SlidePicker({
  fileUrl,
  mimeType,
  fileName,
  totalPages,
  initialSelected,
  onConfirm,
  onCancel,
}: SlidePickerProps) {
  const [selected, setSelected] = useState<Set<number>>(() => {
    // An empty remembered selection is treated as "not remembered": it would
    // otherwise open with nothing ticked and the confirm button dead, which
    // reads as a broken deck rather than as a previous choice.
    const remembered = initialSelected?.filter((n) => n >= 1 && n <= totalPages) ?? []
    if (remembered.length > 0) return new Set(remembered)
    const s = new Set<number>()
    for (let i = 1; i <= totalPages; i++) s.add(i)
    return s
  })
  const [renderedCount, setRenderedCount] = useState(0)
  const [loadError,     setLoadError]     = useState("")

  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)

  const isPptx = mimeType !== "application/pdf"

  useEffect(() => {
    let cancelled = false
    const cleanups: Array<() => void> = []
    const rendered = new Set<number>()   // 1-based slide numbers that have a preview

    async function setup() {
      try {
        const list = listRef.current
        const scroll = scrollRef.current
        if (!list || !scroll) return

        // ── Prepare the renderer for the file format ─────────────────────────
        let renderInto: (slideIndex1: number, host: HTMLElement) => Promise<void>

        if (isPptx) {
          const { parseZip, buildPresentation, renderSlide } =
            await import("@aiden0z/pptx-renderer")

          const res = await fetch(fileUrl)
          if (!res.ok) throw new Error(`Failed to fetch PPTX (HTTP ${res.status})`)
          const buf = await res.arrayBuffer()
          if (cancelled) return

          const files = await parseZip(buf)
          const presentation = buildPresentation(files)
          if (cancelled) return

          const mediaUrlCache = new Map<string, string>()

          renderInto = async (slideIndex1, host) => {
            const slide = presentation.slides[slideIndex1 - 1]
            if (!slide) return
            const handle = renderSlide(presentation, slide, { mediaUrlCache })
            cleanups.push(() => { try { handle.dispose() } catch { /* ignore */ } })

            handle.element.style.position = "absolute"
            handle.element.style.left     = "0"
            handle.element.style.top      = "0"
            handle.element.style.width    = `${presentation.width}px`
            handle.element.style.height   = `${presentation.height}px`

            const stage = document.createElement("div")
            stage.style.cssText = [
              "position:absolute",
              "left:0",
              "top:0",
              `width:${presentation.width}px`,
              `height:${presentation.height}px`,
              "transform-origin:top left",
              "pointer-events:none",
            ].join(";")
            stage.appendChild(handle.element)
            host.innerHTML = ""
            host.appendChild(stage)

            // Scale the stage to fill the host width; height follows aspect.
            const applyScale = () => {
              const rect = host.getBoundingClientRect()
              if (rect.width <= 0 || rect.height <= 0) return
              const s = Math.min(
                rect.width  / presentation.width,
                rect.height / presentation.height,
              )
              stage.style.transform = `scale(${s})`
            }
            applyScale()

            // Keep in sync if the modal resizes.
            const ro = new ResizeObserver(applyScale)
            ro.observe(host)
            cleanups.push(() => ro.disconnect())
          }
        } else {
          const pdf = await openPdf(fileUrl)
          if (cancelled) return

          renderInto = async (slideIndex1, host) => {
            const page    = await pdf.getPage(slideIndex1)
            const rect    = host.getBoundingClientRect()
            const hostW   = rect.width  || 800
            const hostH   = rect.height || 450
            const vp1     = page.getViewport({ scale: 1 })
            const fit     = Math.min(hostW / vp1.width, hostH / vp1.height)
            const dpr     = (typeof window !== "undefined" && window.devicePixelRatio) || 1
            const vp      = page.getViewport({ scale: safeRenderScale(fit * dpr, vp1.width, vp1.height) })

            const canvas  = document.createElement("canvas")
            canvas.width  = vp.width
            canvas.height = vp.height
            canvas.style.cssText = `width:${vp1.width * fit}px;height:${vp1.height * fit}px;display:block;margin:auto;`
            const ctx     = canvas.getContext("2d")!
            await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
            if (cancelled) return
            host.innerHTML = ""
            host.appendChild(canvas)
          }
        }

        // ── Lazy render as tiles scroll into view ────────────────────────────
        const io = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue
              const tile = entry.target as HTMLElement
              const n    = Number(tile.getAttribute("data-slide-tile"))
              if (!n || rendered.has(n)) continue
              rendered.add(n)
              const host = tile.querySelector<HTMLElement>("[data-thumb]")
              if (!host) continue
              renderInto(n, host)
                .then(() => { if (!cancelled) setRenderedCount((c) => c + 1) })
                .catch((err) => console.error("[SlidePicker] render failed for slide", n, err))
              io.unobserve(tile)
            }
          },
          { root: scroll, rootMargin: "500px 0px" },
        )

        list.querySelectorAll<HTMLElement>("[data-slide-tile]").forEach((el) => io.observe(el))
        cleanups.push(() => io.disconnect())
      } catch (err) {
        if (cancelled) return
        console.error("[SlidePicker] setup failed", err)
        setLoadError((err as Error).message || "Could not load slides")
      }
    }

    setup()
    return () => {
      cancelled = true
      cleanups.forEach((c) => { try { c() } catch { /* ignore */ } })
    }
  }, [fileUrl, mimeType, totalPages, isPptx])

  // ── Selection helpers ──────────────────────────────────────────────────────

  const allSelected  = selected.size === totalPages
  const noneSelected = selected.size === 0

  const toggle = (n: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  const selectAll = () => {
    const s = new Set<number>()
    for (let i = 1; i <= totalPages; i++) s.add(i)
    setSelected(s)
  }

  const deselectAll = () => setSelected(new Set())

  const handleConfirm = () => {
    if (selected.size === 0) return
    onConfirm(Array.from(selected).sort((a, b) => a - b))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-white">Choose slides to present</h3>
            <p className="text-[0.6875rem] text-zinc-400 mt-0.5 truncate" title={fileName}>
              {fileName} · {totalPages} slide{totalPages !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-zinc-500 hover:text-white transition-colors shrink-0 ml-2"
            title="Cancel"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800 bg-zinc-900/60 shrink-0">
          <button
            onClick={allSelected ? deselectAll : selectAll}
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            {allSelected
              ? <CheckSquare className="size-3.5 text-primary" />
              : <Square className="size-3.5" />}
            {allSelected ? "Deselect all" : "Select all"}
          </button>

          <p className="text-[0.6875rem] text-zinc-500 ml-2 hidden sm:block">
            Click a slide to include/exclude. Scroll through to review.
          </p>

          <span className="text-xs text-zinc-300 ml-auto font-medium tabular-nums">
            {selected.size} of {totalPages} selected
          </span>
        </div>

        {/* Vertical slide list */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5 bg-zinc-950/40"
        >
          <div ref={listRef} className="space-y-5">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => {
              const isSelected = selected.has(n)
              return (
                <div
                  key={n}
                  data-slide-tile={n}
                  className={cn(
                    "relative group flex items-stretch gap-3 transition-opacity",
                    !isSelected && "opacity-40",
                  )}
                >
                  {/* Left rail: checkbox + number */}
                  <button
                    type="button"
                    onClick={() => toggle(n)}
                    className="shrink-0 flex flex-col items-center gap-2 w-10 pt-2"
                    aria-pressed={isSelected}
                    title={isSelected ? `Slide ${n} — click to exclude` : `Slide ${n} — click to include`}
                  >
                    <span
                      className={cn(
                        "size-7 rounded-full flex items-center justify-center transition-all ring-2",
                        isSelected
                          ? "bg-primary text-primary-foreground ring-primary/40"
                          : "bg-zinc-800 text-zinc-500 ring-zinc-700 group-hover:ring-zinc-500",
                      )}
                    >
                      {isSelected ? <Check className="size-4" /> : <span className="text-sm font-bold">+</span>}
                    </span>
                    <span className="text-[0.625rem] font-mono text-zinc-500">{n}</span>
                  </button>

                  {/* Slide preview — click to toggle too */}
                  <button
                    type="button"
                    onClick={() => toggle(n)}
                    className={cn(
                      "flex-1 relative rounded-lg overflow-hidden border-2 aspect-[16/9] bg-white text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isSelected
                        ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
                        : "border-zinc-700 hover:border-zinc-500",
                    )}
                    aria-label={isSelected ? `Slide ${n} — click to exclude` : `Slide ${n} — click to include`}
                  >
                    <div data-thumb className="w-full h-full relative overflow-hidden bg-white" />
                    {!isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/40 pointer-events-none">
                        <span className="text-xs font-semibold text-white bg-rose-600/90 px-3 py-1 rounded-full">
                          Excluded
                        </span>
                      </div>
                    )}
                  </button>
                </div>
              )
            })}

            {renderedCount === 0 && !loadError && (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-zinc-500">
                <Loader2 className="size-4 animate-spin text-primary" />
                Loading previews…
              </div>
            )}

            {loadError && (
              <div className="text-center text-xs text-rose-400 py-4">
                {loadError}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-zinc-800 shrink-0">
          <span className="text-[0.6875rem] text-zinc-500 tabular-nums">
            {renderedCount < totalPages && !loadError
              ? `Loaded ${renderedCount} / ${totalPages} preview${totalPages !== 1 ? "s" : ""}`
              : "\u00A0"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={noneSelected}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <Check className="size-3.5" />
              Start presentation ({selected.size} slide{selected.size !== 1 ? "s" : ""})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
