"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useRoomContext } from "@livekit/components-react"
import { RoomEvent, type Participant, type TranscriptionSegment } from "livekit-client"
import { cn } from "@/lib/utils"

type CaptionLine = {
  id: string
  speakerId: string
  speakerName: string
  isTutor: boolean
  text: string
  final: boolean
  updatedAt: number
}

const MAX_VISIBLE = 4
const FINAL_HOLD_MS = 6000

function speakerIsTutor(participant?: Participant | null): boolean {
  return participant?.metadata === "tutor"
}

export function CaptionsOverlay() {
  const room = useRoomContext()
  const [lines, setLines] = useState<CaptionLine[]>([])
  const clearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const segmentToLine = useRef<Map<string, string>>(new Map())

  const applySegment = useCallback((
    segment: TranscriptionSegment,
    participant?: Participant | null,
  ) => {
    const text = (segment.text ?? "").trim()
    if (!text) return

    const speakerId = participant?.identity ?? "unknown"
    const speakerName = participant?.name ?? participant?.identity ?? "Unknown"
    const isTutor = speakerIsTutor(participant)
    const lineId = segmentToLine.current.get(segment.id) ?? `${speakerId}:${segment.id}`

    if (!segmentToLine.current.has(segment.id)) {
      segmentToLine.current.set(segment.id, lineId)
    }

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === lineId)
      const entry: CaptionLine = {
        id: lineId,
        speakerId,
        speakerName,
        isTutor,
        text,
        final: !!segment.final,
        updatedAt: Date.now(),
      }
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = entry
        return next
      }
      const next = [...prev, entry]
      return next
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(-MAX_VISIBLE)
    })

    const existing = clearTimers.current.get(lineId)
    if (existing) clearTimeout(existing)

    if (segment.final) {
      clearTimers.current.set(lineId, setTimeout(() => {
        setLines((prev) => prev.filter((l) => l.id !== lineId))
        clearTimers.current.delete(lineId)
        segmentToLine.current.forEach((v, k) => {
          if (v === lineId) segmentToLine.current.delete(k)
        })
      }, FINAL_HOLD_MS))
    }
  }, [])

  useEffect(() => {
    const handler = (
      segments: TranscriptionSegment[],
      participant?: Participant,
    ) => {
      segments.forEach((seg) => applySegment(seg, participant))
    }

    room.on(RoomEvent.TranscriptionReceived, handler)
    const timers = clearTimers.current
    return () => {
      room.off(RoomEvent.TranscriptionReceived, handler)
      timers.forEach(clearTimeout)
    }
  }, [room, applySegment])

  const visible = useMemo(
    () => lines.filter((l) => l.text.trim()).sort((a, b) => a.updatedAt - b.updatedAt),
    [lines],
  )

  if (visible.length === 0) return null

  return (
    <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none z-30 px-3 sm:px-6">
      <div
        className="bg-black/85 backdrop-blur-md rounded-2xl px-4 py-3 max-w-3xl w-full flex flex-col gap-2 shadow-lg border border-white/10"
        aria-live="polite"
        aria-label="Live captions"
      >
        {visible.map((line) => (
          <p
            key={line.id}
            className={cn(
              "text-sm leading-snug text-white transition-opacity",
              !line.final && "opacity-80",
            )}
          >
            <span
              className={cn(
                "font-semibold mr-1.5 shrink-0",
                line.isTutor ? "text-amber-300" : "text-sky-300",
              )}
            >
              {line.speakerName}
              {line.isTutor ? " (Tutor)" : ""}:
            </span>
            <span className={cn(!line.final && "italic")}>{line.text}</span>
            {!line.final && (
              <span className="inline-block ml-1 size-1.5 rounded-full bg-emerald-400 animate-pulse align-middle" aria-hidden />
            )}
          </p>
        ))}
      </div>
    </div>
  )
}
