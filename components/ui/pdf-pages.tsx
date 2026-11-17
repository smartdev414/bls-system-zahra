"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { openPdf, safeRenderScale, PdfOpenTimeoutError, type PdfDocument } from "@/lib/pdfjs"

// PdfPages
// ────────
// Every page of a PDF, one under another, drawn by pdf.js — for tablets.
//
// An iPad gets the wide layout, so it used to get the PDF in an <iframe> like a
// computer; but Safari on iPad paints only the first page of an embedded PDF
// and gives no way to scroll to the rest. Drawing the pages ourselves shows the
// whole document on every device, with the same pdf.js setup the classroom
// slides already rely on for Safari (lib/pdfjs.ts).

/**
 * Which kind of screen this is, once known on the client: a phone (narrow), a
 * tablet (wide and touch-first — iPadOS reports itself as a Mac, so ask about
 * touch), or a computer.
 */
export function useDeviceKind(): "phone" | "tablet" | "desktop" | null {
  const [kind, setKind] = useState<"phone" | "tablet" | "desktop" | null>(null)
  useEffect(() => {
    const decide = () => {
      const touch = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1
      setKind(window.innerWidth < 768 ? "phone" : touch ? "tablet" : "desktop")
    }
    const id = setTimeout(decide, 0)
    window.addEventListener("resize", decide)
    return () => { clearTimeout(id); window.removeEventListener("resize", decide) }
  }, [])
  return kind
}

export function PdfPages({ url, title }: { url: string; title: string }) {
  const [pdf, setPdf] = useState<PdfDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let doc: PdfDocument | null = null
    openPdf(url)
      .then((d) => {
        doc = d
        if (cancelled) d.destroy?.()
        else setPdf(d)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("[PdfPages] could not open PDF", err)
        setError(
          err instanceof PdfOpenTimeoutError
            ? "This file is taking too long to load — use the download link below."
            : "This file could not be shown here — use the download link below.",
        )
      })
    return () => {
      cancelled = true
      doc?.destroy?.()
    }
  }, [url])

  if (error) {
    return <p className="rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">{error}</p>
  }
  if (!pdf) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border bg-muted/20 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading {title}…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3" aria-label={title}>
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPageCanvas key={i} pdf={pdf} pageNumber={i + 1} total={pdf.numPages} />
      ))}
    </div>
  )
}

/** One page, drawn when it scrolls near the screen so a long file doesn't load all at once. */
function PdfPageCanvas({ pdf, pageNumber, total }: { pdf: PdfDocument; pageNumber: number; total: number }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [aspect, setAspect] = useState(1.414) // A4 portrait until the page says otherwise
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<void> } | null = null

    const draw = async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const unscaled = page.getViewport({ scale: 1 })
      setAspect(unscaled.height / unscaled.width)
      const wanted = (box.clientWidth / unscaled.width) * (window.devicePixelRatio || 1)
      const scale = safeRenderScale(wanted, unscaled.width, unscaled.height)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      task = page.render({ canvas, canvasContext: ctx, viewport })
      await task!.promise.catch(() => {})
      if (!cancelled) setDrawn(true)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect()
          void draw()
        }
      },
      { rootMargin: "600px 0px" },
    )
    observer.observe(box)
    return () => {
      cancelled = true
      observer.disconnect()
      task?.cancel()
    }
  }, [pdf, pageNumber])

  return (
    <div ref={boxRef} className="relative w-full rounded-lg border bg-white shadow-sm overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block w-full h-auto"
        style={drawn ? undefined : { aspectRatio: `1 / ${aspect}` }}
      />
      {!drawn && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[0.6875rem] font-medium text-white">
        Page {pageNumber} of {total}
      </span>
    </div>
  )
}
