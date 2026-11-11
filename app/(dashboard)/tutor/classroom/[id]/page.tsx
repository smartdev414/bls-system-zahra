"use client"

import { use, useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2, AlertCircle, Camera, Mic, MicOff, Video, VideoOff, Sparkles,
  Radio, ChevronLeft, Clock,
} from "lucide-react"
import Link from "next/link"
import { LiveKitRoom } from "@livekit/components-react"
import {
  connectOptionsFor, readNetworkMode, roomOptionsFor, type NetworkMode,
} from "@/lib/network-mode"
import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client"
import "@livekit/components-styles"
import { ClassroomRoom } from "@/components/classroom/ClassroomRoom"
import { BLUR_PREF_KEY } from "@/components/classroom/blurPreference"
import { readDevicePreference, writeDevicePreference, mediaFailureMessage } from "@/components/classroom/devicePreference"
import { localCameraClassName } from "@/components/classroom/localCameraView"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useFetch, usePostCallback, usePatchCallback } from "@/hooks/use-fetch"
import {
  getNetworkSnapshot, isLinkFailure, probeNetworkNow, subscribeNetworkRecovery,
} from "@/lib/network-health"
import { cn } from "@/lib/utils"
import { FaceToFaceClassScreen } from "@/components/sessions/face-to-face"
import { SESSION_STATUS_EVENT } from "@/components/layout/session-status-listener"
import { toast } from "sonner"
import { WeekBadge } from "@/components/sessions/class-week"

// ─── Types ────────────────────────────────────────────────────────────────────

type TokenData = { token: string; wsUrl: string; roomName: string }

type SessionInfo = {
  session: {
    id: string
    title: string
    status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
    tutorId: string
    tutor: { name: string }
    description?: string | null
    durationMins?: number
    week?: number | null
    scheduledAt: string
    inPerson: boolean
    venue: string | null
  }
  // Present for tutors; true when the viewer is the owning tutor (not a co-tutor).
  isOwner?: boolean
}

// ─── Camera preview hook — mirrors the student lobby so the tutor sees the
// real background-blur effect before going live. Uses livekit-client's
// LocalVideoTrack + @livekit/track-processors so the preview matches the
// published track exactly. ────────────────────────────────────────────────────

function useCameraPreview(enabled: boolean, blurEnabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<LocalVideoTrack | null>(null)
  const [trackVersion, setTrackVersion] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let track: LocalVideoTrack | null = null

    createLocalVideoTrack()
      .then((t) => {
        if (cancelled) { try { t.stop() } catch { /* ignore */ } ; return }
        track = t
        trackRef.current = t
        if (videoRef.current) t.attach(videoRef.current)
        setTrackVersion((v) => v + 1)
      })
      .catch(() => { /* permission denied — silently degrade */ })

    return () => {
      cancelled = true
      if (track) {
        try { track.detach() } catch { /* ignore */ }
        try { track.stop() } catch { /* ignore */ }
      }
      if (trackRef.current === track) trackRef.current = null
    }
  }, [enabled])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let cancelled = false

    if (blurEnabled) {
      import("@livekit/track-processors").then(async (mod) => {
        if (cancelled || trackRef.current !== track) return
        if (!mod.supportsBackgroundProcessors()) return
        const proc = mod.BackgroundProcessor({ mode: "background-blur", blurRadius: 12 })
        if (cancelled || trackRef.current !== track) return
        try { await track.setProcessor(proc) } catch { /* ignore */ }
      }).catch(() => { /* ignore */ })
    } else {
      track.stopProcessor().catch(() => { /* nothing to stop yet */ })
    }

    return () => { cancelled = true }
  }, [blurEnabled, trackVersion])

  return videoRef
}

// ─── Device toggle (shared shape with the student lobby) ─────────────────────

function DeviceToggle({
  enabled,
  onToggle,
  iconOn,
  iconOff,
  label,
}: {
  enabled: boolean
  onToggle: () => void
  iconOn: React.ReactNode
  iconOff: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl p-3 w-20 transition-all border",
        enabled
          ? "border-white/30 bg-white/15 text-white hover:bg-white/20"
          : "border-white/10 bg-black/40 text-white/40 hover:bg-white/10",
      )}
    >
      <span className="size-5">{enabled ? iconOn : iconOff}</span>
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  )
}

// ─── Tutor entry / lobby screen ──────────────────────────────────────────────

function TutorEntryScreen({
  session,
  onStart,
  starting,
}: {
  session: NonNullable<SessionInfo["session"]>
  onStart: () => void
  starting: boolean
}) {
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [audioEnabled, setAudioEnabled] = useState(false)
  // The room reads these when it connects — see devicePreference.
  useEffect(() => { writeDevicePreference("camera", videoEnabled) }, [videoEnabled])
  useEffect(() => { writeDevicePreference("mic", audioEnabled) }, [audioEnabled])
  const [blurEnabled, setBlurEnabled] = useState(() => {
    if (typeof window === "undefined") return false
    try { return window.localStorage.getItem(BLUR_PREF_KEY) === "1" } catch { return false }
  })
  useEffect(() => {
    try { window.localStorage.setItem(BLUR_PREF_KEY, blurEnabled ? "1" : "0") } catch { /* ignore */ }
  }, [blurEnabled])

  const cameraRef = useCameraPreview(videoEnabled, blurEnabled)

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-5 gap-0 rounded-2xl overflow-hidden shadow-2xl border border-border">

        {/* Camera preview — right on desktop, mirrored for natural self-view */}
        <div className="md:col-span-3 md:order-2 order-1 relative bg-zinc-900 aspect-video md:aspect-auto md:min-h-[320px] flex items-center justify-center">
          <video
            ref={cameraRef}
            muted
            playsInline
            className={cn(
              localCameraClassName(true, "absolute inset-0 w-full h-full object-cover transition-opacity duration-300"),
              videoEnabled ? "opacity-100" : "opacity-0",
            )}
          />

          {!videoEnabled && (
            <div className="z-10 flex flex-col items-center gap-3">
              <div className="size-20 rounded-full bg-primary/20 flex items-center justify-center">
                <Camera className="size-9 text-primary/60" />
              </div>
              <p className="text-white/40 text-sm">Camera is off</p>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

          <div className="absolute bottom-5 left-0 right-0 flex items-center justify-center gap-3 z-10">
            <DeviceToggle
              enabled={audioEnabled}
              onToggle={() => setAudioEnabled((v) => !v)}
              iconOn={<Mic className="size-5" />}
              iconOff={<MicOff className="size-5" />}
              label={audioEnabled ? "Mic On" : "Mic Off"}
            />
            <DeviceToggle
              enabled={videoEnabled}
              onToggle={() => setVideoEnabled((v) => !v)}
              iconOn={<Video className="size-5" />}
              iconOff={<VideoOff className="size-5" />}
              label={videoEnabled ? "Cam On" : "Cam Off"}
            />
            <DeviceToggle
              enabled={blurEnabled}
              onToggle={() => setBlurEnabled((v) => !v)}
              iconOn={<Sparkles className="size-5" />}
              iconOff={<Sparkles className="size-5" />}
              label={blurEnabled ? "Blur On" : "Blur Off"}
            />
          </div>
        </div>

        {/* Session info + start — left on desktop */}
        <div className="md:col-span-2 md:order-1 order-2 bg-card flex flex-col p-7 gap-5">
          <div>
            <Badge
              variant="outline"
              className="text-[10px] mb-3 gap-1 border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-950"
            >
              <Radio className="size-3" /> Tutor lobby
            </Badge>
            <h1 className="text-xl font-black leading-tight">{session.title}</h1>
            {session.week ? (
              <p className="mt-1"><WeekBadge week={session.week} className="text-xs" /> <span className="text-xs text-muted-foreground">— use the Week {session.week} slides</span></p>
            ) : null}
            {session.description && (
              <p className="text-sm text-muted-foreground mt-1.5 line-clamp-3">{session.description}</p>
            )}
          </div>

          {session.durationMins != null && (
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-3 py-2">
                <Clock className="size-3.5 shrink-0 text-primary" />
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground">Duration</p>
                  <p className="font-semibold text-foreground">{session.durationMins} min</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5">
            <div className="flex gap-1">
              <span className={cn("size-2 rounded-full mt-0.5 shrink-0", audioEnabled ? "bg-emerald-500" : "bg-zinc-400")} />
              <span className={cn("text-xs", audioEnabled ? "text-foreground" : "text-muted-foreground")}>
                Mic {audioEnabled ? "on" : "off"}
              </span>
            </div>
            <span className="text-muted-foreground/50">·</span>
            <div className="flex gap-1">
              <span className={cn("size-2 rounded-full mt-0.5 shrink-0", videoEnabled ? "bg-emerald-500" : "bg-zinc-400")} />
              <span className={cn("text-xs", videoEnabled ? "text-foreground" : "text-muted-foreground")}>
                Camera {videoEnabled ? "on" : "off"}
              </span>
            </div>
            <span className="text-muted-foreground/50">·</span>
            <div className="flex gap-1">
              <span className={cn("size-2 rounded-full mt-0.5 shrink-0", blurEnabled ? "bg-emerald-500" : "bg-zinc-400")} />
              <span className={cn("text-xs", blurEnabled ? "text-foreground" : "text-muted-foreground")}>
                Blur {blurEnabled ? "on" : "off"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-auto">
            <Button
              onClick={onStart}
              disabled={starting}
              size="lg"
              className="w-full font-semibold gap-2"
            >
              {/* A class that is already running is re-entered, not started —
                  "Start Session" there read as if the lesson would begin again. */}
              {starting ? (
                <><Loader2 className="size-4 animate-spin" /> {session.status === "LIVE" ? "Rejoining…" : "Starting…"}</>
              ) : (
                <><Radio className="size-4" /> {session.status === "LIVE" ? "Rejoin Session" : "Start Session"}</>
              )}
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/tutor/sessions">
                <ChevronLeft className="size-4 mr-1" /> Back to Sessions
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// "Refresh all" (and the tutor's own refresh) sets this flag right before
// reloading. On the way back the page reads it once and reconnects without
// waiting for a click: the tutor answers every student's sync request, so a
// tutor parked on the lobby screen means a room full of blank stages.
const AUTO_REJOIN_KEY = (id: string) => `classroom:auto-rejoin:${id}`
const AUTO_REJOIN_MAX_AGE_MS = 30_000

/** How many times a dropped host re-joins their own class when the link returns. */
const AUTO_RECOVER_LIMIT = 3

/** No usable path to us at all — see the identical helper on the student page. */
function linkIsDown(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true
  const status = getNetworkSnapshot().status
  return status === "offline" || status === "captive-portal"
}

export default function TutorClassroomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  // Read once per connection, not on every render: the in-room buttons write
  // the same keys, and changing `video` / `audio` props would fight them.
  const joinDevices = useMemo(
    () => ({
      video: tokenData ? readDevicePreference("camera", true) : true,
      audio: tokenData ? readDevicePreference("mic", false) : false,
    }),
    [tokenData],
  )
  const [ended, setEnded] = useState(false)

  // Tutors hit restricted networks too — a co-teacher joining from a hospital
  // training room, or a tutor working from a school. The stored per-device mode
  // applies here as well. Automatic escalation is deliberately student-only:
  // switching a host's ICE policy mid-lesson would rebuild the room under
  // everyone watching them, and a tutor who needs another mode sets it once via
  // /tutor/connection-check. Losing the *link* is different, and is recovered
  // from — see handleDisconnected.
  const [netMode, setNetMode] = useState<NetworkMode>("standard")
  useEffect(() => { setNetMode(readNetworkMode()) }, [])
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [leavingBusy, setLeavingBusy] = useState(false)
  const [autoRejoin, setAutoRejoin] = useState(false)
  // Set when the tutor's own link drops mid-lesson. See handleDisconnected.
  const [waitingForNetwork, setWaitingForNetwork] = useState(false)
  const autoRecoveriesRef = useRef(0)
  // Distinguishes "the tutor chose to go" from "the network took them".
  const leavingDeliberatelyRef = useRef(false)

  const { data, loading: infoLoading, error: infoError, refetch: refetchInfo } = useFetch<SessionInfo>(
    `/api/sessions/${id}/info`,
    { errorMessage: false }
  )

  const { execute: getToken, loading: tokenLoading, error: tokenError } =
    usePostCallback<TokenData, Record<string, never>>(`/api/sessions/${id}/token`, {
      successMessage: false,
      errorMessage: false,
      onSuccess: (d) => setTokenData(d),
    })

  const { execute: patchStatus } = usePatchCallback<unknown, { status: string }>(
    `/api/tutor/sessions/${id}`,
    { successMessage: false, errorMessage: false }
  )

  const isOwner = data?.isOwner !== false

  // Read the one-shot flag on mount. An effect (not lazy state) because
  // sessionStorage is client-only and would break hydration.
  useEffect(() => {
    if (typeof window === "undefined") return
    const key = AUTO_REJOIN_KEY(id)
    const raw = sessionStorage.getItem(key)
    if (!raw) return
    sessionStorage.removeItem(key)
    const ts = parseInt(raw, 10)
    if (Number.isFinite(ts) && Date.now() - ts < AUTO_REJOIN_MAX_AGE_MS) setAutoRejoin(true)
  }, [id])

  // Reconnect as soon as session info lands. The session is already LIVE at
  // this point (it was mid-lesson), so this only needs a token.
  useEffect(() => {
    if (!autoRejoin || !data?.session || tokenData || tokenLoading) return
    getToken({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRejoin, data, tokenData, tokenLoading])

  // When the host ends the session, disconnect co-teachers still in the room.
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string; status: string }>).detail
      if (detail?.sessionId !== id) return
      if (detail.status === "COMPLETED" || detail.status === "CANCELLED") {
        setEnded(true)
        toast.info("This session has ended")
        router.replace("/tutor/sessions")
      }
    }
    window.addEventListener(SESSION_STATUS_EVENT, onStatus)
    return () => window.removeEventListener(SESSION_STATUS_EVENT, onStatus)
  }, [id, router])

  // Tutor explicitly clicks "Start Session" from the lobby. Patches status if
  // still SCHEDULED then fetches a connect token. The actual room mount is
  // gated on tokenData below.
  const handleStart = useCallback(async () => {
    if (!data?.session) return
    // Only the owning tutor flips the session live; a co-tutor just connects
    // (the owner will have already started it, or will shortly).
    if (data.session.status === "SCHEDULED" && isOwner) {
      await patchStatus({ status: "LIVE" })
    }
    getToken({})
  }, [data, getToken, patchStatus, isOwner])

  /**
   * The room dropped without the tutor asking it to.
   *
   * Navigating away is right when the session genuinely ended. It is badly
   * wrong when a café or hotel link went out for forty seconds: the class is
   * still running, every student is still in it, and the host has just been
   * ejected to a session page with no way back except starting again. So when
   * the link is what failed, hold the page and re-join as soon as it returns.
   */
  const handleDisconnected = () => {
    if (
      !leavingDeliberatelyRef.current &&
      linkIsDown() &&
      autoRecoveriesRef.current < AUTO_RECOVER_LIMIT
    ) {
      autoRecoveriesRef.current += 1
      setTokenData(null)
      setWaitingForNetwork(true)
      return
    }
    setEnded(true)
    router.replace(`/tutor/sessions/${id}`)
  }

  // The error screen below promises "we'll keep trying" for a link failure, so
  // keep that promise: reload the session info as soon as the link is back.
  // Without this one dropped request on page load stranded the tutor on it.
  const infoLinkFailed = !!infoError?.kind && isLinkFailure(infoError.kind)
  useEffect(() => {
    if (!infoLinkFailed) return
    const unsubscribe = subscribeNetworkRecovery(() => { void refetchInfo() })
    // A one-off drop may already have been cleared by the health probe, in
    // which case no recovery event is coming — just try again shortly.
    const timer = getNetworkSnapshot().status === "online"
      ? setTimeout(() => { void refetchInfo() }, 2_000)
      : null
    return () => { unsubscribe(); if (timer) clearTimeout(timer) }
  }, [infoLinkFailed, refetchInfo])

  // Back into the room by ourselves once the link is provably back.
  useEffect(() => {
    if (!waitingForNetwork) return
    return subscribeNetworkRecovery(() => {
      setWaitingForNetwork(false)
      getToken({})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForNetwork])

  const handleLeaveForNow = () => {
    leavingDeliberatelyRef.current = true
    setLeaveDialogOpen(false)
    setEnded(true)
    router.replace(`/tutor/sessions/${id}`)
  }

  const handleFinishSession = async () => {
    if (leavingBusy) return
    leavingDeliberatelyRef.current = true
    setLeavingBusy(true)
    try {
      await patchStatus({ status: "COMPLETED" })
    } catch {
      // Still navigate even if the patch fails
    } finally {
      setLeaveDialogOpen(false)
      setEnded(true)
      setLeavingBusy(false)
      router.replace(`/tutor/sessions/${id}`)
    }
  }

  // ── Loading / error states ──────────────────────────────────────────────────

  // Comes first: during an outage the token request fails too, and the generic
  // "something went wrong" screen would bury the one thing that is true and
  // useful — the class is still running and we are getting them back into it.
  if (waitingForNetwork) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 max-w-md mx-auto text-center px-4">
        <div className="size-20 rounded-full bg-amber-500/15 flex items-center justify-center">
          <Loader2 className="size-9 animate-spin text-amber-600" />
        </div>
        <div>
          <h2 className="text-xl font-black">Your connection dropped</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Your class is still running and your students are still in it. We&apos;ve kept this page
            open and will put you back in the room the moment your internet returns.
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Please don&apos;t close this tab. On public Wi-Fi, check whether a sign-in page is
            waiting in another tab.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button onClick={() => { probeNetworkNow(); setWaitingForNetwork(false); getToken({}) }}>
            Try now
          </Button>
          <Button variant="outline" onClick={() => { leavingDeliberatelyRef.current = true; setEnded(true); router.replace(`/tutor/sessions/${id}`) }}>
            Leave the class
          </Button>
        </div>
      </div>
    )
  }

  if (infoLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Setting up your classroom…</p>
      </div>
    )
  }

  if (infoError || tokenError) {
    const msg = infoError?.message ?? tokenError?.message ?? "Something went wrong"
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 max-w-sm mx-auto text-center">
        <div className="rounded-full bg-destructive/10 p-4">
          <AlertCircle className="size-8 text-destructive" />
        </div>
        <div>
          <h2 className="font-bold text-lg">Could not open classroom</h2>
          <p className="text-muted-foreground text-sm mt-1">{msg}</p>
        </div>
        <Button onClick={() => { if (infoError) void refetchInfo(); else getToken({}) }}>
          Try again
        </Button>
      </div>
    )
  }

  if (ended) return null

  // Lobby — shown until the tutor explicitly starts the session.
  if (!tokenData) {
    if (!data?.session) return null
    if (data.session.inPerson) {
      return (
        <FaceToFaceClassScreen
          title={data.session.title}
          scheduledAt={data.session.scheduledAt}
          durationMins={data.session.durationMins ?? 60}
          venue={data.session.venue}
          backHref="/tutor/sessions"
        />
      )
    }
    if (autoRejoin) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Reconnecting to the classroom…</p>
        </div>
      )
    }
    return (
      <TutorEntryScreen
        session={data.session}
        onStart={handleStart}
        starting={tokenLoading}
      />
    )
  }

  return (
    <LiveKitRoom
      key={`${tokenData.token}:${netMode}`}
      token={tokenData.token}
      serverUrl={tokenData.wsUrl}
      connect={true}
      video={joinDevices.video}
      audio={joinDevices.audio}
      options={roomOptionsFor(netMode)}
      connectOptions={connectOptionsFor(netMode)}
      onDisconnected={handleDisconnected}
      // A camera or mic that fails to start on join used to leave a black
      // self-view and nothing else. Say why, so it can be fixed in the room.
      onMediaDeviceFailure={(failure, kind) =>
        toast.error(mediaFailureMessage(failure, kind === "audioinput" ? "mic" : "camera"))
      }
    >
      <ClassroomRoom
        isTutor={true}
        isOwner={isOwner}
        sessionId={id}
        sessionTitle={data?.session?.title ?? "Live Session"}
        onLeave={() => setLeaveDialogOpen(true)}
      />
      <Dialog open={leaveDialogOpen} onOpenChange={(open) => !leavingBusy && setLeaveDialogOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isOwner ? "Leave live session?" : "Leave classroom?"}</DialogTitle>
            <DialogDescription>
              {isOwner
                ? "You can leave temporarily and come back later, or finish this session for everyone."
                : "You'll leave the classroom. The host manages when this session ends."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLeaveDialogOpen(false)}
              disabled={leavingBusy}
            >
              Cancel
            </Button>
            {isOwner ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleLeaveForNow}
                  disabled={leavingBusy}
                >
                  Leave for now
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleFinishSession}
                  disabled={leavingBusy}
                >
                  {leavingBusy ? "Finishing..." : "Finish session"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={handleLeaveForNow}
                disabled={leavingBusy}
              >
                Leave classroom
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LiveKitRoom>
  )
}
