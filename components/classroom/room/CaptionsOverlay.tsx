"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRoomContext, useDataChannel } from "@livekit/components-react"
import { RoomEvent } from "livekit-client"
import { CAPTION_TOPIC, dec } from "./constants"
import type { CaptionEntry, CaptionMessage } from "./types"

export function CaptionsOverlay() {
  const room = useRoomContext()
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const clearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Shared by both caption sources: LiveKit's native transcription event and
  // our Web Speech API broadcasts. Keeps only the latest line; finals fade after 4s.
  const applySegment = useCallback((id: string, speakerName: string, text: string, final: boolean) => {
    if (!text.trim()) return
    setCaptions((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      const entry: CaptionEntry = { id, speakerName, text, final }
      if (idx >= 0) {
        const next = [...prev]; next[idx] = entry; return next
      }
      return [...prev.slice(-1), entry]
    })
    if (final) {
      const existing = clearTimers.current.get(id)
      if (existing) clearTimeout(existing)
      clearTimers.current.set(id, setTimeout(() => {
        setCaptions((prev) => prev.filter((c) => c.id !== id))
        clearTimers.current.delete(id)
      }, 4000))
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (segments: any[], participant: any) => {
      segments.forEach((seg) => {
        applySegment(seg.id, participant?.name ?? participant?.identity ?? "Unknown", seg.text ?? "", seg.final)
      })
    }

    room.on(RoomEvent.TranscriptionReceived, handler)
    const timers = clearTimers.current
    return () => {
      room.off(RoomEvent.TranscriptionReceived, handler)
      timers.forEach(clearTimeout)
    }
  }, [room, applySegment])

  // Web Speech API captions broadcast by each speaker's browser.
  useDataChannel(CAPTION_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as CaptionMessage
      applySegment(data.id, data.name, data.text, data.final)
    } catch { /* ignore malformed */ }
  })

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
