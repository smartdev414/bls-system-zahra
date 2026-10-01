"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, PlayCircle } from "lucide-react"
import { ProtectedVideo } from "@/components/ui/protected-video"

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

  /**
   * Reports the `<video>` element so the classroom can place the tutor's hand
   * pointer against the picture rather than the panel around it. `max-w-full
   * max-h-full` sizes the element to the letterboxed picture exactly, so its
   * own box is the right rectangle. Must be a stable reference.
   */
  onContentElement?: (el: HTMLElement | null) => void
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
  onContentElement,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [needsUnblock, setNeedsUnblock] = useState(false)
  /**
   * Set when this browser cannot play the file at all. The usual cause is a
   * WebM: Chrome and Firefox play it, Safari does not, and the failure is a
   * black rectangle with no explanation — which reads as the platform being
   * broken rather than as a codec the teacher can avoid. Driven by the
   * element's own `error` event rather than guessed from the URL, so it is
   * right about the browser it is actually running in.
   */
  const [playbackError, setPlaybackError] = useState<"format" | "other" | null>(null)

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

  useEffect(() => {
    onContentElement?.(videoRef.current)
    return () => onContentElement?.(null)
  }, [onContentElement])

  const handleUnblock = async () => {
    const el = videoRef.current
    if (!el) return
    try {
      await el.play()
      setNeedsUnblock(false)
    } catch { /* ignore — surfaces again next mirror tick */ }
  }

  const handleMediaError = () => {
    const code = videoRef.current?.error?.code
    // MEDIA_ERR_SRC_NOT_SUPPORTED — the container or codec is not one this
    // browser decodes. Everything else is a fetch that went wrong.
    setPlaybackError(code === 4 ? "format" : "other")
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-black relative">
      <ProtectedVideo
        ref={videoRef}
        src={url}
        onError={handleMediaError}
        // Tutor gets full controls (scrubbing seeks broadcasts). Students are
        // read-only; playsInline keeps mobile Safari from going full-screen.
        controls={isTutor}
        allowDownload={isTutor}
        playsInline
        preload="auto"
        className="max-w-full max-h-full"
      />

      {playbackError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 px-8 text-center">
          <AlertTriangle className="size-9 text-amber-500 opacity-90" />
          {playbackError === "format" ? (
            <>
              <p className="text-sm text-zinc-200 font-medium">
                This browser can&apos;t play this video
              </p>
              <p className="text-xs text-zinc-500 max-w-xs">
                The file is in a format Safari doesn&apos;t support. Opening the class in Chrome,
                Edge or Firefox will play it — and please tell your tutor, so they can re-upload it
                as MP4, which works everywhere.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-200 font-medium">The video couldn&apos;t load</p>
              <p className="text-xs text-zinc-500 max-w-xs">
                This is usually the connection. The rest of the class carries on — you have not been
                disconnected.
              </p>
            </>
          )}
        </div>
      )}

      {!isTutor && needsUnblock && !playbackError && (
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
