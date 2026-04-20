"use client"

import { useState, useRef, useEffect } from "react"
import { useRoomContext } from "@livekit/components-react"
import { RoomEvent } from "livekit-client"
import type { CaptionEntry } from "./types"

export function CaptionsOverlay() {
  const room = useRoomContext()
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const clearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (segments: any[], participant: any) => {
      segments.forEach((seg) => {
        if (!seg.text?.trim()) return
        setCaptions((prev) => {
          const idx = prev.findIndex((c) => c.id === seg.id)
          const entry: CaptionEntry = {
            id: seg.id,
            speakerName: participant?.name ?? participant?.identity ?? "Unknown",
            text: seg.text,
            final: seg.final,
          }
          if (idx >= 0) {
            const next = [...prev]; next[idx] = entry; return next
          }
          return [...prev.slice(-1), entry]
        })
        if (seg.final) {
          const existing = clearTimers.current.get(seg.id)
          if (existing) clearTimeout(existing)
          clearTimers.current.set(seg.id, setTimeout(() => {
            setCaptions((prev) => prev.filter((c) => c.id !== seg.id))
            clearTimers.current.delete(seg.id)
          }, 4000))
        }
      })
    }

    room.on(RoomEvent.TranscriptionReceived, handler)
    const timers = clearTimers.current
    return () => {
      room.off(RoomEvent.TranscriptionReceived, handler)
      timers.forEach(clearTimeout)
    }
  }, [room])

  const visible = captions.filter((c) => c.text.trim())
  if (visible.length === 0) return null

  return (
    <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none z-20 px-6">
      <div className="bg-black/80 backdrop-blur-sm rounded-2xl px-5 py-3 max-w-2xl w-full flex flex-col gap-1.5">
        {visible.map((c) => (
          <p key={c.id} className="text-sm leading-snug text-white">
            <span className="font-semibold text-amber-400 mr-1.5">{c.speakerName}:</span>
            {c.text}
          </p>
        ))}
      </div>
    </div>
  )
}
