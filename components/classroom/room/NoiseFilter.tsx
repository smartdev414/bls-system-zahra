"use client"

/**
 * Krisp noise cancellation on this participant's microphone.
 *
 * The browser's own `noiseSuppression` (see network-mode) takes the edge off a
 * fan, but it lets through the sounds a classroom actually has — chairs, a
 * keyboard, a dog, a café behind someone. Those reach everyone's speakers, and
 * they reach the caption agent too: it transcribes the published track, so any
 * noise left in it turns into wrong or invented words in the subtitles, which
 * for a Deaf student is the lesson itself.
 *
 * Krisp runs locally, on the track before it is published, so one filter here
 * cleans up both what people hear and what the captions are built from.
 * LiveKit Cloud only, and not every browser supports it; where it can't run
 * the hook logs a warning and the mic carries on exactly as before.
 */

import { useEffect } from "react"
import { useKrispNoiseFilter } from "@livekit/components-react/krisp"

export function NoiseFilter() {
  const { setNoiseFilterEnabled } = useKrispNoiseFilter()

  useEffect(() => {
    // Enabling is sticky: the hook re-attaches the filter whenever the mic
    // track is (re)published — unmute, device switch or a reconnect.
    setNoiseFilterEnabled(true).catch((err) => {
      console.warn("[classroom] noise filter unavailable", err)
    })
  }, [setNoiseFilterEnabled])

  return null
}
