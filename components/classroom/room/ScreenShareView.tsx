"use client"

// The shared screen, with the controls a student needs to actually read it.
//
// A shared screen arrives as a video of someone else's display, so the text on
// it is only as big as the panel it lands in — and in the split (camera + share)
// layout that panel is half the stage. Three things fix that here, all local to
// the viewer so one student zooming in doesn't change anyone else's view:
//
//   • Wide mode  — hands the whole stage to the share, with the teacher's camera
//                  kept as a corner inset (never dropped: this is a BSL room).
//   • Zoom & pan — scroll / pinch to magnify up to 5×, drag to move around.
//   • Fullscreen — the share alone, edge to edge.

import { useCallback, useEffect, useRef, useState } from "react"
import { VideoTrack } from "@livekit/components-react"
import type { TrackReference } from "@livekit/components-react"
import {
  ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw,
  PanelLeftClose, PanelLeftOpen, Move,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SCREEN_ZOOM_MAX, SCREEN_ZOOM_MIN, SCREEN_ZOOM_STEP } from "./constants"

type Point = { x: number; y: number }

const ORIGIN: Point = { x: 0, y: 0 }

export function ScreenShareView({
  trackRef,
  wide,
  onToggleWide,
}: {
  trackRef: TrackReference
  /** True when the share has taken over the whole stage. */
  wide: boolean
  onToggleWide: () => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom]     = useState(1)
  const [offset, setOffset] = useState<Point>(ORIGIN)
  const [panning, setPanning]       = useState(false)
  const [pinching, setPinching]     = useState(false)
  const [isFullscreen, setFullscreen] = useState(false)

  // Live pointers, so a two-finger pinch can be told apart from a one-finger pan.
  const pointersRef = useRef(new Map<number, Point>())
  const pinchRef    = useRef<{ dist: number; zoom: number } | null>(null)
  const panRef      = useRef<{ start: Point; offset: Point } | null>(null)

  // Keep the picture inside its frame: at zoom z the content is z× the frame, so
  // it can travel at most half the overhang in each direction before an empty
  // band appears at the edge.
  const clamp = useCallback((next: Point, z: number): Point => {
    const el = frameRef.current
    if (!el) return next
    const maxX = (el.clientWidth  * (z - 1)) / 2
    const maxY = (el.clientHeight * (z - 1)) / 2
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }, [])

  // Zoom around a fixed point (the cursor, or the frame centre) so the thing the
  // viewer is looking at stays under the cursor instead of sliding away.
  const zoomAround = useCallback((nextZoom: number, anchor: Point | null) => {
    const el = frameRef.current
    const z1 = zoom
    const z2 = Math.min(SCREEN_ZOOM_MAX, Math.max(SCREEN_ZOOM_MIN, nextZoom))
    if (z2 === z1) return

    let next = ORIGIN
    if (z2 !== 1) {
      if (!el || !anchor) {
        next = clamp(offset, z2)
      } else {
        const rect = el.getBoundingClientRect()
        // Anchor relative to the frame's centre — the transform origin.
        const px = anchor.x - rect.left - rect.width  / 2
        const py = anchor.y - rect.top  - rect.height / 2
        next = clamp(
          {
            x: px - ((px - offset.x) * z2) / z1,
            y: py - ((py - offset.y) * z2) / z1,
          },
          z2,
        )
      }
    }
    setZoom(z2)
    setOffset(next)
  }, [zoom, offset, clamp])

  const reset = useCallback(() => {
    setZoom(1)
    setOffset(ORIGIN)
  }, [])

  // Scroll to zoom. Non-passive so the page behind doesn't scroll instead —
  // React's onWheel is passive, hence the manual listener.
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const direction = e.deltaY > 0 ? -1 : 1
      zoomAround(zoom + direction * SCREEN_ZOOM_STEP * (e.ctrlKey ? 2 : 1), { x: e.clientX, y: e.clientY })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoom, zoomAround])

  // Track fullscreen changes from any source (Esc, F11, our own button).
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = frameRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => { /* already exited */ })
    } else {
      void el.requestFullscreen?.().catch(() => { /* denied — no-op */ })
    }
  }, [])

  // ── Pointer handling: one finger pans, two fingers pinch ───────────────────

  const onPointerDown = (e: React.PointerEvent) => {
    const pts = pointersRef.current
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pts.size === 2) {
      const [a, b] = [...pts.values()]
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }
      panRef.current = null
      setPanning(false)
      setPinching(true)
      return
    }
    if (pts.size === 1 && zoom > 1) {
      e.currentTarget.setPointerCapture(e.pointerId)
      panRef.current = { start: { x: e.clientX, y: e.clientY }, offset }
      setPanning(true)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const pts = pointersRef.current
    if (!pts.has(e.pointerId)) return
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const pinch = pinchRef.current
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.dist > 0) {
        zoomAround(pinch.zoom * (dist / pinch.dist), {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        })
      }
      return
    }

    const pan = panRef.current
    if (!pan) return
    setOffset(
      clamp(
        {
          x: pan.offset.x + (e.clientX - pan.start.x),
          y: pan.offset.y + (e.clientY - pan.start.y),
        },
        zoom,
      ),
    )
  }

  const endPointer = (e: React.PointerEvent) => {
    const pts = pointersRef.current
    pts.delete(e.pointerId)
    if (pts.size < 2) {
      pinchRef.current = null
      setPinching(false)
    }
    if (pts.size === 0) {
      panRef.current = null
      setPanning(false)
    }
  }

  // Double-click toggles a quick 2.5× magnifier on the spot that was clicked —
  // the fastest way to read one line of small text and get back out.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (zoom > 1) reset()
    else zoomAround(2.5, { x: e.clientX, y: e.clientY })
  }

  const zoomedIn = zoom > 1

  return (
    <div
      ref={frameRef}
      className={cn(
        "absolute inset-0 overflow-hidden bg-zinc-950 touch-none select-none group/share",
        zoomedIn ? (panning ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="w-full h-full"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
          // No easing while dragging — the picture must track the finger exactly.
          transition: panning || pinching ? "none" : "transform 120ms ease-out",
        }}
      >
        <VideoTrack trackRef={trackRef} className="w-full h-full object-contain" />
      </div>

      {/* Controls — always visible on touch, fade in on hover for mouse users. */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full bg-black/75 backdrop-blur-sm ring-1 ring-white/15 px-1.5 py-1 shadow-xl opacity-70 hover:opacity-100 focus-within:opacity-100 group-hover/share:opacity-100 transition-opacity">
        <ControlButton
          onClick={() => zoomAround(zoom - SCREEN_ZOOM_STEP, null)}
          disabled={zoom <= SCREEN_ZOOM_MIN}
          title="Zoom out (scroll down over the screen)"
        >
          <ZoomOut className="size-4" />
        </ControlButton>

        <button
          type="button"
          onClick={reset}
          disabled={!zoomedIn}
          className="min-w-14 px-1 text-[11px] font-semibold text-white/90 tabular-nums hover:text-white disabled:text-white/50 transition-colors"
          title={zoomedIn ? "Reset to fit" : "Fit to panel"}
        >
          {Math.round(zoom * 100)}%
        </button>

        <ControlButton
          onClick={() => zoomAround(zoom + SCREEN_ZOOM_STEP, null)}
          disabled={zoom >= SCREEN_ZOOM_MAX}
          title="Zoom in (scroll up over the screen, or double-click)"
        >
          <ZoomIn className="size-4" />
        </ControlButton>

        <ControlButton onClick={reset} disabled={!zoomedIn} title="Reset zoom and position">
          <RotateCcw className="size-4" />
        </ControlButton>

        <span className="w-px h-5 bg-white/20 mx-0.5" aria-hidden />

        <ControlButton
          onClick={onToggleWide}
          active={wide}
          title={
            wide
              ? "Back to side-by-side — bigger camera, smaller screen"
              : "Widen the shared screen — the teacher's camera moves to the corner"
          }
        >
          {wide ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </ControlButton>

        <ControlButton
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen — the shared screen only"}
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </ControlButton>
      </div>

      {/* Nudge for the pan gesture — only while it's actually available. */}
      {zoomedIn && !panning && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-black/70 backdrop-blur-sm px-3 py-1 text-[11px] font-medium text-white/80 pointer-events-none">
          <Move className="size-3" />
          Drag to move around
        </div>
      )}
    </div>
  )
}

function ControlButton({
  onClick,
  disabled,
  title,
  active,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "flex items-center justify-center size-8 rounded-full transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-white/90 hover:bg-white/15 hover:text-white",
        disabled && "opacity-35 cursor-not-allowed hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}
