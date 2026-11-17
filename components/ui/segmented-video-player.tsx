"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"

// SegmentedVideoPlayer
// ────────────────────
// A drop-in replacement for `<video src={url} />` when a recording is split
// into several MP4 files (e.g. from pause/resume cycles in a live class).
//
// • Drives a single <video> element through an ordered list of source URLs.
// • Auto-advances on `ended`: swaps `src`, calls `load()`, then `play()`.
// • Pre-warms the next segment's URL during the last 4 seconds of the current
//   one so the swap completes with minimal perceptible gap. We use a HEAD
//   request rather than full fetch so the browser populates the connection
//   cache (S3 region, TLS handshake) without paying for the bytes twice.
// • Surfaces a small "Part X of N" pill so users understand what they're
//   watching when there are multiple segments. Hidden when there's only one.
// • A row of "Part N" buttons under the video jumps straight to any part.
//
// Why no MediaSource Extensions / single buffer? MP4 segments produced by
// independent egress jobs each carry their own moov atoms and timestamp
// origins. Stitching them into one MSE buffer requires re-muxing — which we
// punt to ffmpeg if/when we ever want a single downloadable file. Chained
// playback with `<video>.src` swapping is the simplest reliable approach
// that runs entirely in the browser on Vercel.

interface Props {
  segments: string[]
  className?: string
  style?: React.CSSProperties
  poster?: string
  autoPlay?: boolean
  // Forwarded to the underlying <video> so callers can keep their controlsList
  // policies (no download, no playback rate, etc.).
  controlsList?: string
}

export function SegmentedVideoPlayer({
  segments,
  className,
  style,
  poster,
  autoPlay = false,
  controlsList = "nodownload noplaybackrate",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [index, setIndex] = useState(0)
  const prefetchedRef = useRef<Set<number>>(new Set())
  // Set when the viewer picks a part, so it starts playing as it loads.
  const playOnSwapRef = useRef(false)

  // Reset to segment 0 when the parent passes a different list (e.g. another
  // session's recording is opened in the same dialog). Using the "store
  // derived state in state" pattern instead of an effect avoids an extra
  // render and the set-state-in-effect anti-pattern flagged by React's lint.
  const [trackedSegments, setTrackedSegments] = useState(segments)
  if (segments !== trackedSegments) {
    setTrackedSegments(segments)
    setIndex(0)
  }
  // Ref writes must happen in an effect, not during render.
  useEffect(() => {
    prefetchedRef.current = new Set()
  }, [trackedSegments])

  const total = segments.length
  const currentSrc = segments[index]
  const hasMultiple = total > 1

  // Auto-advance when a segment finishes — but only if there's another one
  // queued. The browser fires `ended` once per playback, so this is safe.
  const handleEnded = useCallback(() => {
    setIndex((i) => (i + 1 < total ? i + 1 : i))
  }, [total])

  // When the active segment changes, swap src + play (if we were autoplaying
  // or had been playing before the swap). We can't rely on the natural <video
  // src> re-mount because React keeps the element identity stable.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    // Pause to release the old media before swapping; some browsers stall if
    // src changes while playback is mid-flight.
    const wasPlaying = !v.paused && !v.ended
    v.pause()
    v.src = currentSrc
    v.load()
    const picked = playOnSwapRef.current
    playOnSwapRef.current = false
    if (autoPlay || index > 0 || wasPlaying || picked) {
      // Index>0 means we just advanced from a prior segment — keep playing.
      v.play().catch(() => {
        // Autoplay can be blocked on first segment; user gesture resumes it.
      })
    }
  }, [currentSrc, autoPlay, index])

  // Prefetch the next segment's URL via a HEAD request as we approach the end
  // of the current one. This warms the S3 / CloudFront connection so the
  // hand-off feels seamless.
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const next = index + 1
    if (next >= total) return
    if (prefetchedRef.current.has(next)) return
    const remaining = (v.duration || 0) - v.currentTime
    if (!Number.isFinite(remaining)) return
    if (remaining > 0 && remaining < 4) {
      prefetchedRef.current.add(next)
      // Fire-and-forget. HEAD avoids downloading the segment twice while
      // still completing the TLS/DNS handshake to S3.
      fetch(segments[next], { method: "HEAD", cache: "no-store" }).catch(() => {
        // Network errors here are non-fatal — playback continues normally
        // when the segment is actually requested.
      })
    }
  }, [index, segments, total])

  const pickPart = (i: number) => {
    playOnSwapRef.current = true
    if (i === index) {
      const v = videoRef.current
      if (v) { v.currentTime = 0; v.play().catch(() => {}) }
    } else setIndex(i)
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative w-full">
        <video
          ref={videoRef}
          controls
          controlsList={controlsList}
          disablePictureInPicture
          poster={poster}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
          onContextMenu={(e) => e.preventDefault()}
          className={className}
          style={style}
        />

        {hasMultiple && (
          <div className="absolute top-2 right-2 pointer-events-none rounded-full bg-black/65 backdrop-blur-sm text-white text-[0.6875rem] font-semibold px-2.5 py-1 shadow">
            Part {index + 1} of {total}
          </div>
        )}
      </div>

      {hasMultiple && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Recording parts">
          {segments.map((segment, i) => (
            <Button
              key={segment}
              type="button"
              size="sm"
              variant={i === index ? "default" : "outline"}
              aria-current={i === index ? "true" : undefined}
              onClick={() => pickPart(i)}
            >
              <Play className="size-3.5 mr-1.5" /> Part {i + 1}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
