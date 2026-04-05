"use client"

import { use, useState, useRef, useEffect } from "react"
import Link from "next/link"
import {
  Video, Mic, MicOff, VideoOff, PhoneOff,
  ChevronLeft, Loader2, AlertCircle, Clock,
  Camera, CheckCircle2, Download, FileText, Paperclip,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { usePostCallback, useFetch } from "@/hooks/use-fetch"
import { LiveKitRoom } from "@livekit/components-react"
import "@livekit/components-styles"
import { ClassroomRoom } from "@/components/classroom/ClassroomRoom"
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
    durationMins: number
    scheduledAt: string
    tutor: { name: string }
    course: { title: string } | null
    resources: SessionResource[]
    _count?: { attendances: number }
  }
}

// ─── Camera preview hook ──────────────────────────────────────────────────────

function useCameraPreview(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!enabled) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      return
    }

    // getUserMedia requires HTTPS or localhost; guard against unsupported environments
    if (!navigator?.mediaDevices?.getUserMedia) return

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      })
      .catch(() => {
        // Permission denied or device unavailable — silently degrade
      })

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [enabled])

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

function EntryScreen({
  sessionId,
  session,
  onJoin,
}: {
  sessionId: string
  session: NonNullable<SessionInfo["session"]>
  onJoin: (data: TokenData) => void
}) {
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const cameraRef = useCameraPreview(videoEnabled)

  const { execute: getToken, loading, error } = usePostCallback<TokenData, Record<string, never>>(
    `/api/sessions/${sessionId}/token`,
    { successMessage: false, errorMessage: false, onSuccess: onJoin }
  )

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

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 rounded-xl px-3 py-3">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 mt-auto">
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
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/student/classroom">
                <ChevronLeft className="size-4 mr-1" /> Back to Classroom
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Left session screen ──────────────────────────────────────────────────────

function LeftScreen() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-8 text-center">
      {/* Icon */}
      <div className="relative">
        <div className="size-24 rounded-full bg-primary/8 flex items-center justify-center">
          <PhoneOff className="size-10 text-primary/40" />
        </div>
        <div className="absolute -bottom-1 -right-1 size-8 rounded-full bg-emerald-500 flex items-center justify-center">
          <CheckCircle2 className="size-5 text-white" />
        </div>
      </div>

      <div className="max-w-xs">
        <h2 className="text-2xl font-black">Session ended</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Thanks for joining! Keep practising your BSL skills.
        </p>
      </div>

      {/* Actions */}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClassroomRoomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  const [disconnected, setDisconnected] = useState(false)

  const { data, loading: infoLoading } = useFetch<SessionInfo>(`/api/sessions/${id}/info`, {
    errorMessage: false,
  })

  if (disconnected) return <LeftScreen />

  if (infoLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!tokenData) {
    if (!data?.session) return null
    return (
      <EntryScreen
        sessionId={id}
        session={data.session}
        onJoin={setTokenData}
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
      onDisconnected={() => setDisconnected(true)}
    >
      <ClassroomRoom
        isTutor={false}
        sessionTitle={data?.session?.title ?? "Live Session"}
        onLeave={() => setDisconnected(true)}
      />
    </LiveKitRoom>
  )
}
