"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import {
  Pen, Eraser, Trash2, X, PencilLine, Type, GripVertical,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { WhiteboardShape, WhiteboardStroke, WhiteboardText } from "./types"

// Palette kept deliberately small so students don't get lost in options.
const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#111827"]
const DEFAULT_COLOR  = "#ef4444"
// Normalised stroke width — feels like ~4px on a 900px-wide canvas.
const DEFAULT_WIDTH  = 0.004
// Normalised font size — ~22px on a 600px-tall board.
const DEFAULT_TEXT_SIZE = 0.037

type Tool = "pen" | "text" | "eraser"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

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
  onUpdate,
  onDelete,
  onClear,
  onStop,
}: {
  isTutor: boolean
  localIdentity: string
  shapes: WhiteboardShape[]
  onAdd:    (shape: WhiteboardShape) => void
  onUpdate: (shape: WhiteboardShape) => void
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

  // Board pixel size, kept in sync via resizeCanvas — used to size text in px
  // from its normalised `size`.
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 })

  // ── Text editing / dragging state ──────────────────────────────────────────
  // The text box currently being typed into, with its working buffer. We keep
  // the draft local so each keystroke doesn't hit the data channel; Enter
  // finalises (empty boxes are removed). Clicking away keeps typed text on the board.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft]         = useState("")
  // Live drag position for the box being moved (normalised). Broadcast once on
  // pointer-up; during the drag it only drives local rendering.
  const [dragId, setDragId]   = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)

  // Shown immediately on click — parent `shapes` can land a frame later.
  const [pendingText, setPendingText] = useState<WhiteboardText | null>(null)
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editingIdRef = useRef<string | null>(null)
  // Ignore blur fired by the same click that created the box (pointer-up steals focus).
  const textCreatedAtRef = useRef(0)

  useEffect(() => {
    editingIdRef.current = editingId
  }, [editingId])

  const textShapes = shapes.filter((s): s is WhiteboardText => s.kind === "text")
  const displayTextShapes = useMemo(() => {
    if (!pendingText || textShapes.some((s) => s.id === pendingText.id)) return textShapes
    return [...textShapes, pendingText]
  }, [textShapes, pendingText])

  useEffect(() => {
    if (pendingText && textShapes.some((s) => s.id === pendingText.id)) {
      setPendingText(null)
    }
  }, [pendingText, textShapes])

  // Focus the textarea after it mounts — autoFocus alone loses to pointer-up blur.
  useEffect(() => {
    if (!editingId) return
    const id = requestAnimationFrame(() => {
      editingTextareaRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [editingId])

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
    setBoardSize((prev) =>
      prev.w === rect.width && prev.h === rect.height ? prev : { w: rect.width, h: rect.height }
    )
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

  // Keep typed text on the board when focus leaves — never delete on click-away.
  const persistDraft = useCallback((box: WhiteboardText) => {
    const text = draft.trim()
    if (text.length > 0 && text !== box.text) {
      onUpdate({ ...box, text })
    }
    setEditingId(null)
    setDraft("")
  }, [draft, onUpdate])

  // Enter finalises: save text, or remove a box that was left empty.
  const commitDraft = useCallback((box: WhiteboardText) => {
    const text = draft.trim()
    if (text.length === 0) {
      onDelete(box.id)
      if (pendingText?.id === box.id) setPendingText(null)
    } else if (text !== box.text) {
      onUpdate({ ...box, text })
    }
    setEditingId(null)
    setDraft("")
  }, [draft, onDelete, onUpdate, pendingText])

  const cancelEdit = useCallback((box: WhiteboardText) => {
    if (!box.text.trim()) {
      onDelete(box.id)
      if (pendingText?.id === box.id) setPendingText(null)
    }
    setEditingId(null)
    setDraft("")
  }, [onDelete, pendingText])

  // ── Pointer: pen / eraser ──────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const norm = toNorm(e.clientX, e.clientY)
    if (!norm) return

    // Leaving the text field for pen/eraser — keep what was typed on the board.
    if (editingId && tool !== "text") {
      const current = displayTextShapes.find((b) => b.id === editingId)
      if (current) persistDraft(current)
    }

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

    if (tool === "text") {
      // If already typing in another box, save that draft first so it isn't lost.
      e.preventDefault()
      if (editingId) {
        const current = displayTextShapes.find((b) => b.id === editingId)
        if (current) persistDraft(current)
      }

      // Drop a fresh, empty text box where the user clicked and start editing it.
      const box: WhiteboardText = {
        id: uid(),
        kind: "text",
        author: localIdentity,
        color,
        x: clamp01(norm.x),
        y: clamp01(norm.y),
        text: "",
        size: DEFAULT_TEXT_SIZE,
      }
      textCreatedAtRef.current = Date.now()
      setPendingText(box)
      setEditingId(box.id)
      setDraft("")
      onAdd(box)
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

  // ── Text box: drag to reposition ─────────────────────────────────────────────
  const handleBoxDragDown = (e: React.PointerEvent, box: WhiteboardText) => {
    e.stopPropagation()
    const norm = toNorm(e.clientX, e.clientY)
    if (!norm) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragOffsetRef.current = { x: norm.x - box.x, y: norm.y - box.y }
    setDragId(box.id)
    setDragPos({ x: box.x, y: box.y })
  }

  const handleBoxDragMove = (e: React.PointerEvent) => {
    const offset = dragOffsetRef.current
    if (!offset) return
    const norm = toNorm(e.clientX, e.clientY)
    if (!norm) return
    setDragPos({ x: clamp01(norm.x - offset.x), y: clamp01(norm.y - offset.y) })
  }

  const handleBoxDragUp = (box: WhiteboardText) => {
    const pos = dragPos
    dragOffsetRef.current = null
    setDragId(null)
    setDragPos(null)
    if (pos && (pos.x !== box.x || pos.y !== box.y)) {
      onUpdate({ ...box, x: pos.x, y: pos.y })
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
          type="button"
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
          type="button"
          onClick={() => setTool("text")}
          className={cn(
            "flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium transition-colors",
            tool === "text"
              ? "bg-primary text-primary-foreground"
              : "bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700"
          )}
          title="Text — click the board to add a box; Enter to finish; click away keeps your text"
        >
          <Type className="size-3.5" /> Text
        </button>
        <button
          type="button"
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
        className={cn(
          "flex-1 relative overflow-hidden bg-white",
          tool === "text" ? "cursor-text" : "cursor-crosshair"
        )}
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none"
        />

        {/* Text boxes — DOM overlay so they can be typed into and dragged. */}
        {displayTextShapes.map((box) => {
          const isEditing = editingId === box.id
          const isDragging = dragId === box.id
          const pos = isDragging && dragPos ? dragPos : { x: box.x, y: box.y }
          const dim = Math.min(boardSize.w || 400, boardSize.h || 300)
          const fontSize = Math.max(14, box.size * dim)
          return (
            <div
              key={box.id}
              className={cn(
                "absolute z-10 group flex items-start gap-1",
                isDragging && "opacity-90"
              )}
              style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, maxWidth: "80%" }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Drag handle */}
              <button
                type="button"
                onPointerDown={(e) => handleBoxDragDown(e, box)}
                onPointerMove={handleBoxDragMove}
                onPointerUp={() => handleBoxDragUp(box)}
                onPointerCancel={() => handleBoxDragUp(box)}
                className="mt-0.5 shrink-0 cursor-move text-zinc-400 hover:text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity touch-none"
                title="Drag to move"
                aria-label="Move text box"
              >
                <GripVertical className="size-4" />
              </button>

              {isEditing ? (
                <textarea
                  ref={isEditing ? editingTextareaRef : undefined}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    if (Date.now() - textCreatedAtRef.current < 300) {
                      requestAnimationFrame(() => {
                        if (editingIdRef.current === box.id) {
                          editingTextareaRef.current?.focus({ preventScroll: true })
                        }
                      })
                      return
                    }
                    persistDraft(box)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault()
                      textCreatedAtRef.current = 0
                      cancelEdit(box)
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      textCreatedAtRef.current = 0
                      commitDraft(box)
                    }
                  }}
                  rows={Math.max(2, Math.min(8, draft.split("\n").length + 1))}
                  className="bg-white/90 outline-none resize-none border-2 border-dashed border-zinc-500 rounded px-1.5 py-0.5 leading-tight min-w-[120px] min-h-[28px] shadow-sm"
                  style={{ color: box.color, fontSize, width: "22ch", maxWidth: "100%" }}
                  placeholder="Type here…"
                />
              ) : (
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (tool === "eraser") { onDelete(box.id); return }
                    if (editingId && editingId !== box.id) {
                      const current = displayTextShapes.find((b) => b.id === editingId)
                      if (current) persistDraft(current)
                    }
                    textCreatedAtRef.current = 0
                    setEditingId(box.id)
                    setDraft(box.text)
                  }}
                  className="cursor-text whitespace-pre-wrap break-words leading-tight px-1"
                  style={{ color: box.color, fontSize }}
                >
                  {box.text}
                </div>
              )}

              {/* Delete this box */}
              <button
                type="button"
                onPointerDown={(e) => { e.stopPropagation(); onDelete(box.id) }}
                className="mt-0.5 shrink-0 text-zinc-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete text box"
                aria-label="Delete text box"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
