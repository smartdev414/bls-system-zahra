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

// ── Types for pptxtojson output ──────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PptxSlide = { elements: any[]; layoutElements?: any[]; fill?: any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PptxResult = { slides: PptxSlide[]; size: { width: number; height: number } }

// ── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fillToStyle(fill: any): React.CSSProperties {
  if (!fill) return {}
  if (fill.type === "color") return { backgroundColor: fill.value }
  if (fill.type === "image") {
    const src = fill.value?.base64 || fill.value?.blob
    if (src) return { backgroundImage: `url(${src})`, backgroundSize: "cover", backgroundPosition: "center" }
  }
  if (fill.type === "gradient" && fill.value?.colors?.length) {
    const colors = fill.value.colors
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => `${c.color} ${c.pos}`)
      .join(", ")
    const rot = fill.value.rot ?? 0
    return { background: `linear-gradient(${rot}deg, ${colors})` }
  }
  if (fill.type === "pattern" && fill.value?.backgroundColor) {
    return { backgroundColor: fill.value.backgroundColor }
  }
  return {}
}

// ── Render a single slide element to HTML ────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SlideElement({ el }: { el: any }) {
  const base: React.CSSProperties = {
    position: "absolute",
    left: `${el.left}pt`,
    top: `${el.top}pt`,
    width: `${el.width}pt`,
    height: `${el.height}pt`,
    transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined,
  }

  if (el.type === "group" && el.elements) {
    return (
      <div style={base}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {el.elements.map((child: any, i: number) => (
          <SlideElement key={i} el={child} />
        ))}
      </div>
    )
  }

  if (el.type === "text" || el.type === "shape") {
    return (
      <div
        style={{
          ...base,
          ...fillToStyle(el.fill),
          borderColor: el.borderColor || undefined,
          borderWidth: el.borderWidth ? `${el.borderWidth}pt` : undefined,
          borderStyle: el.borderWidth ? "solid" : undefined,
          overflow: "hidden",
          wordWrap: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {el.content && (
          <div
            className="pptx-text-content"
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: el.vAlign === "mid" ? "center" : el.vAlign === "bottom" ? "flex-end" : "flex-start",
            }}
            dangerouslySetInnerHTML={{ __html: el.content }}
          />
        )}
      </div>
    )
  }

  if (el.type === "image") {
    const src = el.base64 || el.blob || ""
    if (!src) return null
    return (
      <img
        src={src}
        alt=""
        style={{ ...base, objectFit: "contain" }}
      />
    )
  }

  if (el.type === "diagram" && el.elements) {
    return (
      <div style={base}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {el.elements.map((child: any, i: number) => (
          <SlideElement key={i} el={child} />
        ))}
      </div>
    )
  }

  if (el.type === "math" && (el.picBase64 || el.picBlob)) {
    return <img src={el.picBase64 || el.picBlob} alt="" style={{ ...base, objectFit: "contain" }} />
  }

  if (el.type === "table" && el.data) {
    return (
      <div style={base}>
        <table style={{ width: "100%", height: "100%", borderCollapse: "collapse", fontSize: "10pt" }}>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {el.data.map((row: any[], ri: number) => (
              <tr key={ri}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {row.map((cell: any, ci: number) => (
                  <td
                    key={ci}
                    style={{
                      border: "0.5pt solid #ccc",
                      padding: "2pt 4pt",
                      backgroundColor: cell.fillColor,
                      verticalAlign: "middle",
                    }}
                    dangerouslySetInnerHTML={cell.text ? { __html: cell.text } : undefined}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return null
}

// ── PPTX viewer (pptxtojson + HTML rendering) ────────────────────────────────

function PptxViewer({ fileUrl, currentPage, onTotalPages }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [errorMsg, setErrorMsg] = useState("")
  const [pptxData, setPptxData] = useState<PptxResult | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!fileUrl) return
    let cancelled = false

    async function load() {
      try {
        setStatus("loading")
        const res = await fetch(fileUrl)
        if (!res.ok) throw new Error("Failed to fetch PPTX")
        const arrayBuffer = await res.arrayBuffer()

        const { parse } = await import("pptxtojson")
        const result = await parse(arrayBuffer, {
          imageMode: "base64",
          videoMode: "none",
          audioMode: "none",
        }) as PptxResult

        if (cancelled) return
        setPptxData(result)
        onTotalPages(result.slides.length)
        setStatus("ready")
      } catch (err) {
        if (cancelled) return
        console.error("[PptxViewer] failed to load PPTX", err)
        setErrorMsg("Could not load the presentation.")
        setStatus("error")
      }
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl])

  if (status === "loading") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-zinc-500 bg-zinc-950">
        <Loader2 className="size-8 animate-spin text-primary" />
        <span className="text-sm">Loading presentation…</span>
      </div>
    )
  }

  if (status === "error" || !pptxData) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-zinc-500 bg-zinc-950 px-8 text-center">
        <AlertCircle className="size-10 text-rose-500 opacity-70" />
        <p className="text-sm text-rose-400">{errorMsg}</p>
      </div>
    )
  }

  const slideIndex = Math.max(0, Math.min(currentPage - 1, pptxData.slides.length - 1))
  const slide = pptxData.slides[slideIndex]
  const { width: slideW, height: slideH } = pptxData.size

  // Slide background — default to white
  const bgStyle: React.CSSProperties = slide.fill?.type
    ? fillToStyle(slide.fill)
    : { backgroundColor: "#fff" }

  // Merge layout (master slide) elements behind the slide's own elements
  const layoutEls = slide.layoutElements ?? []
  const allElements = [...layoutEls, ...slide.elements]

  // Convert pt dimensions to px for consistent scaling (1pt = 4/3 px)
  const slideWpx = slideW * (4 / 3)
  const slideHpx = slideH * (4 / 3)

  return (
    <div ref={containerRef} className="w-full mt-4 h-[calc(100%-4.6rem)] flex items-center justify-center bg-white overflow-hidden p-2">
      <div
        className="relative rounded overflow-hidden"
        style={{
          width: "100%",
          maxWidth: "100%",
          aspectRatio: `${slideWpx} / ${slideHpx}`,
          backgroundColor: "#fff",
          ...bgStyle,
        }}
      >
        {/*
          Inner div uses px dimensions matching the original slide.
          CSS transform scales it to fit the container.
          All child element positions are in pt, which the browser converts to px at 4/3 ratio,
          matching our slideWpx/slideHpx coordinate space.
        */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${slideW}pt`,
            height: `${slideH}pt`,
            transformOrigin: "top left",
          }}
          ref={(el) => {
            if (!el) return
            const parent = el.parentElement
            if (!parent) return
            // Watch for size changes and recompute scale
            const update = () => {
              // parent.clientWidth is in px; el's width is slideW pt = slideWpx px
              const scale = parent.clientWidth / slideWpx
              el.style.transform = `scale(${scale})`
            }
            const observer = new ResizeObserver(update)
            observer.observe(parent)
            update()
          }}
        >
          {allElements.map((el, i) => (
            <SlideElement key={i} el={el} />
          ))}
        </div>
      </div>
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
      <div className="relative max-w-full max-h-full overflow-auto flex items-center justify-center p-2">
        <canvas
          ref={canvasRef}
          className="block max-w-full shadow-2xl rounded"
          style={{ background: "#fff" }}
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
