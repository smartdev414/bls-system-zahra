"use client"

import { use, useState, useRef, useEffect } from "react"
import Link from "next/link"
import {
  Video, Mic, MicOff, VideoOff, PhoneOff,
  ChevronLeft, Loader2, AlertCircle, Clock,
  Camera, CheckCircle2, Download, FileText, Paperclip,
  WifiOff, Sparkles, Send, Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { usePostCallback, useFetch } from "@/hooks/use-fetch"
import { LiveKitRoom } from "@livekit/components-react"
import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client"
import "@livekit/components-styles"
import { ClassroomRoom } from "@/components/classroom/ClassroomRoom"
import { BLUR_PREF_KEY } from "@/components/classroom/blurPreference"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type TokenData = { token: string; wsUrl: string; roomName: string }

type SessionResource = {
  id: string; title: string; fileUrl: string; fileName: string
  fileSize: number | null; mimeType: string | null
}

type SessionInfo = {
  session: {
    id: string
    title: string
    description: string | null
    status: string
    visibility: "PUBLIC" | "INVITE_ONLY"
    durationMins: number
    scheduledAt: string
    tutor: { name: string }
    course: { title: string } | null
    resources: SessionResource[]
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
}: {
  sessionId: string
  session: NonNullable<SessionInfo["session"]>
  onJoin: (data: TokenData) => void
  onRequestSent?: () => void
}) {
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)
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

        {/* ── Left: camera preview ── */}
        <div className="md:col-span-3 relative bg-zinc-900 min-h-[320px] flex items-center justify-center">
          {/* Camera feed */}
          <video
            ref={cameraRef}
            muted
            playsInline
            className={cn(
              "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
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

          {/* Status indicators top-right */}
          <div className="absolute top-4 right-4 flex gap-2 z-10">
            {audioEnabled && (
              <span className="flex items-center gap-1 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full">
                <Mic className="size-2.5" /> Live
              </span>
            )}
          </div>
        </div>

        {/* ── Right: session info + join ── */}
        <div className="md:col-span-2 bg-card flex flex-col p-7 gap-6">
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

          {/* Resource files */}
          {session.resources && session.resources.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
                <Paperclip className="size-3.5" /> Session Materials
              </p>
              <div className="flex flex-col gap-1.5">
                {session.resources.map((r) => (
                  <a
                    key={r.id}
                    href={r.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={r.fileName}
                    className="flex items-center gap-2.5 rounded-lg border bg-muted/40 hover:bg-muted/70 px-3 py-2 transition-colors group"
                  >
                    <FileText className="size-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 min-w-0 text-xs font-medium truncate group-hover:text-primary transition-colors">
                      {r.fileName}
                    </span>
                    <Download className="size-3.5 text-muted-foreground shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Ready label */}
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

function SessionEndedScreen() {
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
        <h2 className="text-2xl font-black">You left the session</h2>
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

/** LiveKit disconnected without an explicit Leave tap — offer reconnect steps (student-side crash / network protocol). */
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

// ─── Page ─────────────────────────────────────────────────────────────────────

// A tutor-triggered "refresh all" sets this flag in sessionStorage right before
// calling reload(). On next mount, the page reads it once and skips the lobby so
// the student rejoins automatically. Flag is scoped per-session, per-tab, and
// expires quickly so a stale leftover can't silently auto-join the next visit.
const AUTO_REJOIN_KEY = (id: string) => `classroom:auto-rejoin:${id}`
const AUTO_REJOIN_MAX_AGE_MS = 30_000

export default function ClassroomRoomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  const [disconnectKind, setDisconnectKind] = useState<null | "left" | "lost">(null)
  const leaveClickedRef = useRef(false)
  const [autoRejoin, setAutoRejoin] = useState(false)

  const { data, loading: infoLoading, refetch: refetchInfo } = useFetch<SessionInfo>(`/api/sessions/${id}/info`, {
    errorMessage: false,
  })

  // Parallel token fetch used only for auto-rejoin. EntryScreen still runs its
  // own getToken for the manual path; the two never fire together because
  // autoRejoin gates the bypass.
  const { execute: autoGetToken } = usePostCallback<TokenData, Record<string, never>>(
    `/api/sessions/${id}/token`,
    { successMessage: false, errorMessage: false, onSuccess: setTokenData }
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
    if (!data?.session) return
    if (tokenData) return
    autoGetToken({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRejoin, data, tokenData])

  const handleLeaveRoom = () => {
    leaveClickedRef.current = true
    setDisconnectKind("left")
  }

  const handleLiveKitDisconnected = () => {
    setDisconnectKind((prev) => {
      if (prev !== null) return prev
      return leaveClickedRef.current ? "left" : "lost"
    })
  }

  const handleRetryAfterDrop = () => {
    leaveClickedRef.current = false
    setDisconnectKind(null)
    setTokenData(null)
  }

  if (disconnectKind === "left") return <SessionEndedScreen />
  if (disconnectKind === "lost") return <ConnectionLostScreen onRetry={handleRetryAfterDrop} />

  if (infoLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!tokenData) {
    if (!data?.session) return null
    if (autoRejoin) {
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
      />
    )
  }

  return (
    <LiveKitRoom
      token={tokenData.token}
      serverUrl={tokenData.wsUrl}
      connect={true}
      video={false}
      audio={true}
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
