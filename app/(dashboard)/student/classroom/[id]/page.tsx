"use client"

import { use, useState, useRef, useEffect, useMemo } from "react"
import Link from "next/link"
import {
  Video, Mic, MicOff, VideoOff, PhoneOff,
  ChevronLeft, Loader2, AlertCircle, Clock,
  Camera, CheckCircle2,
  WifiOff, Wifi, Sparkles, Send, Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { usePostCallback, useFetch } from "@/hooks/use-fetch"
import { LiveKitRoom } from "@livekit/components-react"
import { createLocalVideoTrack, DisconnectReason, type LocalVideoTrack } from "livekit-client"
import "@livekit/components-styles"
import { toast } from "sonner"
import { ClassroomRoom } from "@/components/classroom/ClassroomRoom"
import { BLUR_PREF_KEY } from "@/components/classroom/blurPreference"
import { readDevicePreference, writeDevicePreference, mediaFailureMessage } from "@/components/classroom/devicePreference"
import { localCameraClassName } from "@/components/classroom/localCameraView"
import {
  connectOptionsFor, escalateNetworkMode, readNetworkMode, roomOptionsFor, writeNetworkMode,
  NETWORK_MODE_LABELS, type NetworkMode,
} from "@/lib/network-mode"
import {
  getNetworkSnapshot, subscribeNetworkRecovery, probeNetworkNow,
} from "@/lib/network-health"
import { cn } from "@/lib/utils"
import { FaceToFaceClassScreen } from "@/components/sessions/face-to-face"

// ─── Types ────────────────────────────────────────────────────────────────────

type TokenData = { token: string; wsUrl: string; roomName: string }

type SessionInfo = {
  session: {
    id: string
    title: string
    description: string | null
    status: string
    visibility: "PUBLIC" | "INVITE_ONLY"
    inPerson: boolean
    venue: string | null
    durationMins: number
    scheduledAt: string
    tutor: { name: string }
    course: { title: string } | null
    _count?: { attendances: number }
    isInvited?: boolean
    joinRequest?: { id: string; status: "PENDING" | "APPROVED" | "REJECTED" } | null
  }
}

// ─── Camera preview hook ──────────────────────────────────────────────────────
// Uses livekit-client's LocalVideoTrack rather than raw getUserMedia so the
// SAME @livekit/track-processors background blur the room will use can be
// applied to the preview. What the user sees in the lobby is exactly what
// other participants will see after joining.

function useCameraPreview(enabled: boolean, blurEnabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<LocalVideoTrack | null>(null)
  // Bumped every time a fresh track is created so the blur effect re-runs
  // even when blurEnabled hasn't changed (e.g. user disables then re-enables
  // the camera while blur is on).
  const [trackVersion, setTrackVersion] = useState(0)

  // Create / destroy the preview track as the camera toggle flips.
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
      .catch(() => {
        // Permission denied or device unavailable — silently degrade
      })

    return () => {
      cancelled = true
      if (track) {
        try { track.detach() } catch { /* ignore */ }
        try { track.stop() } catch { /* ignore */ }
      }
      if (trackRef.current === track) trackRef.current = null
    }
  }, [enabled])

  // Apply / remove the background-blur processor on the live preview track.
  // Track-processors is heavy (~1-2 MB MediaPipe model) so we only import it
  // the first time the user actually flips the toggle on.
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
        try {
          await track.setProcessor(proc)
        } catch {
          // Hot-reload or track stop mid-attach — swallow.
        }
      }).catch(() => { /* ignore — preview falls back to unblurred */ })
    } else {
      track.stopProcessor().catch(() => { /* nothing to stop yet */ })
    }

    return () => { cancelled = true }
  }, [blurEnabled, trackVersion])

  return videoRef
}

// ─── Device toggle button ─────────────────────────────────────────────────────

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
          : "border-white/10 bg-black/40 text-white/40 hover:bg-white/10"
      )}
    >
      <span className="size-5">{enabled ? iconOn : iconOff}</span>
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  )
}

// ─── Entry Screen ─────────────────────────────────────────────────────────────

const INVITE_ONLY_MSG =
  "This session is invite-only. Your request to join must be approved by the tutor first."

function EntryScreen({
  sessionId,
  session,
  onJoin,
  onRequestSent,
  netMode,
  onNetModeChange,
}: {
  sessionId: string
  session: NonNullable<SessionInfo["session"]>
  onJoin: (data: TokenData) => void
  onRequestSent?: () => void
  netMode: NetworkMode
  onNetModeChange: (mode: NetworkMode) => void
}) {
  // Starts from what the student had in class, so a reload or a rejoin brings
  // their camera back as they left it. Starting from "off" also wrote "off"
  // straight over that preference, and a student coming back into a breakout
  // had to go and find their own tile to switch the camera on again.
  const [videoEnabled, setVideoEnabled] = useState(() => readDevicePreference("camera", false))
  // The room reads this when it connects — see devicePreference.
  useEffect(() => { writeDevicePreference("camera", videoEnabled) }, [videoEnabled])
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestMsg, setRequestMsg] = useState("")
  // Read the persisted blur preference so a returning user keeps their choice.
  // The toggle writes through to localStorage so ClassroomRoom can pick it up
  // on mount and auto-apply the processor when the room's camera publishes.
  const [blurEnabled, setBlurEnabled] = useState(() => {
    if (typeof window === "undefined") return false
    try { return window.localStorage.getItem(BLUR_PREF_KEY) === "1" } catch { return false }
  })
  useEffect(() => {
    try { window.localStorage.setItem(BLUR_PREF_KEY, blurEnabled ? "1" : "0") } catch { /* ignore */ }
  }, [blurEnabled])

  const cameraRef = useCameraPreview(videoEnabled, blurEnabled)

  const { execute: getToken, loading, error } = usePostCallback<TokenData, Record<string, never>>(
    `/api/sessions/${sessionId}/token`,
    { successMessage: false, errorMessage: false, onSuccess: onJoin }
  )

  const { execute: sendRequest, loading: requesting } = usePostCallback<
    { request: object },
    { message: string }
  >(`/api/sessions/${sessionId}/request`, {
    successMessage: "Request sent!",
    errorMessage: "Could not send request",
    onSuccess: () => {
      setRequestOpen(false)
      setRequestMsg("")
      onRequestSent?.()
    },
  })

  const isPrivate = session.visibility === "INVITE_ONLY"
  const canJoin = !isPrivate || session.isInvited || session.joinRequest?.status === "APPROVED"
  const hasPending = session.joinRequest?.status === "PENDING"
  const wasRejected = session.joinRequest?.status === "REJECTED"
  const showInviteAlert = !canJoin

  const scheduledTime = new Date(session.scheduledAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
  const scheduledDate = new Date(session.scheduledAt).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })

  return (
    <>
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-5 gap-0 rounded-2xl overflow-hidden shadow-2xl border border-border">

        {/* ── Camera preview (right on desktop, top on mobile) ── */}
        <div className="md:col-span-3 md:order-2 order-1 relative bg-zinc-900 aspect-video md:aspect-auto md:min-h-[320px] flex items-center justify-center">
          {/* Camera feed — mirrored so self-view matches a mirror, not the broadcast */}
          <video
            ref={cameraRef}
            muted
            playsInline
            className={cn(
              localCameraClassName(true, "absolute inset-0 w-full h-full object-cover transition-opacity duration-300"),
              videoEnabled ? "opacity-100" : "opacity-0"
            )}
          />

          {/* Avatar placeholder when cam off */}
          {!videoEnabled && (
            <div className="z-10 flex flex-col items-center gap-3">
              <div className="size-20 rounded-full bg-primary/20 flex items-center justify-center">
                <Camera className="size-9 text-primary/60" />
              </div>
              <p className="text-white/40 text-sm">Camera is off</p>
            </div>
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

          {/* Controls bar */}
          <div className="absolute bottom-5 left-0 right-0 flex items-center justify-center gap-3 z-10">
            <DeviceToggle
              enabled={videoEnabled}
              onToggle={() => setVideoEnabled((v) => !v)}
              iconOn={<Video className="size-5" />}
              iconOff={<VideoOff className="size-5" />}
              label={videoEnabled ? "Cam On" : "Cam Off"}
            />
            {/* Background blur — preview matches what others will see after
                joining. Disabled until the camera is on so the toggle's effect
                is visible immediately. */}
            <DeviceToggle
              enabled={blurEnabled}
              onToggle={() => setBlurEnabled((v) => !v)}
              iconOn={<Sparkles className="size-5" />}
              iconOff={<Sparkles className="size-5" />}
              label={blurEnabled ? "Blur On" : "Blur Off"}
            />
          </div>

          <div className="absolute top-4 right-4 z-10">
            <span className="flex items-center gap-1 bg-black/50 text-white/80 text-[10px] px-2 py-0.5 rounded-full">
              <MicOff className="size-2.5" /> Mic controlled by tutor
            </span>
          </div>
        </div>

        {/* ── Session info + join (left on desktop) ── */}
        <div className="md:col-span-2 md:order-1 order-2 bg-card flex flex-col p-7 gap-6">
          {/* Session info */}
          <div className="flex flex-col gap-4">
            <div>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] mb-3 gap-1",
                  session.status === "LIVE"
                    ? "border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-950"
                    : "border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950"
                )}
              >
                {session.status === "LIVE" ? (
                  <><span className="size-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" /> Live Now</>
                ) : (
                  <><Clock className="size-3" /> Scheduled</>
                )}
              </Badge>
              <h1 className="text-xl font-black leading-tight">{session.title}</h1>
              {session.description && (
                <p className="text-sm text-muted-foreground mt-1.5 line-clamp-3">{session.description}</p>
              )}
            </div>

            {/* Tutor */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/60">
              <div className="size-10 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center font-bold text-primary shrink-0">
                {session.tutor.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hosted by</p>
                <p className="font-semibold text-sm">{session.tutor.name}</p>
              </div>
            </div>

            {/* Session meta */}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-3 py-2">
                <Clock className="size-3.5 shrink-0 text-primary" />
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground">Time</p>
                  <p className="font-semibold text-foreground">{scheduledTime}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-3 py-2">
                <Clock className="size-3.5 shrink-0 text-primary" />
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground">Duration</p>
                  <p className="font-semibold text-foreground">{session.durationMins} min</p>
                </div>
              </div>
            </div>

            {session.course && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                <span>Part of: <span className="font-medium text-foreground">{session.course.title}</span></span>
              </div>
            )}
          </div>

          {/* Ready label */}
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2">
              <MicOff className="size-3.5 shrink-0 text-zinc-500" />
              <span>Microphone is controlled by your tutor during the session.</span>
            </div>
            <div className="flex gap-1">
              <span className={cn("size-2 rounded-full mt-0.5 shrink-0", videoEnabled ? "bg-emerald-500" : "bg-zinc-400")} />
              <span className={cn("text-xs", videoEnabled ? "text-foreground" : "text-muted-foreground")}>
                Camera {videoEnabled ? "on" : "off"}
              </span>
            </div>
          </div>

          {/* Network mode — the lobby is where a student on a locked-down work
              machine finds out this is handled, rather than discovering it as a
              failure to join. Only surfaced beyond a one-liner when it matters. */}
          <div className="flex flex-col gap-2 text-xs bg-muted/40 rounded-lg px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Wifi className="size-3.5 shrink-0 mt-0.5 text-zinc-500" />
              <span className="text-muted-foreground">
                Connection:{" "}
                <span className="font-medium text-foreground">{NETWORK_MODE_LABELS[netMode]}</span>
                {netMode === "standard" && " — joining from a hospital, police or council network?"}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 pl-5">
              {netMode !== "standard" ? (
                <button
                  type="button"
                  onClick={() => onNetModeChange("standard")}
                  className="text-primary hover:underline font-medium"
                >
                  Use standard quality
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onNetModeChange("restricted")}
                  className="text-primary hover:underline font-medium"
                >
                  Use restricted network mode
                </button>
              )}
              <Link href="/student/connection-check" className="text-primary hover:underline font-medium">
                Check my connection
              </Link>
            </div>
          </div>

          {/* Invite-only / access alerts */}
          {showInviteAlert && (
            <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 rounded-xl px-3 py-3">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>
                {hasPending
                  ? "Your join request is pending. The tutor will notify you when it's approved."
                  : wasRejected
                    ? "Your request to join was declined. Contact your tutor if you believe this was a mistake."
                    : INVITE_ONLY_MSG}
              </span>
            </div>
          )}
          {error && !showInviteAlert && (
            <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 rounded-xl px-3 py-3">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 mt-auto">
            {!canJoin ? (
              hasPending ? (
                <Button size="lg" disabled className="w-full font-semibold gap-2">
                  <Clock className="size-4" /> Request Pending
                </Button>
              ) : wasRejected ? (
                <Button size="lg" disabled variant="outline" className="w-full font-semibold gap-2">
                  Request Declined
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="w-full font-semibold gap-2"
                  onClick={() => setRequestOpen(true)}
                >
                  <Send className="size-4" /> Send Request
                </Button>
              )
            ) : session.status === "SCHEDULED" ? (
              <Button size="lg" disabled variant="outline" className="w-full font-semibold gap-2">
                <Loader2 className="size-4 animate-spin" /> Waiting for tutor to start
              </Button>
            ) : (
              <Button
                onClick={() => getToken({})}
                disabled={loading}
                size="lg"
                className="w-full font-semibold gap-2"
              >
                {loading ? (
                  <><Loader2 className="size-4 animate-spin" /> Connecting…</>
                ) : (
                  <><Video className="size-4" /> Join Session</>
                )}
              </Button>
            )}
            {isPrivate && !canJoin && (
              <p className="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
                <Lock className="size-3" /> Invite-only session
              </p>
            )}
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/student/classroom">
                <ChevronLeft className="size-4 mr-1" /> Back to Classroom
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>

    <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Request to Join</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Send a message to{" "}
          <span className="font-medium text-foreground">{session.tutor.name}</span> explaining why
          you&apos;d like to join this session.
        </p>
        <Textarea
          placeholder="I'd love to join because..."
          value={requestMsg}
          onChange={(e) => setRequestMsg(e.target.value)}
          rows={3}
          className="resize-none"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setRequestOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={requesting}
            onClick={() => sendRequest({ message: requestMsg })}
            className="gap-1.5"
          >
            {requesting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {requesting ? "Sending..." : "Send Request"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

// ─── After leaving / disconnect ───────────────────────────────────────────────

function SessionEndedScreen({ endedByTutor = false }: { endedByTutor?: boolean }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-8 text-center">
      <div className="relative">
        <div className="size-24 rounded-full bg-primary/8 flex items-center justify-center">
          <PhoneOff className="size-10 text-primary/40" />
        </div>
        <div className="absolute -bottom-1 -right-1 size-8 rounded-full bg-emerald-500 flex items-center justify-center">
          <CheckCircle2 className="size-5 text-white" />
        </div>
      </div>

      <div className="max-w-xs">
        <h2 className="text-2xl font-black">
          {endedByTutor ? "This class has ended" : "You left the session"}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Thanks for joining! Keep practising your BSL skills.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button asChild size="lg">
          <Link href="/student/classroom">Back to Classroom</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/student/courses">Browse Courses</Link>
        </Button>
      </div>
    </div>
  )
}

/** The tutor removed this student from the live room. */
function RemovedFromSessionScreen() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="size-24 rounded-full bg-muted flex items-center justify-center">
        <PhoneOff className="size-10 text-muted-foreground" />
      </div>

      <div className="max-w-md">
        <h2 className="text-2xl font-black">You were removed from the session</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Your tutor removed you from this live class. If you think this was a mistake,
          send them a message before trying to join again.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button asChild size="lg">
          <Link href="/student/classroom">Back to Classroom</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/student/messages">Message your tutor</Link>
        </Button>
      </div>
    </div>
  )
}

/** LiveKit disconnected without an explicit Leave tap — offer reconnect steps (student-side crash / network protocol). */
/**
 * The link is down and we are waiting for it, rather than blaming anyone.
 *
 * Distinct from "Connection lost" on purpose. That screen ends the visit and
 * asks the student to check their internet; this one keeps the visit alive,
 * because on café, hotel and train Wi-Fi the connection is coming back on its
 * own in under a minute and the only thing that needs to happen is nobody
 * pressing reload in the meantime.
 */
function WaitingForNetworkScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="size-24 rounded-full bg-amber-500/15 flex items-center justify-center">
        <Loader2 className="size-10 text-amber-600 animate-spin" />
      </div>

      <div className="max-w-md">
        <h2 className="text-2xl font-black">Waiting for your internet</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Your connection dropped, so we&apos;ve paused rather than ending your class.
          We&apos;re watching for it to come back and will put you straight back in — you don&apos;t need to do anything.
        </p>
        <ul className="text-left text-sm text-muted-foreground mt-4 space-y-2 list-disc list-inside">
          <li>Please don&apos;t reload — your chat and raised hand are kept.</li>
          <li>On public Wi-Fi, check whether a sign-in page is waiting in another tab.</li>
          <li>Moving nearer the router, or switching to your phone&apos;s hotspot, usually fixes it.</li>
        </ul>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button size="lg" onClick={() => { probeNetworkNow(); onRetry() }}>Try now</Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/student/classroom">Back to Classroom</Link>
        </Button>
      </div>
    </div>
  )
}

function ConnectionLostScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="size-24 rounded-full bg-amber-500/15 flex items-center justify-center">
        <WifiOff className="size-10 text-amber-600" />
      </div>

      <div className="max-w-md">
        <h2 className="text-2xl font-black">Connection lost</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          The live room dropped unexpectedly. That usually means a network blip, browser sleep, or the session closing — not something you did wrong.
        </p>
        <ol className="text-left text-sm text-muted-foreground mt-4 space-y-2 list-decimal list-inside">
          <li>Check your internet connection.</li>
          <li>Disable VPNs or other tabs that might interrupt video calling.</li>
          <li>Confirm with your tutor that the session is still live.</li>
          <li>Use &quot;Try reconnecting&quot; below, or refresh this page.</li>
        </ol>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button size="lg" onClick={onRetry}>Try reconnecting</Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/student/classroom">Back to Classroom</Link>
        </Button>
      </div>
    </div>
  )
}

/**
 * Every network mode failed to connect.
 *
 * This is the locked-down-workplace case: an NHS or police network that blocks
 * the classroom outright rather than intermittently. "Connection lost" would be
 * a misleading and demoralising thing to show here — the student's internet is
 * fine, and telling them to check it wastes the one thing they are short of.
 * Send them to the diagnostics, which produce something IT can act on.
 */
function ConnectionBlockedScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="size-24 rounded-full bg-destructive/10 flex items-center justify-center">
        <Lock className="size-10 text-destructive" />
      </div>

      <div className="max-w-md">
        <h2 className="text-2xl font-black">This network is blocking the classroom</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          We tried every way in, including the port-443 route that works on most secure networks.
          Your internet is working — something between this computer and us is refusing live video.
          That is normal on hospital, police, school and council networks.
        </p>
        <ol className="text-left text-sm text-muted-foreground mt-4 space-y-2 list-decimal list-inside">
          <li>Run the connection check — it produces a report your IT team can act on.</li>
          <li>Send them the requirements page it links to; it names the exact hosts and ports.</li>
          <li>If you can, try again from a home or mobile connection in the meantime.</li>
        </ol>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button asChild size="lg">
          <Link href="/student/connection-check">Run connection check</Link>
        </Button>
        <Button variant="outline" size="lg" onClick={onRetry}>Try again</Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/student/classroom">Back to Classroom</Link>
        </Button>
      </div>
    </div>
  )
}

/** Same-identity collision (another tab/device joined, or a stale ghost session) — offer a clean re-join here. */
function ConnectionDuplicateScreen({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="size-24 rounded-full bg-amber-500/15 flex items-center justify-center">
        <WifiOff className="size-10 text-amber-600" />
      </div>

      <div className="max-w-md">
        <h2 className="text-2xl font-black">Opened somewhere else</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          This classroom is now open in another tab, window, or device. Only one connection per
          person is allowed at a time. Close the other one, then reconnect here.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button size="lg" onClick={onReconnect}>Reconnect here</Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/student/classroom">Back to Classroom</Link>
        </Button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// A tutor-triggered "refresh all" sets this flag in sessionStorage right before
// calling reload(). On next mount, the page reads it once and skips the lobby so
// the student rejoins automatically. Flag is scoped per-session, per-tab, and
// expires quickly so a stale leftover can't silently auto-join the next visit.
const AUTO_REJOIN_KEY = (id: string) => `classroom:auto-rejoin:${id}`
const AUTO_REJOIN_MAX_AGE_MS = 30_000

/**
 * Free retries on the path already chosen, per visit, before the escalation
 * ladder is allowed to conclude that the path is the problem.
 *
 * The escalation ladder was built for locked-down workplace networks, where a
 * failed connection is evidence about the firewall and the next mode is the
 * answer. On café or hotel Wi-Fi the same failure means something entirely
 * different — the link wobbled — and escalating on it is actively harmful: the
 * student is walked through all three modes in a few seconds, none of which can
 * succeed while the link is down, and lands on "this network is blocking the
 * classroom" when their network is blocking nothing. Worse, if a retry then
 * happens to land in Minimal, that gets saved to the device and every future
 * lesson runs at 320×180 through a relay because of one bad afternoon.
 *
 * So the first failed attempt of a visit gets one retry on the path already
 * chosen. Budgeted per visit rather than per mode on purpose: a genuinely
 * blocked network then reaches its verdict exactly one attempt later than
 * before, instead of one per rung, which would have doubled the wait for the
 * NHS and police students this ladder was built for.
 */
const SAME_MODE_RETRIES = 1

/** How many times a dropped class re-joins itself when the link returns. */
const AUTO_RECOVER_LIMIT = 3

/**
 * True when this browser currently has no usable path to us at all — the Wi-Fi
 * is gone, or a captive portal is answering in our place. Nothing about the
 * classroom's route can be inferred while that is the case, so the connection
 * logic must wait rather than draw conclusions.
 */
function linkIsDown(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true
  const status = getNetworkSnapshot().status
  return status === "offline" || status === "captive-portal"
}

export default function ClassroomRoomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  // Read once per connection, not on every render: the in-room camera button
  // writes the same key, and a changing `video` prop would fight it.
  const joinWithCamera = useMemo(
    () => (tokenData ? readDevicePreference("camera", false) : false),
    [tokenData],
  )
  const [disconnectKind, setDisconnectKind] = useState<null | "left" | "ended" | "lost" | "duplicate" | "blocked" | "removed">(null)
  const leaveClickedRef = useRef(false)

  // How this device talks to the media servers. Read from storage on mount
  // (not lazily during render) because storage is client-only and is itself
  // sometimes disabled by policy on the machines this feature exists for.
  const [netMode, setNetMode] = useState<NetworkMode>("standard")
  useEffect(() => { setNetMode(readNetworkMode()) }, [])

  // Modes already tried on this visit, so a connection that fails repeatedly
  // walks down the list once instead of looping on the same broken path.
  const triedModesRef = useRef<Set<NetworkMode>>(new Set())
  // Set while we are deliberately tearing the room down to retry in another
  // mode, so the resulting disconnect isn't reported to the student as a fault.
  const escalatingRef = useRef(false)
  const [autoRejoin, setAutoRejoin] = useState(false)
  // Shown while we fetch a fresh token and remount after a recoverable drop.
  const [reconnecting, setReconnecting] = useState(false)
  // Set when the link itself is down. Nothing to retry until it returns, so we
  // hold the student here rather than sending them to a screen that blames the
  // classroom for the café's Wi-Fi.
  const [waitingForNetwork, setWaitingForNetwork] = useState(false)
  // Attempts already spent on the current mode before escalating.
  const sameModeRetriesRef = useRef(0)
  // Automatic re-joins after the link came back, capped so a link that flaps
  // does not loop the student in and out of class indefinitely.
  const autoRecoveriesRef = useRef(0)

  const { data, loading: infoLoading, refetch: refetchInfo } = useFetch<SessionInfo>(`/api/sessions/${id}/info`, {
    errorMessage: false,
  })

  // An approved join request only reached the student as a notification; the
  // lobby kept saying "Request Pending" until they thought to reload. Re-check
  // while it is pending so "Join Session" appears by itself.
  const requestPending = !tokenData && data?.session?.joinRequest?.status === "PENDING"
  // Likewise the tutor pressing Start: the lobby holds "Waiting for tutor"
  // until the session flips LIVE, then offers "Join Session" by itself.
  const awaitingStart = !tokenData && data?.session?.status === "SCHEDULED" && !data.session.inPerson
  useEffect(() => {
    if (!requestPending && !awaitingStart) return
    const t = setInterval(() => { void refetchInfo() }, 5_000)
    return () => clearInterval(t)
  }, [requestPending, awaitingStart, refetchInfo])

  // Parallel token fetch used only for auto-rejoin. EntryScreen still runs its
  // own getToken for the manual path; the two never fire together because
  // autoRejoin gates the bypass.
  const { execute: autoGetToken } = usePostCallback<TokenData, Record<string, never>>(
    `/api/sessions/${id}/token`,
    {
      successMessage: false,
      errorMessage: false,
      onSuccess: setTokenData,
      // Without this the student sits on a "Reconnecting…" spinner for ever
      // when the token request itself is what the network blocked — the exact
      // failure this whole feature exists to make legible.
      onError: () => {
        setReconnecting(false)
        // The token request is an ordinary HTTPS call. If it failed because the
        // link is down, that says nothing about whether this network permits
        // live video — so wait for the link instead of declaring the classroom
        // blocked, which is the wrong screen and the wrong advice.
        if (linkIsDown()) {
          setWaitingForNetwork(true)
          escalatingRef.current = false
          return
        }
        // "Blocked" is only honest once we have actually exhausted modes.
        // `escalatingRef` is also set for an ordinary same-mode retry, so it is
        // the wrong signal here — the set of modes already tried is the right
        // one, and it is only ever added to on the escalation path.
        setDisconnectKind((prev) => prev ?? (triedModesRef.current.size > 0 ? "blocked" : "lost"))
        escalatingRef.current = false
      },
    }
  )

  // Read the one-shot flag on mount. Using an effect (not lazy initial state)
  // avoids any server/client hydration mismatch — sessionStorage is client-only.
  useEffect(() => {
    if (typeof window === "undefined") return
    const key = AUTO_REJOIN_KEY(id)
    const raw = sessionStorage.getItem(key)
    if (!raw) return
    sessionStorage.removeItem(key)
    const ts = parseInt(raw, 10)
    if (Number.isFinite(ts) && Date.now() - ts < AUTO_REJOIN_MAX_AGE_MS) {
      setAutoRejoin(true)
    }
  }, [id])

  // Fire the token request as soon as session info is loaded.
  useEffect(() => {
    if (!autoRejoin) return
    if (!data?.session || data.session.inPerson) return
    if (tokenData) return
    autoGetToken({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRejoin, data, tokenData])

  // A mode chosen by hand in the lobby is a deliberate choice about this
  // machine, so it persists immediately — unlike an automatic escalation, which
  // has to prove itself by connecting first.
  const handleNetModeChange = (mode: NetworkMode) => {
    setNetMode(mode)
    writeNetworkMode(mode)
    triedModesRef.current.clear()
  }

  const handleLeaveRoom = () => {
    leaveClickedRef.current = true
    setDisconnectKind("left")
  }

  const handleLiveKitDisconnected = (reason?: DisconnectReason) => {
    // Mid-escalation the room is torn down on purpose; the retry is already in
    // flight, so saying "connection lost" here would be both wrong and alarming.
    if (escalatingRef.current) return

    // The link went away underneath us. LiveKit has already spent its own
    // reconnect budget, but the student has not left and the class has not
    // ended — so hold the seat and re-join by ourselves the moment the Wi-Fi is
    // back. Walking out to "Connection lost" here is what turned a forty-second
    // café outage into a student sitting in the lobby wondering whether the
    // lesson is still running.
    if (
      !leaveClickedRef.current &&
      reason !== DisconnectReason.DUPLICATE_IDENTITY &&
      linkIsDown() &&
      autoRecoveriesRef.current < AUTO_RECOVER_LIMIT
    ) {
      autoRecoveriesRef.current += 1
      setWaitingForNetwork(true)
      return
    }

    setDisconnectKind((prev) => {
      if (prev !== null) return prev
      if (leaveClickedRef.current) return "left"
      // Another tab/device joined with the same identity and took the seat — the
      // server kicked this connection. Tell the user plainly rather than blaming
      // the network. The server evicts ghost sessions on token issue, so this only
      // fires for a genuinely concurrent second connection.
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) return "duplicate"
      // The tutor removed this student. "Connection lost" told them it was a
      // network blip and offered to reconnect them straight back in.
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) return "removed"
      // Finishing a session deletes the room. Every student used to be told
      // "Connection lost — check your internet" and offered a reconnect into a
      // class that no longer exists.
      if (reason === DisconnectReason.ROOM_DELETED) return "ended"
      return "lost"
    })
  }

  /**
   * A connection error is the moment we learn the network is restricted — so
   * act on it rather than reporting it. Escalating to the next mode retries
   * over TURN on TCP/TLS 443, which is what gets a student on a hospital or
   * police network into class. Only once every mode has failed do we say so.
   */
  const handleLiveKitError = (err: Error) => {
    console.warn("[classroom] connection error", err)

    // Nothing about the route can be learned while there is no link. Escalating
    // here would burn every mode against a network that is simply absent.
    if (linkIsDown()) {
      escalatingRef.current = false
      setWaitingForNetwork(true)
      return
    }

    // One retry on the path we already chose, before deciding the path is the
    // problem. Public Wi-Fi drops a connection attempt often enough that a
    // first failure is not evidence of anything.
    if (sameModeRetriesRef.current < SAME_MODE_RETRIES) {
      sameModeRetriesRef.current += 1
      escalatingRef.current = true
      setTokenData(null)
      setReconnecting(true)
      // A short pause: retrying into the same half-second that just failed
      // usually fails the same way.
      setTimeout(() => autoGetToken({}), 1_500)
      return
    }

    triedModesRef.current.add(netMode)

    let next = escalateNetworkMode(netMode)
    while (next && triedModesRef.current.has(next)) next = escalateNetworkMode(next)

    if (!next) {
      escalatingRef.current = false
      setDisconnectKind((prev) => prev ?? "blocked")
      return
    }

    escalatingRef.current = true
    setNetMode(next)
    toast.info(`Your network blocked the usual route — retrying in ${NETWORK_MODE_LABELS[next]}…`)

    // Take a fresh token rather than reusing this one. If the first attempt got
    // as far as signalling before the media path failed, LiveKit Cloud holds
    // that identity in its reconnect-grace window and rejects an immediate
    // rejoin as revoked — which would look exactly like the network blocking us
    // again, and would send the student to the "blocked" screen for the wrong
    // reason. Every token issue mints a new identity, so this always lands.
    setTokenData(null)
    setReconnecting(true)
    autoGetToken({})
  }

  /**
   * Remember an escalated mode only once it has actually carried a connection.
   * Persisting on the attempt instead would permanently downgrade a student's
   * quality because of one bad afternoon on an otherwise fine network.
   */
  const handleLiveKitConnected = () => {
    escalatingRef.current = false
    sameModeRetriesRef.current = 0
    autoRecoveriesRef.current = 0
    setWaitingForNetwork(false)
    if (triedModesRef.current.size > 0 && netMode !== readNetworkMode()) {
      writeNetworkMode(netMode)
      toast.success(`Connected using ${NETWORK_MODE_LABELS[netMode]}. Saved for this computer.`)
    }
  }

  // Tear down the dead room and pull a fresh token to remount cleanly. Used by
  // both the "Connection lost" and "Opened elsewhere" recovery buttons.
  const handleReconnect = () => {
    leaveClickedRef.current = false
    escalatingRef.current = false
    sameModeRetriesRef.current = 0
    autoRecoveriesRef.current = 0
    setWaitingForNetwork(false)
    triedModesRef.current.clear()
    setDisconnectKind(null)
    setTokenData(null)
    setReconnecting(true)
    autoGetToken({})
  }

  // Drop the spinner once a fresh token lands and the room can remount.
  useEffect(() => {
    if (tokenData) setReconnecting(false)
  }, [tokenData])

  /**
   * Back into class by ourselves the moment the link returns.
   *
   * The probe that decides "the link returned" lives in `lib/network-health.ts`
   * and runs whether or not this page is doing anything, so the student does
   * not have to press a button at the right moment — which on a link that comes
   * and goes every minute is a game nobody wins.
   */
  useEffect(() => {
    if (!waitingForNetwork) return
    return subscribeNetworkRecovery(() => {
      setWaitingForNetwork(false)
      setDisconnectKind(null)
      escalatingRef.current = false
      setTokenData(null)
      setReconnecting(true)
      autoGetToken({})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForNetwork])

  if (disconnectKind === "left") return <SessionEndedScreen />
  if (disconnectKind === "ended") return <SessionEndedScreen endedByTutor />
  if (waitingForNetwork) return <WaitingForNetworkScreen onRetry={handleReconnect} />
  if (disconnectKind === "lost") return <ConnectionLostScreen onRetry={handleReconnect} />
  if (disconnectKind === "duplicate") return <ConnectionDuplicateScreen onReconnect={handleReconnect} />
  if (disconnectKind === "blocked") return <ConnectionBlockedScreen onRetry={handleReconnect} />
  if (disconnectKind === "removed") return <RemovedFromSessionScreen />

  if (infoLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!tokenData) {
    if (!data?.session) return null
    if (data.session.inPerson) {
      return (
        <FaceToFaceClassScreen
          title={data.session.title}
          scheduledAt={data.session.scheduledAt}
          durationMins={data.session.durationMins}
          venue={data.session.venue}
          backHref="/student/classroom"
        />
      )
    }
    if (autoRejoin || reconnecting) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Reconnecting to the classroom…</p>
        </div>
      )
    }
    return (
      <EntryScreen
        sessionId={id}
        session={data.session}
        onJoin={setTokenData}
        onRequestSent={refetchInfo}
        netMode={netMode}
        onNetModeChange={handleNetModeChange}
      />
    )
  }

  return (
    <LiveKitRoom
      // The mode is part of the key: changing it must build a new Room with the
      // new ICE policy, which LiveKit only reads when the Room is constructed.
      key={`${tokenData.token}:${netMode}`}
      token={tokenData.token}
      serverUrl={tokenData.wsUrl}
      connect={true}
      video={joinWithCamera}
      audio={false}
      options={roomOptionsFor(netMode)}
      connectOptions={connectOptionsFor(netMode)}
      onConnected={handleLiveKitConnected}
      onError={handleLiveKitError}
      // A camera or mic that fails to start on join used to leave a black
      // self-view and nothing else. Say why, so it can be fixed in the room.
      onMediaDeviceFailure={(failure, kind) =>
        toast.error(mediaFailureMessage(failure, kind === "audioinput" ? "mic" : "camera"))
      }
      onDisconnected={handleLiveKitDisconnected}
    >
      <ClassroomRoom
        isTutor={false}
        sessionId={id}
        sessionTitle={data?.session?.title ?? "Live Session"}
        onLeave={handleLeaveRoom}
      />
    </LiveKitRoom>
  )
}
