"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Loader2, AlertCircle, RotateCw } from "lucide-react"

import {
  openPdf, safeRenderScale, PdfOpenTimeoutError,
  type PdfDocument, type PdfPage,
} from "@/lib/pdfjs"

interface Props {
  fileUrl: string
  currentPage: number
  onTotalPages: (total: number) => void
  /**
   * Reports the element the slide is actually drawn into, so the classroom can
   * place the tutor's hand pointer against the slide rather than against the
   * panel around it — see `useSlideContentBox`. Called with null when there is
   * nothing drawn. Must be a stable reference.
   */
  onContentElement?: (el: HTMLElement | null) => void
}

function isPptxUrl(url: string) {
  try {
    const pathname = new URL(url).pathname
    return /\.pptx?$/i.test(pathname)
  } catch {
    return /\.pptx?/i.test(url)
  }
}

// ── PPTX viewer (@aiden0z/pptx-renderer) ─────────────────────────────────────
// Parses the PPTX in the browser and renders slides as DOM (HTML + SVG) with
// high fidelity: preset shapes, numbered/bulleted lists, gradients, tables,
// groups, charts (via ECharts), SmartArt (via a pdfjs fallback the lib bundles).
//
// Tunable parameters (all passed through to the library):
//   fitMode         : "contain" fits slide within host (keeps full slide visible);
//                     "none" draws at intrinsic size.
//   zoomPercent     : 10–400. Runtime zoom multiplier on top of fit.
//   initialWidthHint: px width hint the library uses before its own ResizeObserver
//                     kicks in. We feed it the host's current clientWidth.
//
// A ResizeObserver on the host forces a re-render when the panel is resized
// (e.g. the chat sidebar toggled, or the tutor switched pinning).

const PPTX_FIT_MODE: "contain" | "none" = "contain"
const PPTX_ZOOM_PERCENT              = 100  // 10-400
const PPTX_RESIZE_DEBOUNCE_MS        = 80

// Minimal structural type for the bits of the library we touch. The library's
// own type surface is large; we narrow here so the component is easy to reason
// about and avoids any `any` leaks.
type PptxViewerLike = {
  load: (presentation: unknown) => void
  renderSlide: (index: number) => Promise<void>
  destroy: () => void
  setZoom?: (pct: number) => Promise<void>
  setFitMode?: (mode: "contain" | "none") => Promise<void>
}

type PptxViewerOptions = {
  fitMode: "contain" | "none"
  zoomPercent: number
  width: number
  onSlideError?: (index: number, error: unknown) => void
  onNodeError?: (nodeId: string, error: unknown) => void
}

function PptxViewer({ fileUrl, currentPage, onTotalPages, onContentElement }: Props) {
  const hostRef    = useRef<HTMLDivElement>(null)
  const viewerRef  = useRef<PptxViewerLike | null>(null)
  const slideCount = useRef(0)
  const currentIdx = useRef(0)
  const nodeErrorCount = useRef(0)

  const [status,   setStatus]   = useState<"loading" | "ready" | "error">("loading")
  const [errorMsg, setErrorMsg] = useState("")
  // Becomes true when at least one node (typically an image) failed to render
  // on the current deck — usually an EMF/WMF picture the renderer can't
  // decode. Surfaces a small hint so the tutor isn't left wondering why a
  // slide looks empty.
  const [hasNodeErrors, setHasNodeErrors] = useState(false)

  // Load the deck once per fileUrl
  useEffect(() => {
    if (!fileUrl) return
    let cancelled = false

    async function load() {
      try {
        setStatus("loading")

        const [{ PptxViewer: PptxViewerClass, parseZip, buildPresentation }, res] = await Promise.all([
          import("@aiden0z/pptx-renderer"),
          fetch(fileUrl),
        ])
        if (!res.ok) throw new Error(`Failed to fetch PPTX (HTTP ${res.status})`)
        const arrayBuffer = await res.arrayBuffer()
        if (cancelled) return

        const files = await parseZip(arrayBuffer)
        const presentation = buildPresentation(files)
        if (cancelled) return

        // Clear any previous viewer state attached to the same host
        if (viewerRef.current) {
          viewerRef.current.destroy()
          viewerRef.current = null
        }

        const host = hostRef.current
        if (!host) return

        const initialWidthHint = Math.max(host.clientWidth, 320)

        nodeErrorCount.current = 0
        setHasNodeErrors(false)

        const viewerOptions: PptxViewerOptions = {
          fitMode:     PPTX_FIT_MODE,
          zoomPercent: PPTX_ZOOM_PERCENT,
          width:       initialWidthHint,
          onSlideError: (index, err) => {
            console.warn(`[PptxViewer] slide ${index + 1} render error:`, err)
          },
          onNodeError: (nodeId, err) => {
            nodeErrorCount.current += 1
            // Most common cause is EMF/WMF picture parts the renderer can't
            // decode (it advertises this limitation in its README).
            console.warn(`[PptxViewer] node "${nodeId}" failed to render:`, err)
            setHasNodeErrors(true)
          },
        }

        const viewer = new PptxViewerClass(host, viewerOptions) as unknown as PptxViewerLike
        viewer.load(presentation)
        viewerRef.current = viewer

        // Presentation shape is documented by the library as `{ slides: [...] }`.
        // Guard defensively in case the structural type ever changes.
        const total =
          (presentation as { slides?: unknown[] })?.slides?.length ?? 0
        slideCount.current = total
        onTotalPages(total)

        const safeIndex = Math.max(0, Math.min(currentPage - 1, Math.max(0, total - 1)))
        currentIdx.current = safeIndex
        await viewer.renderSlide(safeIndex)

        if (cancelled) return
        setStatus("ready")
      } catch (err) {
        if (cancelled) return
        console.error("[PptxViewer] failed to load PPTX", err)
        setErrorMsg("Could not load the presentation.")
        setStatus("error")
      }
    }

    load()
    return () => {
      cancelled = true
      if (viewerRef.current) {
        try { viewerRef.current.destroy() } catch { /* ignore */ }
        viewerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl])

  // Navigate whenever currentPage changes after initial render
  useEffect(() => {
    if (status !== "ready") return
    const viewer = viewerRef.current
    if (!viewer) return
    const total = slideCount.current
    const safeIndex = Math.max(0, Math.min(currentPage - 1, Math.max(0, total - 1)))
    currentIdx.current = safeIndex
    viewer.renderSlide(safeIndex).catch((err) => {
      console.error("[PptxViewer] renderSlide failed", err)
    })
  }, [currentPage, status])

  // Re-render on host resize so fitMode picks up the new panel dimensions.
  // Debounced so dragging the chat sidebar doesn't thrash.
  useEffect(() => {
    if (status !== "ready") return
    const host = hostRef.current
    if (!host) return

    let t: ReturnType<typeof setTimeout> | null = null
    const obs = new ResizeObserver(() => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        const viewer = viewerRef.current
        if (!viewer) return
        // Re-rendering the current slide is enough to make the library re-measure.
        viewer.renderSlide(currentIdx.current).catch(() => { /* ignore */ })
      }, PPTX_RESIZE_DEBOUNCE_MS)
    })
    obs.observe(host)
    return () => {
      if (t) clearTimeout(t)
      obs.disconnect()
    }
  }, [status])

  // The legacy path: decks are converted to PDF on upload, so this only runs
  // for a .pptx URL saved before that. The renderer builds its own DOM inside
  // the host and does not expose the slide node, so the best available answer
  // is the host itself — which means the pointer is panel-relative here, as it
  // was everywhere before. Accurate for the PDF path that everything now takes.
  useEffect(() => {
    if (status !== "ready") return
    onContentElement?.(hostRef.current)
    return () => onContentElement?.(null)
  }, [status, onContentElement])

  return (
    <div className="w-full h-full flex items-center justify-center bg-white overflow-hidden p-2 relative">
      {/* Host element the library paints into — always mounted so the ref is live during load */}
      <div ref={hostRef} className="relative w-full h-full overflow-hidden flex items-center justify-center" />

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-500 bg-white">
          <Loader2 className="size-8 animate-spin text-primary" />
          <span className="text-sm">Loading presentation…</span>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-500 bg-white px-8 text-center">
          <AlertCircle className="size-10 text-rose-500 opacity-70" />
          <p className="text-sm text-rose-400">{errorMsg}</p>
        </div>
      )}

      {status === "ready" && hasNodeErrors && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-amber-50 border border-amber-300 text-amber-900 text-[11px] px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5 max-w-[90%]">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="truncate">Some images couldn&apos;t be rendered (EMF/WMF graphics aren&apos;t supported). Export as PNG/JPG in PowerPoint and re-upload.</span>
        </div>
      )}
    </div>
  )
}

// ── PDF viewer (canvas via pdfjs-dist) ───────────────────────────────────────

function PdfViewer({ fileUrl, currentPage, onTotalPages, onContentElement }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const pdfRef        = useRef<PdfDocument>(null)
  const renderTask    = useRef<{ cancel: () => void } | null>(null)
  const renderVersion = useRef(0)

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [errorMsg, setErrorMsg] = useState("")
  // Bumping this re-runs the load effect. That is the whole of "Try again":
  // the student is usually one transient failure away from seeing the lesson,
  // and asking them to reload the classroom would drop them out of the call.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!fileUrl) return

    let cancelled = false
    setStatus("loading")
    setErrorMsg("")

    async function load() {
      try {
        const pdf: PdfDocument = await openPdf(fileUrl)

        if (cancelled) return
        pdfRef.current = pdf
        onTotalPages(pdf.numPages)
        setStatus("ready")
      } catch (err) {
        if (cancelled) return
        console.error("[PdfViewer] failed to load PDF", err)
        setErrorMsg(
          err instanceof PdfOpenTimeoutError
            ? "The slides are taking too long to load. This is usually the connection."
            : "Could not load the presentation.",
        )
        setStatus("error")
      }
    }

    load()
    return () => {
      cancelled = true
      // Hand the document back. Each one holds a worker and the decoded pages;
      // leaving them behind across a deck change or a retry is how a tab on a
      // memory-tight tablet ends up unable to open the *next* deck.
      renderTask.current?.cancel()
      renderTask.current = null
      const pdf = pdfRef.current
      pdfRef.current = null
      if (pdf) Promise.resolve(pdf.destroy()).catch(() => { /* already gone */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, attempt])

  const renderPage = useCallback(async (pageNum: number) => {
    const pdf    = pdfRef.current
    const canvas = canvasRef.current
    if (!pdf || !canvas || status !== "ready") return

    renderTask.current?.cancel()
    renderTask.current = null
    const version = ++renderVersion.current

    try {
      const page: PdfPage = await pdf.getPage(pageNum)
      if (version !== renderVersion.current) return

      const container = canvas.parentElement
      if (!container) return

      // Measure with the real box. A zero here means the stage hasn't been laid
      // out yet — Safari resolves percentage heights inside a flex item later
      // than Chrome does — and rendering to a guessed size would only have to
      // be thrown away. The ResizeObserver below calls us back once it is real.
      const { width: containerWidth, height: containerHeight } = container.getBoundingClientRect()
      if (containerWidth < 1 || containerHeight < 1) return

      const unscaled = page.getViewport({ scale: 1 })
      // Fit the whole page — `object-fit: contain` semantics — so nothing is cut off
      // whether the slide is wider or taller than the container.
      const fitScale = Math.min(
        containerWidth  / unscaled.width,
        containerHeight / unscaled.height,
      )
      // Render at a higher pixel density so the downscaled canvas stays crisp,
      // but never past what the browser will actually back with pixels: over
      // Safari's ceiling the canvas paints blank instead of throwing.
      const dpr         = (typeof window !== "undefined" && window.devicePixelRatio) || 1
      const renderScale = safeRenderScale(fitScale * dpr, unscaled.width, unscaled.height)
      if (renderScale <= 0) return
      const viewport    = page.getViewport({ scale: renderScale })

      canvas.width  = viewport.width
      canvas.height = viewport.height
      canvas.style.width  = `${unscaled.width  * fitScale}px`
      canvas.style.height = `${unscaled.height * fitScale}px`

      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Could not get a 2D canvas context")
      const task = page.render({ canvas, canvasContext: ctx, viewport })
      renderTask.current = task

      await task.promise
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "RenderingCancelledException") return
      console.error("[PdfViewer] render error", err)
      // A page that will not draw is indistinguishable from a blank slide to
      // the student, so say so rather than leaving them staring at white.
      if (version === renderVersion.current) {
        setErrorMsg("Could not draw this slide.")
        setStatus("error")
      }
    }
  }, [status])

  useEffect(() => {
    if (status === "ready") renderPage(currentPage)
  }, [currentPage, status, renderPage])

  useEffect(() => {
    if (status !== "ready") return
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => { renderPage(currentPage) })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [currentPage, status, renderPage])

  // The canvas is sized in `renderPage` to exactly the fitted slide — its own
  // box is the slide, with the letterbox falling outside it. So it is precisely
  // the rectangle the hand pointer should be measured against.
  useEffect(() => {
    if (status !== "ready") return
    onContentElement?.(canvasRef.current)
    return () => onContentElement?.(null)
  }, [status, onContentElement])

  if (status === "loading") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-zinc-500 bg-zinc-950">
        <Loader2 className="size-8 animate-spin text-primary" />
        <span className="text-sm">Loading presentation…</span>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-zinc-500 bg-zinc-950 px-8 text-center">
        <AlertCircle className="size-10 text-rose-500 opacity-70" />
        <p className="text-sm text-rose-400">{errorMsg}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-full px-3 py-1.5 transition-colors"
        >
          <RotateCw className="size-3.5" /> Try again
        </button>
        <p className="text-xs text-zinc-600">
          You are still in the lesson — this only reloads the slides.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950 overflow-hidden relative">
      <div className="relative w-full h-full flex items-center justify-center p-2 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block shadow-2xl rounded"
          style={{ background: "#fff", maxWidth: "100%", maxHeight: "100%" }}
        />
      </div>
    </div>
  )
}

// ── Exported component — delegates to PDF or PPTX viewer ─────────────────────

export function PptSlideViewer(props: Props) {
  if (isPptxUrl(props.fileUrl)) {
    return <PptxViewer {...props} />
  }
  return <PdfViewer {...props} />
}
