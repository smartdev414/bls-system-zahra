"use client"

/**
 * What the classroom says when the link goes bad mid-lesson.
 *
 * A frozen picture is the single most confusing thing that happens on café
 * Wi-Fi, because it is indistinguishable from a tutor who has stopped moving.
 * LiveKit handles the reconnection itself and handles it well — but silently.
 * Between the drop and the recovery the room stays mounted, the last video
 * frame stays on screen, and the student has no way to tell whether they have
 * lost the lesson, lost the network, or whether the tutor is simply pausing. In
 * a spoken-language class they would hear the silence. In a BSL class the
 * frozen hand *is* the content, so the ambiguity is total.
 *
 * Only a lost connection is worth interrupting for:
 *
 *   - **Reconnecting.** Say so, count the seconds, and say plainly that
 *     reloading is the wrong move — a reload discards the chat, the raised
 *     hand and the breakout membership that the reconnect would have restored.
 *
 * Sustained poor quality gets no banner (it covered the stage for minutes at a
 * time). We still act on it quietly: cap what we publish so the student's own
 * upstream stops fighting for room it hasn't got.
 *
 * Nothing is shown for a momentary dip. Public Wi-Fi produces those constantly
 * and a banner that flickers is a banner people learn to ignore.
 */

import { useEffect, useRef, useState } from "react"
import { useConnectionState, useLocalParticipant } from "@livekit/components-react"
import { ConnectionQuality, ConnectionState, ParticipantEvent, Track, VideoQuality } from "livekit-client"
import { Loader2, WifiOff } from "lucide-react"
import { toast } from "sonner"

/**
 * How long the connection must stay poor before we react. Long enough to ride
 * out a lift, a microwave or someone starting a download on the same café line;
 * short enough that a genuinely bad link is handled inside one exchange between
 * tutor and student.
 */
const POOR_GRACE_MS = 12_000

export function ConnectionBanner() {
  const state = useConnectionState()
  const { localParticipant } = useLocalParticipant()

  const reconnecting =
    state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting

  // ── Sustained poor quality ──────────────────────────────────────────────────
  // Handled silently: no banner (it covered the stage and read as an error the
  // student couldn't act on) — we just ease off our own upstream.
  // One downshift per visit. Stepping quality back up the moment the line looks
  // better is how you get a lesson that oscillates between soft and frozen; the
  // student can rejoin if they move somewhere better.
  const downshiftedRef = useRef(false)

  useEffect(() => {
    if (!localParticipant) return

    let poorSince: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const clear = () => { if (timer) { clearTimeout(timer); timer = null } }

    const onQuality = (quality: ConnectionQuality) => {
      const bad = quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost

      if (!bad) {
        poorSince = null
        clear()
        return
      }

      if (poorSince !== null) return
      poorSince = Date.now()
      timer = setTimeout(downshift, POOR_GRACE_MS)
    }

    /**
     * Cap our own outgoing video at the lowest simulcast layer. The receive
     * side is already handled — `adaptiveStream` and `dynacast` only pull the
     * resolution each tile is actually showing — so the remaining pressure is
     * upstream, which is exactly where a café's shared line is thinnest.
     *
     * `setPublishingQuality` caps the layer without touching the camera, so the
     * picture softens rather than dropping out for the second or two a capture
     * restart would cost mid-sentence.
     */
    const downshift = () => {
      if (downshiftedRef.current) return
      downshiftedRef.current = true
      try {
        let capped = false
        for (const pub of localParticipant.videoTrackPublications.values()) {
          if (pub.source !== Track.Source.Camera) continue
          const track = pub.videoTrack
          if (!track) continue
          track.setPublishingQuality(VideoQuality.LOW)
          capped = true
        }
        if (capped) {
          toast.info("Your connection is struggling — we've reduced your video quality to keep you in class.", {
            duration: 8000,
          })
        }
      } catch (err) {
        // Never let a quality tweak take the classroom down with it.
        console.warn("[classroom] could not reduce publish quality", err)
      }
    }

    localParticipant.on(ParticipantEvent.ConnectionQualityChanged, onQuality)
    onQuality(localParticipant.connectionQuality)

    return () => {
      clear()
      localParticipant.off(ParticipantEvent.ConnectionQualityChanged, onQuality)
    }
  }, [localParticipant])

  if (reconnecting) {
    return (
      <Banner tone="warn" icon={<Loader2 className="size-4 animate-spin" />}>
        <strong>Reconnecting…</strong>{" "}
        <ElapsedSeconds />
        You&apos;re still in the class. Please don&apos;t reload — your chat, raised hand and group are kept.
      </Banner>
    )
  }

  if (state === ConnectionState.Disconnected) {
    return (
      <Banner tone="bad" icon={<WifiOff className="size-4" />}>
        <strong>Disconnected.</strong> Trying to get you back into the class.
      </Banner>
    )
  }

  return null
}

/**
 * Counts up for as long as it is mounted, which is exactly the length of the
 * reconnect. Its own component so the count resets by unmounting rather than by
 * a state write the moment the connection returns.
 *
 * The number is there because "Reconnecting…" alone gives no sense of whether
 * to wait or to give up. Watching it climb past thirty is what tells a student
 * to try their phone's hotspot.
 */
function ElapsedSeconds() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const id = setInterval(() => setSecs(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  if (secs < 1) return null
  return <span className="tabular-nums opacity-80">{secs}s · </span>
}

function Banner({
  tone, icon, children,
}: {
  tone: "warn" | "bad"
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      // Below the 44px room header, not over it: at top-0 it covered Raise Hand
      // and the tutor's Requests / Raised Hands — on exactly the weak connection
      // where a student most needs to flag a problem.
      //
      // Click-through: it only has something to say, nothing to press, and it
      // sits over the top of the stage — where "Close", "Back to tutor" and
      // "Stop spotlight" live. On a weak link it could stay up for minutes and
      // take those buttons away exactly when a tutor was trying to use them.
      className={[
        "pointer-events-none absolute inset-x-0 top-11 z-40 flex items-center justify-center gap-2",
        "px-4 py-2 text-center text-xs sm:text-sm font-medium",
        tone === "warn" ? "bg-amber-500/95 text-amber-950" : "bg-red-600/95 text-white",
      ].join(" ")}
    >
      <span className="shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  )
}
