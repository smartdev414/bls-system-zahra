"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, PlayCircle, Volume2, VolumeX } from "lucide-react"
import { parseVideoLink, videoLinkUrl } from "@/lib/video-link"
import { createEmbedPlayer, type EmbedPlayer } from "@/lib/embed-player"

/**
 * The classroom's shared video when the tutor gave a YouTube or Vimeo link
 * instead of a file. Same props and same sync protocol as VideoPlayer: the
 * tutor's player broadcasts play/pause/seek, students mirror the target.
 *
 * Differences from a `<video>`, all forced by the embedded players:
 *
 *   - Students start muted. Browsers let a muted video start by itself; one
 *     with sound waits for a tap on *that* frame, which a follower cannot be
 *     relied on to give. A sound button sits in the corner instead.
 *   - Students cannot touch the player (a clear layer covers it), so they
 *     cannot pause or skip away from the class.
 *   - The drift threshold is wider: a seek in an embedded player rebuffers, so
 *     correcting every half second of jitter would stutter.
 */

interface Props {
  isTutor: boolean
  url: string
  playing: boolean
  currentTime: number
  asOf: number
  onPlayPause: (playing: boolean, currentTime: number) => void
  onSeek: (currentTime: number) => void
  onContentElement?: (el: HTMLElement | null) => void
}

const STUDENT_DRIFT_THRESHOLD_S = 1.0
const STUDENT_DRIFT_POLL_MS = 2000

/** Remounted per video, so nothing from the last one carries over. */
export function LinkedVideoPlayer(props: Props) {
  return <LinkedVideo key={`${props.url}|${props.isTutor}`} {...props} />
}

function LinkedVideo({
  isTutor, url, playing, currentTime, asOf, onPlayPause, onSeek, onContentElement,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<EmbedPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<"unavailable" | "blocked" | null>(null)
  const [needsUnblock, setNeedsUnblock] = useState(false)
  const [muted, setMuted] = useState(!isTutor)

  const cb = useRef({ onPlayPause, onSeek })
  useEffect(() => { cb.current = { onPlayPause, onSeek } })

  const link = parseVideoLink(url)
  const key = link ? videoLinkUrl(link) : null

  // ── Make the player, once per video ─────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    const parsed = parseVideoLink(key)
    if (!host || !parsed) return
    let cancelled = false
    createEmbedPlayer(
      host,
      parsed,
      { controls: isTutor, muted: !isTutor },
      isTutor
        ? {
            onPlay: (t) => cb.current.onPlayPause(true, t),
            onPause: (t) => cb.current.onPlayPause(false, t),
            onSeek: (t) => cb.current.onSeek(t),
            onError: (r) => { if (!cancelled) setError(r) },
          }
        : { onError: (r) => { if (!cancelled) setError(r) } },
    ).then(
      (p) => {
        if (cancelled) { p.destroy(); return }
        playerRef.current = p
        ;(window as unknown as { __lv: unknown }).__lv = p // TEMP-TEST
        setReady(true)
      },
      () => { if (!cancelled) setError("unavailable") },
    )
    return () => {
      cancelled = true
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [key, isTutor])

  // ── Students: follow the tutor ──────────────────────────────────────────────
  useEffect(() => {
    if (isTutor || !ready) return
    const player = playerRef.current
    if (!player) return
    let cancelled = false

    const apply = async () => {
      if (cancelled) return
      const target = playing ? currentTime + Math.max(0, (Date.now() - asOf) / 1000) : currentTime
      if (Math.abs(player.time() - target) > STUDENT_DRIFT_THRESHOLD_S) player.seek(target)
      if (playing && !player.playing()) {
        const ok = await player.play()
        if (!cancelled) setNeedsUnblock(!ok)
      } else if (!playing && player.playing()) {
        player.pause()
      }
    }

    void apply()
    const interval = setInterval(() => void apply(), STUDENT_DRIFT_POLL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isTutor, ready, playing, currentTime, asOf])

  useEffect(() => {
    onContentElement?.(frameRef.current)
    return () => onContentElement?.(null)
  }, [onContentElement])

  const handleUnblock = async () => {
    const ok = await playerRef.current?.play()
    if (ok) setNeedsUnblock(false)
  }

  const toggleSound = () => {
    const next = !muted
    playerRef.current?.setMuted(next)
    setMuted(next)
  }

  return (
    // A size container, so the 16:9 frame can fit inside whatever shape the stage is.
    <div className="w-full h-full flex items-center justify-center bg-black relative" style={{ containerType: "size" }}>
      <div
        ref={frameRef}
        className="relative"
        style={{ width: "min(100cqw, calc(100cqh * 16 / 9))", aspectRatio: "16 / 9" }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        {/* Students follow the tutor; they don't get to pause or skip. */}
        {!isTutor && <div className="absolute inset-0" aria-hidden />}
      </div>

      {(error || !link) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 px-8 text-center">
          <AlertTriangle className="size-9 text-amber-500 opacity-90" />
          <p className="text-sm text-zinc-200 font-medium">
            {error === "blocked"
              ? "This video's owner doesn't allow it to be played on other websites"
              : "This video can't be played"}
          </p>
          <p className="text-xs text-zinc-500 max-w-xs">
            {isTutor
              ? "Check the link opens on its own, and that the video is public or unlisted, not private."
              : "The rest of the class carries on — you have not been disconnected."}
          </p>
        </div>
      )}

      {!isTutor && ready && !error && (
        <button
          type="button"
          onClick={toggleSound}
          className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/70 hover:bg-black/85 px-3 py-1.5 text-xs font-medium text-white"
          aria-label={muted ? "Turn the sound on" : "Turn the sound off"}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          {muted ? "Sound off" : "Sound on"}
        </button>
      )}

      {!isTutor && needsUnblock && !error && (
        <button
          onClick={handleUnblock}
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm text-white"
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
