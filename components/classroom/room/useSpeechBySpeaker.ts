"use client"

/**
 * Recent transcribed speech, per participant.
 *
 * In a BSL classroom students are meant to sign, not talk — and in pairs or
 * breakout groups the tutor cannot listen to every group at once. The
 * transcriber already captions every microphone, so this keeps the last few
 * things each person said aloud, for the breakout monitor to show next to that
 * person's group: a glance tells the tutor who is using their voice and what
 * they are saying.
 */

import { useEffect, useState } from "react"
import { useRoomContext } from "@livekit/components-react"
import { RoomEvent, type Participant, type TranscriptionSegment } from "livekit-client"

export type SpokenLine = {
  id: string
  identity: string
  name: string
  text: string
  final: boolean
  at: number
}

/** Lines kept per person. Enough to read the gist, not a transcript. */
const PER_SPEAKER = 4

/** Speech older than this is dropped — it says nothing about what is happening now. */
export const SPEECH_KEEP_MS = 2 * 60_000

export function useSpeechBySpeaker(): { bySpeaker: Map<string, SpokenLine[]>; now: number } {
  const room = useRoomContext()
  const [bySpeaker, setBySpeaker] = useState<Map<string, SpokenLine[]>>(() => new Map())
  // The clock is state, ticked on an interval, so render stays pure.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const handler = (segments: TranscriptionSegment[], participant?: Participant) => {
      if (!participant) return
      const identity = participant.identity
      const name = participant.name || identity
      const at = Date.now()
      setNow(at)
      setBySpeaker((prev) => {
        const next = new Map(prev)
        let lines = [...(next.get(identity) ?? [])]
        for (const seg of segments) {
          const text = (seg.text ?? "").trim()
          const idx = lines.findIndex((l) => l.id === seg.id)
          if (!text) {
            // An empty final is the transcriber retracting noise — drop it.
            if (seg.final && idx >= 0) lines.splice(idx, 1)
            continue
          }
          const line: SpokenLine = { id: seg.id, identity, name, text, final: !!seg.final, at }
          if (idx >= 0) lines[idx] = { ...line, at: lines[idx].at }
          else lines.push(line)
        }
        lines = lines.slice(-PER_SPEAKER)
        if (lines.length) next.set(identity, lines)
        else next.delete(identity)
        return next
      })
    }
    room.on(RoomEvent.TranscriptionReceived, handler)
    return () => { room.off(RoomEvent.TranscriptionReceived, handler) }
  }, [room])

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      setBySpeaker((prev) => {
        let changed = false
        const next = new Map<string, SpokenLine[]>()
        for (const [k, lines] of prev) {
          const kept = lines.filter((l) => t - l.at <= SPEECH_KEEP_MS)
          if (kept.length !== lines.length) changed = true
          if (kept.length) next.set(k, kept)
        }
        return changed ? next : prev
      })
    }, 5_000)
    return () => clearInterval(id)
  }, [])

  return { bySpeaker, now }
}
