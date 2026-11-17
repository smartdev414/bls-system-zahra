"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Loader2, PanelRightClose, PanelRightOpen, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { openPdf, safeRenderScale } from "@/lib/pdfjs"

// Mirror PptSlideViewer's URL-based format detection so the tray doesn't need
// the mimeType threaded through classroom state.
function isPptxUrl(url: string) {
  try {
    const pathname = new URL(url).pathname
    return /\.pptx?$/i.test(pathname)
  } catch {
    return /\.pptx?/i.test(url)
  }
}

interface SlideTrayProps {
  fileUrl:          string
  totalPages:       number
  selectedSlides:   number[]   // ordered ascending, 1-based
  currentPage:      number
  onJump:           (page: number) => void
  onToggleSelected: (page: number) => void
  collapsed:        boolean
  onToggleCollapse: () => void
}

/**
 * Live thumbnail strip shown to the tutor during a presentation. Renders every
 * slide in the deck (not just the selected subset) as a miniature preview so
 * the tutor can:
 *   - Click a thumbnail to jump straight to that slide (broadcasts a navigate).
 *   - Toggle include/exclude per slide without interrupting the lesson.
 *
 * Rendering strategy mirrors SlidePicker: PDFs via pdfjs-dist canvas; PPTX via
 * @aiden0z/pptx-renderer's standalone renderSlide(), CSS-scaled into a fixed
 * stage. An IntersectionObserver draws each tile lazily so a long deck doesn't
 * eat the main thread on open.
 */
export function SlideTray({
  fileUrl,
  totalPages,
  selectedSlides,
  currentPage,
  onJump,
  onToggleSelected,
  collapsed,
  onToggleCollapse,
}: SlideTrayProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)
  const currentTileRef = useRef<HTMLDivElement>(null)

  const [renderedCount, setRenderedCount] = useState(0)
  const [loadError,     setLoadError]     = useState("")

  const selectedSet = useMemo(() => new Set(selectedSlides), [selectedSlides])
  const isPptx      = useMemo(() => isPptxUrl(fileUrl), [fileUrl])

  useEffect(() => {
    if (collapsed) return
    let cancelled = false
    const cleanups: Array<() => void> = []
    const rendered = new Set<number>()

    async function setup() {
      try {
        const list   = listRef.current
        const scroll = scrollRef.current
        if (!list || !scroll) return

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

            const ro = new ResizeObserver(applyScale)
            ro.observe(host)
            cleanups.push(() => ro.disconnect())
          }
        } else {
          const pdf = await openPdf(fileUrl)
          if (cancelled) return

          renderInto = async (slideIndex1, host) => {
            const page  = await pdf.getPage(slideIndex1)
            const rect  = host.getBoundingClientRect()
            const hostW = rect.width  || 160
            const hostH = rect.height || 90
            const vp1   = page.getViewport({ scale: 1 })
            const fit   = Math.min(hostW / vp1.width, hostH / vp1.height)
            const dpr   = (typeof window !== "undefined" && window.devicePixelRatio) || 1
            const vp    = page.getViewport({ scale: safeRenderScale(fit * dpr, vp1.width, vp1.height) })

            const canvas  = document.createElement("canvas")
            canvas.width  = vp.width
            canvas.height = vp.height
            canvas.style.cssText = `width:${vp1.width * fit}px;height:${vp1.height * fit}px;display:block;margin:auto;`
            const ctx = canvas.getContext("2d")!
            await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
            if (cancelled) return
            host.innerHTML = ""
            host.appendChild(canvas)
          }
        }

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
                .catch((err) => console.error("[SlideTray] render failed for slide", n, err))
              io.unobserve(tile)
            }
          },
          { root: scroll, rootMargin: "400px 0px" },
        )
        list.querySelectorAll<HTMLElement>("[data-slide-tile]").forEach((el) => io.observe(el))
        cleanups.push(() => io.disconnect())
      } catch (err) {
        if (cancelled) return
        console.error("[SlideTray] setup failed", err)
        setLoadError((err as Error).message || "Could not load slides")
      }
    }

    setup()
    return () => {
      cancelled = true
      cleanups.forEach((c) => { try { c() } catch { /* ignore */ } })
    }
  }, [fileUrl, isPptx, collapsed])

  // Keep the active slide visible as the tutor next/prev's through the deck.
  useEffect(() => {
    if (collapsed) return
    currentTileRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [currentPage, collapsed])

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="h-full w-9 flex flex-col items-center justify-center gap-2 bg-zinc-900 border-l border-zinc-800 hover:bg-zinc-800 transition-colors shrink-0"
        title="Show slide tray"
        aria-label="Show slide tray"
      >
        <PanelRightOpen className="size-4 text-zinc-400" />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[0.625rem] text-zinc-500 font-medium tracking-wide">
          Slides
        </span>
      </button>
    )
  }

  return (
    <div className="h-full w-36 shrink-0 flex flex-col bg-zinc-900 border-l border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between gap-1 px-2 h-9 border-b border-zinc-800 shrink-0">
        <span className="text-[0.6875rem] font-semibold text-zinc-300 tabular-nums">
          {selectedSlides.length}/{totalPages}
        </span>
        <button
          onClick={onToggleCollapse}
          className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-zinc-800"
          title="Hide slide tray"
          aria-label="Hide slide tray"
        >
          <PanelRightClose className="size-3.5" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-2 py-2"
      >
        <div ref={listRef} className="space-y-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => {
            const isIncluded = selectedSet.has(n)
            const isCurrent  = n === currentPage
            return (
              <div
                key={n}
                data-slide-tile={n}
                ref={isCurrent ? currentTileRef : undefined}
                className="relative group"
              >
                <button
                  type="button"
                  onClick={() => onJump(n)}
                  className={cn(
                    "block w-full aspect-[16/9] rounded overflow-hidden bg-white relative border-2 transition-all",
                    isCurrent
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-zinc-700 hover:border-zinc-500",
                    !isIncluded && !isCurrent && "opacity-45",
                  )}
                  title={
                    isCurrent
                      ? `Slide ${n} (showing now)`
                      : `Jump to slide ${n}`
                  }
                >
                  <div data-thumb className="w-full h-full relative overflow-hidden bg-white" />
                  {!isIncluded && (
                    <span className="absolute inset-x-0 bottom-0 text-[0.53125rem] font-semibold text-white bg-rose-600/85 py-[1px] text-center uppercase tracking-wider pointer-events-none">
                      Excluded
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onToggleSelected(n)}
                  className={cn(
                    "absolute top-1 right-1 size-5 rounded-full flex items-center justify-center transition-all shadow-md",
                    isIncluded
                      ? "bg-primary text-primary-foreground hover:scale-110"
                      : "bg-zinc-950/90 text-zinc-200 hover:bg-zinc-800 ring-1 ring-zinc-700",
                  )}
                  title={isIncluded ? "Remove from presentation" : "Add to presentation"}
                  aria-label={isIncluded ? `Remove slide ${n} from presentation` : `Add slide ${n} to presentation`}
                >
                  {isIncluded ? <Check className="size-3" /> : <Plus className="size-3" />}
                </button>

                <span className="absolute bottom-1 left-1 text-[0.5625rem] font-mono bg-black/65 text-white px-1 rounded pointer-events-none">
                  {n}
                </span>
              </div>
            )
          })}

          {renderedCount === 0 && !loadError && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="size-3.5 animate-spin text-primary" />
            </div>
          )}
          {loadError && (
            <div className="text-center text-[0.625rem] text-rose-400 py-3 px-1">
              {loadError}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
