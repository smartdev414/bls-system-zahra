"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Loader2, AlertCircle, FileText } from "lucide-react"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDocument = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfPage = any

interface Props {
  fileUrl: string
  currentPage: number
  onTotalPages: (total: number) => void
}

export function PptSlideViewer({ fileUrl, currentPage, onTotalPages }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const pdfRef        = useRef<PdfDocument>(null)
  const renderTask    = useRef<{ cancel: () => void } | null>(null)
  const renderVersion = useRef(0)

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [errorMsg, setErrorMsg] = useState("")

  // ── Load PDF document ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!fileUrl) return

    let cancelled = false
    setStatus("loading")

    async function load() {
      try {
        // Dynamic import avoids SSR issues; CDN worker avoids webpack complexity
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
        console.error("[PptSlideViewer] failed to load PDF", err)
        setErrorMsg("Could not load the presentation. Make sure the file is a valid PDF.")
        setStatus("error")
      }
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl])

  // ── Render specific page ────────────────────────────────────────────────────
  const renderPage = useCallback(async (pageNum: number) => {
    const pdf    = pdfRef.current
    const canvas = canvasRef.current
    if (!pdf || !canvas || status !== "ready") return

    // Cancel any in-flight render and claim a new version slot.
    // The version check after getPage() ensures only the latest call
    // ever reaches page.render(), preventing concurrent-canvas errors.
    renderTask.current?.cancel()
    renderTask.current = null
    const version = ++renderVersion.current

    try {
      const page: PdfPage = await pdf.getPage(pageNum)

      // A newer render was requested while we were awaiting getPage — bail out
      if (version !== renderVersion.current) return

      const container = canvas.parentElement
      if (!container) return

      // Fit the slide into the available container width
      const containerWidth = container.clientWidth || 800
      const unscaled = page.getViewport({ scale: 1 })
      const scale    = containerWidth / unscaled.width
      const viewport = page.getViewport({ scale })

      canvas.width  = viewport.width
      canvas.height = viewport.height

      const ctx = canvas.getContext("2d")!
      const task = page.render({ canvasContext: ctx, viewport })
      renderTask.current = task

      await task.promise
    } catch (err: unknown) {
      // RenderingCancelledException is expected when we cancel mid-render
      if ((err as { name?: string })?.name !== "RenderingCancelledException") {
        console.error("[PptSlideViewer] render error", err)
      }
    }
  }, [status])

  useEffect(() => {
    if (status === "ready") {
      renderPage(currentPage)
    }
  }, [currentPage, status, renderPage])

  // ── Rerender on container resize ────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return
    const observer = new ResizeObserver(() => {
      if (status === "ready") renderPage(currentPage)
    })
    const parent = canvasRef.current.parentElement
    if (parent) observer.observe(parent)
    return () => observer.disconnect()
  }, [currentPage, status, renderPage])

  // ── UI ──────────────────────────────────────────────────────────────────────
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
        <p className="text-xs text-zinc-600">
          Tip: export your PowerPoint as a PDF before uploading.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950 overflow-hidden relative">
      <div className="relative max-w-full max-h-full overflow-auto flex items-center justify-center p-2">
        <canvas
          ref={canvasRef}
          className="block max-w-full shadow-2xl rounded"
          style={{ background: "#fff" }}
        />
      </div>

      {/* PPTX notice overlay — shown when file is a PPTX (not PDF) */}
      {fileUrl.endsWith(".pptx") && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
          <FileText className="size-3.5" />
          PPTX detected — for best results export as PDF first
        </div>
      )}
    </div>
  )
}
