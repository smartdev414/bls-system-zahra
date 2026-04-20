"use client"

import { useEffect, useRef, useState } from "react"
import { PlayCircle } from "lucide-react"

interface VideoPlayerProps {
  isTutor: boolean
  url: string

  // Target playback state, authoritative from the tutor. Students mirror it;
  // the tutor ignores these (they're the source of truth).
  playing: boolean
  currentTime: number
  /** Date.now() when the target state was captured. Used to project
   *  currentTime forward on the student side so network latency + time spent
   *  rendering doesn't accumulate as drift. */
  asOf: number

  // Tutor-side callbacks. `currentTime` is the tutor's video time at the
  // moment the event fired.
  onPlayPause: (playing: boolean, currentTime: number) => void
  onSeek:      (currentTime: number) => void
}

// Threshold above which a student re-seeks to the tutor's position. Anything
// smaller would thrash on normal jitter; much larger lets visible desync build.
const STUDENT_DRIFT_THRESHOLD_S = 0.5
// How often a student cross-checks its own playhead against the target.
const STUDENT_DRIFT_POLL_MS     = 2000

export function VideoPlayer({
  isTutor,
  url,
  playing,
  currentTime,
  asOf,
  onPlayPause,
  onSeek,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [needsUnblock, setNeedsUnblock] = useState(false)

  // Tutor side: wire DOM events so every play/pause/seek broadcasts. We avoid
  // the mirroring effect below entirely so nothing fights the tutor.
  useEffect(() => {
    if (!isTutor) return
    const el = videoRef.current
    if (!el) return

    const onPlay    = () => onPlayPause(true,  el.currentTime)
    const onPause   = () => onPlayPause(false, el.currentTime)
    const onSeeked  = () => onSeek(el.currentTime)

    el.addEventListener("play",   onPlay)
    el.addEventListener("pause",  onPause)
    el.addEventListener("seeked", onSeeked)
    return () => {
      el.removeEventListener("play",   onPlay)
      el.removeEventListener("pause",  onPause)
      el.removeEventListener("seeked", onSeeked)
    }
  }, [isTutor, onPlayPause, onSeek])

  // Student side: mirror tutor's target state. Re-runs whenever the tutor
  // broadcasts a new `video_state`, and polls periodically to pick up drift
  // from playback-rate jitter or buffering.
  useEffect(() => {
    if (isTutor) return
    const el = videoRef.current
    if (!el) return

    let cancelled = false

    const apply = async () => {
      if (cancelled) return
      const target = playing
        ? currentTime + Math.max(0, (Date.now() - asOf) / 1000)
        : currentTime

      if (Math.abs(el.currentTime - target) > STUDENT_DRIFT_THRESHOLD_S) {
        try { el.currentTime = target } catch { /* ignore — metadata may not be ready */ }
      }

      if (playing && el.paused) {
        try {
          await el.play()
          if (!cancelled) setNeedsUnblock(false)
        } catch {
          // Autoplay blocked. Surface a tap-to-play overlay — the student's
          // click unblocks subsequent programmatic play() calls for the page.
          if (!cancelled) setNeedsUnblock(true)
        }
      } else if (!playing && !el.paused) {
        el.pause()
      }
    }

    apply()
    const interval = setInterval(apply, STUDENT_DRIFT_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isTutor, playing, currentTime, asOf, url])

  const handleUnblock = async () => {
    const el = videoRef.current
    if (!el) return
    try {
      await el.play()
      setNeedsUnblock(false)
    } catch { /* ignore — surfaces again next mirror tick */ }
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-black relative">
      <video
        ref={videoRef}
        src={url}
        // Tutor gets full controls (scrubbing seeks broadcasts). Students are
        // read-only; playsInline keeps mobile Safari from going full-screen.
        controls={isTutor}
        playsInline
        preload="auto"
        className="max-w-full max-h-full"
      />

      {!isTutor && needsUnblock && (
        <button
          onClick={handleUnblock}
          className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm text-white"
          aria-label="Tap to play video"
        >
          <div className="flex flex-col items-center gap-2">
            <PlayCircle className="size-16 opacity-90" />
            <span className="text-sm font-medium">Tap to play</span>
          </div>
        </button>
      )}
    </div>
  )
}
