"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Loader2, AlertCircle } from "lucide-react"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDocument = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfPage = any

interface Props {
  fileUrl: string
  currentPage: number
  onTotalPages: (total: number) => void
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

function PptxViewer({ fileUrl, currentPage, onTotalPages }: Props) {
  const hostRef    = useRef<HTMLDivElement>(null)
  const viewerRef  = useRef<PptxViewerLike | null>(null)
  const slideCount = useRef(0)
  const currentIdx = useRef(0)

  const [status,   setStatus]   = useState<"loading" | "ready" | "error">("loading")
  const [errorMsg, setErrorMsg] = useState("")

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

        const viewer = new PptxViewerClass(host, {
          fitMode:     PPTX_FIT_MODE,
          zoomPercent: PPTX_ZOOM_PERCENT,
          width:       initialWidthHint,
        }) as unknown as PptxViewerLike
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
    </div>
  )
}

// ── PDF viewer (canvas via pdfjs-dist) ───────────────────────────────────────

function PdfViewer({ fileUrl, currentPage, onTotalPages }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const pdfRef        = useRef<PdfDocument>(null)
  const renderTask    = useRef<{ cancel: () => void } | null>(null)
  const renderVersion = useRef(0)

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [errorMsg, setErrorMsg] = useState("")

  useEffect(() => {
    if (!fileUrl) return

    let cancelled = false
    setStatus("loading")

    async function load() {
      try {
        const pdfjsLib = await import("pdfjs-dist")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
          `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

        const pdf: PdfDocument = await pdfjsLib.getDocument({
          url: fileUrl,
          withCredentials: false,
        }).promise

        if (cancelled) return
        pdfRef.current = pdf
        onTotalPages(pdf.numPages)
        setStatus("ready")
      } catch (err) {
        if (cancelled) return
        console.error("[PdfViewer] failed to load PDF", err)
        setErrorMsg("Could not load the presentation. Make sure the file is a valid PDF.")
        setStatus("error")
      }
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl])

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

      const containerWidth  = container.clientWidth  || 800
      const containerHeight = container.clientHeight || 600

      const unscaled = page.getViewport({ scale: 1 })
      // Fit the whole page — `object-fit: contain` semantics — so nothing is cut off
      // whether the slide is wider or taller than the container.
      const fitScale = Math.min(
        containerWidth  / unscaled.width,
        containerHeight / unscaled.height,
      )
      // Render at a higher pixel density so the downscaled canvas stays crisp
      const dpr        = (typeof window !== "undefined" && window.devicePixelRatio) || 1
      const renderScale = fitScale * dpr
      const viewport   = page.getViewport({ scale: renderScale })

      canvas.width  = viewport.width
      canvas.height = viewport.height
      canvas.style.width  = `${unscaled.width  * fitScale}px`
      canvas.style.height = `${unscaled.height * fitScale}px`

      const ctx = canvas.getContext("2d")!
      const task = page.render({ canvasContext: ctx, viewport })
      renderTask.current = task

      await task.promise
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== "RenderingCancelledException") {
        console.error("[PdfViewer] render error", err)
      }
    }
  }, [status])

  useEffect(() => {
    if (status === "ready") renderPage(currentPage)
  }, [currentPage, status, renderPage])

  useEffect(() => {
    if (!canvasRef.current) return
    const observer = new ResizeObserver(() => {
      if (status === "ready") renderPage(currentPage)
    })
    const parent = canvasRef.current.parentElement
    if (parent) observer.observe(parent)
    return () => observer.disconnect()
  }, [currentPage, status, renderPage])

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

export function PptSlideViewer({ fileUrl, currentPage, onTotalPages }: Props) {
  if (isPptxUrl(fileUrl)) {
    return <PptxViewer fileUrl={fileUrl} currentPage={currentPage} onTotalPages={onTotalPages} />
  }
  return <PdfViewer fileUrl={fileUrl} currentPage={currentPage} onTotalPages={onTotalPages} />
}
