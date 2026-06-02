"use client"

import { use, useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2, AlertCircle, Camera, Mic, MicOff, Video, VideoOff, Sparkles,
  Radio, ChevronLeft, Clock,
} from "lucide-react"
import Link from "next/link"
import { LiveKitRoom } from "@livekit/components-react"
import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client"
import "@livekit/components-styles"
import { ClassroomRoom } from "@/components/classroom/ClassroomRoom"
import { BLUR_PREF_KEY } from "@/components/classroom/blurPreference"
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
import { cn } from "@/lib/utils"

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
  }
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
  const [audioEnabled, setAudioEnabled] = useState(true)
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
              {starting ? (
                <><Loader2 className="size-4 animate-spin" /> Starting…</>
              ) : (
                <><Radio className="size-4" /> Start Session</>
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

export default function TutorClassroomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  const [ended, setEnded] = useState(false)
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [leavingBusy, setLeavingBusy] = useState(false)

  const { data, loading: infoLoading, error: infoError } = useFetch<SessionInfo>(
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

  // Tutor explicitly clicks "Start Session" from the lobby. Patches status if
  // still SCHEDULED then fetches a connect token. The actual room mount is
  // gated on tokenData below.
  const handleStart = useCallback(async () => {
    if (!data?.session) return
    if (data.session.status === "SCHEDULED") {
      await patchStatus({ status: "LIVE" })
    }
    getToken({})
  }, [data, getToken, patchStatus])

  const handleDisconnected = () => {
    setEnded(true)
    router.replace(`/tutor/sessions/${id}`)
  }

  const handleLeaveForNow = () => {
    setLeaveDialogOpen(false)
    setEnded(true)
    router.replace(`/tutor/sessions/${id}`)
  }

  const handleFinishSession = async () => {
    if (leavingBusy) return
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
      </div>
    )
  }

  if (ended) return null

  // Lobby — shown until the tutor explicitly starts the session.
  if (!tokenData) {
    if (!data?.session) return null
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
      token={tokenData.token}
      serverUrl={tokenData.wsUrl}
      connect={true}
      video={true}
      audio={true}
      onDisconnected={handleDisconnected}
    >
      <ClassroomRoom
        isTutor={true}
        sessionId={id}
        sessionTitle={data?.session?.title ?? "Live Session"}
        onLeave={() => setLeaveDialogOpen(true)}
      />
      <Dialog open={leaveDialogOpen} onOpenChange={(open) => !leavingBusy && setLeaveDialogOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Leave live session?</DialogTitle>
            <DialogDescription>
              You can leave temporarily and come back later, or finish this session for everyone.
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LiveKitRoom>
  )
}
