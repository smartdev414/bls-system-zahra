"use client"

import { useEffect, useRef, useState, type PointerEvent } from "react"
import { Loader2, Pause, Play, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { inspectRecording, type RecordingInfo, type TrimRange } from "@/lib/video-trim"

// Shortest video a cut may leave, in seconds.
const MIN_LENGTH = 0.5
// Width of a handle in px. A range input keeps its thumb inside the track, so
// everything drawn along the bar is inset by half of this to line up with it.
const HANDLE_PX = 12

const HANDLE_INPUT = cn(
  "pointer-events-none absolute inset-0 m-0 size-full appearance-none bg-transparent disabled:opacity-50",
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none",
  "[&::-webkit-slider-thumb]:h-10 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-ew-resize",
  "[&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-primary",
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-10 [&::-moz-range-thumb]:w-3",
  "[&::-moz-range-thumb]:cursor-ew-resize [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-0",
  "[&::-moz-range-thumb]:bg-primary",
)

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds)
  const m = Math.floor(safe / 60)
  const s = (safe - m * 60).toFixed(1).padStart(4, "0")
  return `${m}:${s}`
}

type Props = {
  /** The recording, as an object URL for the preview and as the file itself. */
  url: string
  blob: Blob
  /** Shown under the preview. */
  note?: string
  /** What is happening to the recording right now, if anything; locks the controls. */
  busy: string | null
  error: string | null
  /** `null` when nothing was cut and the recording can be saved as it is. */
  onSave: (range: TrimRange | null) => void
  onDiscard: () => void
}

/**
 * What the tutor sees between stopping a recording and saving it: the take,
 * played back, with a handle at each end to cut off the walk to the chair and
 * the reach for the Stop button.
 */
export function RecordingTrimmer({ url, blob, note, busy, error, onSave, onDiscard }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // null while the recording is being read; "none" if it can't be cut (it can
  // still be watched and saved whole).
  const [info, setInfo] = useState<RecordingInfo | "none" | null>(null)
  const [cut, setCut] = useState<{ start: number; end: number } | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let cancelled = false
    inspectRecording(blob)
      .then((result) => { if (!cancelled) setInfo(result) })
      .catch((err) => {
        console.error("[recorder] could not read the recording for trimming", err)
        if (!cancelled) setInfo("none")
      })
    return () => { cancelled = true }
  }, [blob])

  const timeline = info && info !== "none" ? info : null
  const duration = timeline?.duration ?? 0
  const first = timeline?.cutPoints[0] ?? 0
  const start = cut?.start ?? first
  const end = cut?.end ?? duration
  const startCut = start > first
  const endCut = end < duration

  // Stops playback at the end handle, and keeps the playhead moving smoothly
  // (the video's own time events only come a few times a second).
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const video = videoRef.current
      if (video) {
        if (timeline && video.currentTime >= end) {
          video.pause()
          video.currentTime = end
        }
        setTime(video.currentTime)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, end, timeline])

  function seek(to: number) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = to
    setTime(to)
  }

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) return video.pause()
    if (timeline && (video.currentTime < start || video.currentTime >= end - 0.05)) seek(start)
    video.play().catch(() => {})
  }

  function moveStart(value: number) {
    if (!timeline) return
    // A video can only begin on one of these — take the nearest that still
    // leaves something to watch.
    const allowed = timeline.cutPoints.filter((point) => point <= end - MIN_LENGTH)
    const next = allowed.reduce((best, point) => (Math.abs(point - value) < Math.abs(best - value) ? point : best), first)
    videoRef.current?.pause()
    setCut({ start: next, end })
    seek(next)
  }

  function moveEnd(value: number) {
    if (!timeline) return
    const next = Math.min(duration, Math.max(value, start + MIN_LENGTH))
    videoRef.current?.pause()
    setCut({ start, end: next })
    seek(next)
  }

  function seekFromBar(e: PointerEvent<HTMLDivElement>) {
    if (!timeline || busy) return
    const box = e.currentTarget.getBoundingClientRect()
    const fraction = (e.clientX - box.left - HANDLE_PX / 2) / (box.width - HANDLE_PX)
    seek(Math.min(end, Math.max(start, fraction * duration)))
  }

  /** Where a time sits along the bar, lined up with the handles. */
  const at = (seconds: number) =>
    `calc(${HANDLE_PX / 2}px + (100% - ${HANDLE_PX}px) * ${duration ? Math.min(1, Math.max(0, seconds / duration)) : 0})`

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={videoRef}
        src={url}
        playsInline
        preload="auto"
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        className="mx-auto max-h-[70svh] w-full cursor-pointer rounded-xl bg-black"
      />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="shrink-0"
          onClick={togglePlay}
          disabled={!!busy}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>

        {timeline ? (
          <div className="relative h-10 flex-1 touch-none" onPointerDown={seekFromBar}>
            <div className="absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 rounded-md bg-muted" />
            <div
              className="absolute top-1/2 h-6 -translate-y-1/2 border-y-2 border-primary bg-primary/20"
              style={{ left: at(start), right: `calc(100% - ${at(end)})` }}
            />
            <div
              aria-hidden
              className="absolute top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
              style={{ left: at(time) }}
            />
            <input
              type="range"
              aria-label="Start of the video"
              aria-valuetext={formatTime(start - first)}
              min={0}
              max={duration}
              step={0.01}
              value={start}
              disabled={!!busy}
              onChange={(e) => moveStart(Number(e.target.value))}
              className={HANDLE_INPUT}
            />
            <input
              type="range"
              aria-label="End of the video"
              aria-valuetext={formatTime(end - first)}
              min={0}
              max={duration}
              step={0.01}
              value={end}
              disabled={!!busy}
              onChange={(e) => moveEnd(Number(e.target.value))}
              className={HANDLE_INPUT}
            />
          </div>
        ) : (
          <p className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
            {info === null && <Loader2 className="size-3 shrink-0 animate-spin" />}
            {info === null
              ? "Getting the recording ready to trim…"
              : "This recording can't be trimmed in this browser. You can still save it as it is."}
          </p>
        )}
      </div>

      {timeline && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {startCut || endCut
              ? `Keeping ${formatTime(start - first)} – ${formatTime(end - first)} · ${formatTime(end - start)} of ${formatTime(duration - first)}`
              : `Drag the handles to cut the start and end · ${formatTime(duration - first)}`}
          </span>
          {(startCut || endCut) && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => { setCut(null); seek(first) }}
              className="inline-flex items-center gap-1 font-medium hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="size-3" /> Reset
            </button>
          )}
        </div>
      )}
      {timeline && startCut && (
        <p className="text-xs text-muted-foreground">The start moves in steps of about a second; the end can go anywhere.</p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" disabled={!!busy} onClick={onDiscard}>
          Record again
        </Button>
        <Button
          type="button"
          disabled={!!busy || info === null}
          onClick={() => {
            videoRef.current?.pause()
            onSave(startCut || endCut ? { start: startCut ? start : undefined, end: endCut ? end : undefined } : null)
          }}
          className="gap-2"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ?? (startCut || endCut ? "Trim & Save" : "Save")}
        </Button>
      </div>
    </div>
  )
}
