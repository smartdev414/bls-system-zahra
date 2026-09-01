"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import {
  useParticipants,
  useTracks,
  VideoTrack,
  isTrackReference,
} from "@livekit/components-react"
import { Track } from "livekit-client"
import { X, Move, Camera, HandMetal } from "lucide-react"
import { localCameraClassName } from "@/components/classroom/localCameraView"

/**
 * The window is sized from its width alone so the picture inside it is always
 * 16:9. Dragging the corner freely let it be pulled into a tall box, and a
 * camera cropped to fill one loses the space a signer's hands move through —
 * the picture has to stay landscape for the signing to be readable at all.
 */
const MIN_W = 200
const DEFAULT_W = 300
const HEADER_H = 28          // the drag bar above the video (h-7)
const videoHeight = (width: number) => Math.round((width * 9) / 16)
const boxHeight   = (width: number) => videoHeight(width) + HEADER_H

type Box = { x: number; y: number; width: number; height: number }

export function FloatingVideoWindow({
  identity,
  localIdentity,
  initial,
  onClose,
  handRaised,
  onLowerHand,
}: {
  identity: string
  localIdentity: string
  initial: { x: number; y: number }
  onClose: () => void
  handRaised?: boolean
  onLowerHand?: (identity: string) => void
}) {
  const [box, setBox] = useState<Box>(() => {
    // Keep the window fully on-screen on first paint.
    const width = DEFAULT_W
    const height = boxHeight(width)
    const maxX = typeof window !== "undefined" ? window.innerWidth - width - 8 : initial.x
    const maxY = typeof window !== "undefined" ? window.innerHeight - height - 8 : initial.y
    return {
      x: Math.min(Math.max(8, initial.x), maxX),
      y: Math.min(Math.max(8, initial.y), maxY),
      width,
      height,
    }
  })

  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null)

  const participants = useParticipants()
  const camTracks    = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })

  const participant = participants.find((p) => p.identity === identity)
  const screenRef   = screenTracks.find(
    (t) => t.participant.identity === identity && isTrackReference(t),
  )
  const camRef      = camTracks.find(
    (t) => t.participant.identity === identity && isTrackReference(t),
  )
  const trackRef    = screenRef ?? camRef
  const displayName = participant?.name ?? identity
  const mirrorLocalCamera = identity === localIdentity && !screenRef

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        setBox((prev) => {
          const nextX = e.clientX - dragRef.current!.offsetX
          const nextY = e.clientY - dragRef.current!.offsetY
          const maxX = window.innerWidth - prev.width
          const maxY = window.innerHeight - prev.height
          return {
            ...prev,
            x: Math.min(Math.max(0, nextX), Math.max(0, maxX)),
            y: Math.min(Math.max(0, nextY), Math.max(0, maxY)),
          }
        })
      }
      if (resizeRef.current) {
        const dx = e.clientX - resizeRef.current.startX
        const dy = e.clientY - resizeRef.current.startY
        // One dimension drives both. Whichever way the corner is pulled hardest
        // sets the width; the height follows from it, so the window can't leave
        // 16:9 no matter how the handle is dragged.
        const delta = Math.abs(dy) * (16 / 9) > Math.abs(dx) ? (dy * 16) / 9 : dx
        const width = Math.max(MIN_W, resizeRef.current.startW + delta)
        setBox((prev) => ({ ...prev, width, height: boxHeight(width) }))
      }
    }
    const onUp = () => {
      dragRef.current = null
      resizeRef.current = null
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { offsetX: e.clientX - box.x, offsetY: e.clientY - box.y }
      document.body.style.userSelect = "none"
    },
    [box.x, box.y],
  )

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: box.width,
        startH: box.height,
      }
      document.body.style.userSelect = "none"
    },
    [box.width, box.height],
  )

  return (
    <div
      className="fixed z-[60] bg-zinc-950 rounded-lg shadow-2xl ring-1 ring-white/10 overflow-hidden flex flex-col"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      role="dialog"
      aria-label={`${displayName} video`}
    >
      <div
        className="h-7 bg-zinc-800/95 flex items-center justify-between px-2 cursor-move shrink-0 select-none"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Move className="size-3 text-zinc-400 shrink-0" />
          <span className="text-xs text-white truncate font-medium">{displayName}</span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-white transition-colors"
          title="Close"
          aria-label="Close video window"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 relative bg-zinc-900 min-h-0">
        {trackRef ? (
          <VideoTrack
            trackRef={trackRef}
            className={localCameraClassName(
              mirrorLocalCamera,
              // Neither is cropped. The box is already 16:9, so a 16:9 camera
              // fills it either way — and a 4:3 one letterboxes rather than
              // losing the top of a head and the sides of a sign.
              "w-full h-full object-contain",
            )}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
            <div className="size-12 rounded-full bg-primary/15 flex items-center justify-center text-primary text-lg font-bold">
              {displayName[0]?.toUpperCase()}
            </div>
            <span className="flex items-center gap-1 text-[10px] text-zinc-500">
              <Camera className="size-3" />
              Camera off
            </span>
          </div>
        )}

        {handRaised && (
          onLowerHand ? (
            <button
              onClick={() => onLowerHand(identity)}
              className="absolute top-2 right-2 flex items-center justify-center size-7 rounded-full bg-amber-400 hover:bg-rose-500 text-zinc-950 hover:text-white shadow-md ring-2 ring-amber-300/70 hover:ring-rose-300/70 animate-pulse hover:animate-none transition-colors"
              title={`Click to lower ${displayName}'s hand`}
              aria-label={`Lower ${displayName}'s hand`}
            >
              <HandMetal className="size-4" />
            </button>
          ) : (
            <span
              className="absolute top-2 right-2 flex items-center justify-center size-7 rounded-full bg-amber-400 text-zinc-950 shadow-md ring-2 ring-amber-300/70 animate-pulse pointer-events-none"
              title={`${displayName} raised their hand`}
              aria-label={`${displayName} has their hand raised`}
            >
              <HandMetal className="size-4" />
            </span>
          )
        )}
      </div>

      {/* Resize handle — bottom-right corner */}
      <div
        className="absolute bottom-0 right-0 size-4 cursor-se-resize"
        onMouseDown={handleResizeStart}
        title="Drag to resize"
        aria-label="Resize window"
      >
        <div className="absolute bottom-1 right-1 size-2 border-r-2 border-b-2 border-zinc-400 rounded-br-[2px]" />
      </div>
    </div>
  )
}
