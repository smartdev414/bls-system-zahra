"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import {
  Pen, Eraser, Trash2, X, PencilLine,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { WhiteboardShape, WhiteboardStroke } from "./types"

// Palette kept deliberately small so students don't get lost in options.
const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#111827"]
const DEFAULT_COLOR  = "#ef4444"
// Normalised stroke width — feels like ~4px on a 900px-wide canvas.
const DEFAULT_WIDTH  = 0.004

type Tool = "pen" | "eraser"

// Segment-distance hit-test so a click anywhere within `tolerance` of a stroke
// picks it up. Squared distances avoid sqrt per segment.
function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const ex = px - ax, ey = py - ay
    return ex * ex + ey * ey
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cy = ay + t * dy
  const ex = px - cx, ey = py - cy
  return ex * ex + ey * ey
}

function hitStroke(stroke: WhiteboardStroke, x: number, y: number, tolerance: number) {
  const tSq = (tolerance + stroke.width / 2) ** 2
  const pts = stroke.points
  if (pts.length === 1) {
    const [ax, ay] = pts[0]
    const ex = x - ax, ey = y - ay
    return ex * ex + ey * ey <= tSq
  }
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    if (distToSegmentSq(x, y, ax, ay, bx, by) <= tSq) return true
  }
  return false
}

// Draw the given shapes onto the canvas. Called on every state change and resize.
// We render everything each frame — simpler than incremental draws and plenty
// fast for the shape counts a live lesson actually produces.
function renderStrokes(ctx: CanvasRenderingContext2D, shapes: WhiteboardShape[], w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.lineCap   = "round"
  ctx.lineJoin  = "round"
  for (const s of shapes) {
    if (s.kind !== "stroke") continue
    ctx.strokeStyle = s.color
    ctx.lineWidth   = Math.max(1, s.width * Math.min(w, h))
    ctx.beginPath()
    const pts = s.points
    if (pts.length === 0) continue
    if (pts.length === 1) {
      // Single-tap dot — draw as a filled circle so tiny taps leave a mark.
      const [x, y] = pts[0]
      ctx.fillStyle = s.color
      ctx.arc(x * w, y * h, Math.max(1, (s.width * Math.min(w, h)) / 2), 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      continue
    }
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * h)
    ctx.stroke()
  }
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function WhiteboardPanel({
  isTutor,
  localIdentity,
  shapes,
  onAdd,
  onDelete,
  onClear,
  onStop,
}: {
  isTutor: boolean
  localIdentity: string
  shapes: WhiteboardShape[]
  onAdd:    (shape: WhiteboardShape) => void
  onDelete: (id: string) => void
  onClear:  () => void
  onStop:   () => void
}) {
  const boardRef    = useRef<HTMLDivElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  // Live stroke being drawn right now — kept local until pointer-up, then
  // broadcast as a single `add` so remote clients see a complete stroke appear
  // rather than jittery chunks.
  const liveStrokeRef = useRef<WhiteboardStroke | null>(null)

  const [tool, setTool]   = useState<Tool>("pen")
  const [color, setColor] = useState<string>(DEFAULT_COLOR)

  // ── Canvas sizing: keep the backing store in sync with its CSS box ─────────
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const host   = boardRef.current
    if (!canvas || !host) return
    const rect = host.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width  = Math.floor(rect.width * dpr)
    canvas.height = Math.floor(rect.height * dpr)
    canvas.style.width  = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderStrokes(ctx, [...shapes, ...(liveStrokeRef.current ? [liveStrokeRef.current] : [])], rect.width, rect.height)
  }, [shapes])

  useEffect(() => {
    resizeCanvas()
    const ro = new ResizeObserver(() => resizeCanvas())
    if (boardRef.current) ro.observe(boardRef.current)
    return () => ro.disconnect()
  }, [resizeCanvas])

  // Repaint whenever the shape list changes
  useEffect(() => {
    const canvas = canvasRef.current
    const host   = boardRef.current
    if (!canvas || !host) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const rect = host.getBoundingClientRect()
    renderStrokes(ctx, [...shapes, ...(liveStrokeRef.current ? [liveStrokeRef.current] : [])], rect.width, rect.height)
  }, [shapes])

  // ── Coordinate helper: clientX/Y → normalised [0,1] against the board ──────
  function toNorm(clientX: number, clientY: number) {
    const host = boardRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const x = (clientX - rect.left) / rect.width
    const y = (clientY - rect.top)  / rect.height
    return { x, y, w: rect.width, h: rect.height }
  }

  // ── Pointer: pen / eraser ──────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const norm = toNorm(e.clientX, e.clientY)
    if (!norm) return

    if (tool === "pen") {
      const stroke: WhiteboardStroke = {
        id: uid(),
        kind: "stroke",
        author: localIdentity,
        color,
        width: DEFAULT_WIDTH,
        points: [[norm.x, norm.y]],
      }
      liveStrokeRef.current = stroke
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      resizeCanvas()
      return
    }

    if (tool === "eraser") {
      // Walk strokes newest-first so the top-most gets erased.
      const tolerance = 0.025  // ~2.5% of board dimension — forgiving for fingers/mice
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i]
        if (s.kind === "stroke" && hitStroke(s, norm.x, norm.y, tolerance)) {
          onDelete(s.id)
          return
        }
      }
      return
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const live = liveStrokeRef.current
    if (!live) return
    const norm = toNorm(e.clientX, e.clientY)
    if (!norm) return
    // Drop duplicate points — avoids bloating the payload when the pen sits still.
    const last = live.points[live.points.length - 1]
    if (last && Math.abs(last[0] - norm.x) < 0.001 && Math.abs(last[1] - norm.y) < 0.001) return
    live.points.push([norm.x, norm.y])
    // Repaint the canvas with the in-progress stroke overlaid.
    resizeCanvas()
  }

  const handlePointerUp = () => {
    const live = liveStrokeRef.current
    if (!live) return
    liveStrokeRef.current = null
    // Tiny flicks sometimes produce an empty-ish stroke — drop them.
    if (live.points.length === 0) return
    onAdd(live)
    // Canvas is already showing the live version; the state update will
    // re-render it from `shapes` once the add lands.
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full bg-zinc-100 dark:bg-zinc-100 flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border-b border-zinc-700">
        <div className="flex items-center gap-1 mr-2">
          <PencilLine className="size-3.5 text-amber-400" />
          <span className="text-xs font-bold text-white">Whiteboard</span>
        </div>

        <div className="h-5 w-px bg-zinc-700 mx-1" />

        {/* Tools */}
        <button
          onClick={() => setTool("pen")}
          className={cn(
            "flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium transition-colors",
            tool === "pen"
              ? "bg-primary text-primary-foreground"
              : "bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700"
          )}
          title="Pen"
        >
          <Pen className="size-3.5" /> Pen
        </button>
        <button
          onClick={() => setTool("eraser")}
          className={cn(
            "flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium transition-colors",
            tool === "eraser"
              ? "bg-primary text-primary-foreground"
              : "bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700"
          )}
          title="Eraser — click on a shape to delete it"
        >
          <Eraser className="size-3.5" /> Eraser
        </button>

        <div className="h-5 w-px bg-zinc-700 mx-1" />

        {/* Color palette */}
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                "size-6 rounded-full transition-transform",
                color === c ? "ring-2 ring-white scale-110" : "ring-1 ring-zinc-600 hover:scale-105"
              )}
              style={{ background: c }}
              title={`Color ${c}`}
              aria-label={`Pick color ${c}`}
              aria-pressed={color === c}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {isTutor && (
            <button
              onClick={() => {
                if (shapes.length === 0) return
                if (window.confirm("Clear the whole whiteboard for everyone?")) onClear()
              }}
              disabled={shapes.length === 0}
              className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium bg-zinc-700/60 hover:bg-rose-900/60 hover:text-rose-200 text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Erase every shape on the board"
            >
              <Trash2 className="size-3.5" /> Clear
            </button>
          )}
          {isTutor && (
            <button
              onClick={onStop}
              className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium bg-amber-900/40 hover:bg-amber-900/70 text-amber-300 border border-amber-700/40 transition-colors"
              title="Close the whiteboard for everyone"
            >
              <X className="size-3.5" /> Close
            </button>
          )}
        </div>
      </div>

      {/* Board surface */}
      <div
        ref={boardRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex-1 relative overflow-hidden bg-white cursor-crosshair"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none"
        />
      </div>
    </div>
  )
}
