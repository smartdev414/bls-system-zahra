"use client"

import { useEffect, useRef } from "react"
import { useLocalParticipant, useDataChannel } from "@livekit/components-react"
import { ParticipantEvent } from "livekit-client"
import { CAPTION_TOPIC, enc } from "./constants"
import type { CaptionMessage } from "./types"

// Live captions, the free way: the browser's Web Speech API transcribes the
// LOCAL participant's own microphone while it's unmuted, and we broadcast the
// recognised text over CAPTION_TOPIC. CaptionsOverlay renders it for everyone —
// the key win is the Deaf tutor reading what a speaking student is saying.
//
// Caveats (by design of the Web Speech API):
//  - Works in Chrome/Edge; Safari/Firefox support is poor or absent — those
//    speakers simply won't be captioned (everyone else still sees others' captions).
//  - Chrome streams the audio to Google's speech service for recognition.
// Renders nothing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = any

function getRecognitionCtor(): AnyRec | null {
  if (typeof window === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function SpeechCaptionPublisher() {
  const { localParticipant } = useLocalParticipant()
  const { send } = useDataChannel(CAPTION_TOPIC)

  const recRef = useRef<AnyRec | null>(null)
  const runningRef = useRef(false)
  const wantOnRef = useRef(false)
  const idRef = useRef(0)

  const name = localParticipant.name ?? localParticipant.identity

  // Keep `send` in a ref so a new function identity between renders doesn't tear
  // down and restart speech recognition.
  const sendRef = useRef(send)
  sendRef.current = send

  useEffect(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return // unsupported browser — stay silent, others still get captions

    const broadcast = (payload: CaptionMessage) => {
      try { sendRef.current(enc.encode(JSON.stringify(payload)), { reliable: false }) } catch { /* transient */ }
    }

    const start = () => {
      if (runningRef.current) return
      const rec: AnyRec = new Ctor()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = "en-GB"

      rec.onresult = (event: AnyRec) => {
        const result = event.results[event.results.length - 1]
        if (!result) return
        const text: string = (result[0]?.transcript ?? "").trim()
        if (!text) return
        const final: boolean = !!result.isFinal
        broadcast({ id: `${localParticipant.identity}-${idRef.current}`, name, text, final })
        if (final) idRef.current += 1 // next utterance gets a fresh id
      }

      // The API stops itself periodically (and on silence). Restart while the
      // mic is still meant to be on; ignore benign errors like "no-speech".
      rec.onend = () => {
        runningRef.current = false
        if (wantOnRef.current) {
          try { rec.start(); runningRef.current = true } catch { /* will retry on next toggle */ }
        }
      }
      rec.onerror = (e: AnyRec) => {
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          wantOnRef.current = false // mic/permission denied for speech — stop trying
        }
      }

      try {
        rec.start()
        recRef.current = rec
        runningRef.current = true
      } catch { /* already starting */ }
    }

    const stop = () => {
      wantOnRef.current = false
      const rec = recRef.current
      if (rec) { try { rec.stop() } catch { /* ignore */ } }
      runningRef.current = false
    }

    const sync = () => {
      const on = !!localParticipant.isMicrophoneEnabled
      wantOnRef.current = on
      if (on) start()
      else stop()
    }

    sync()
    localParticipant.on(ParticipantEvent.TrackMuted, sync)
    localParticipant.on(ParticipantEvent.TrackUnmuted, sync)
    localParticipant.on(ParticipantEvent.LocalTrackPublished, sync)
    localParticipant.on(ParticipantEvent.LocalTrackUnpublished, sync)

    return () => {
      localParticipant.off(ParticipantEvent.TrackMuted, sync)
      localParticipant.off(ParticipantEvent.TrackUnmuted, sync)
      localParticipant.off(ParticipantEvent.LocalTrackPublished, sync)
      localParticipant.off(ParticipantEvent.LocalTrackUnpublished, sync)
      wantOnRef.current = false
      const rec = recRef.current
      if (rec) { rec.onend = null; try { rec.stop() } catch { /* ignore */ } }
      runningRef.current = false
    }
  }, [localParticipant, name])

  return null
}
