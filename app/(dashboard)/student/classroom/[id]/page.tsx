"use client"

import { use, useState } from "react"
import Link from "next/link"
import {
  Video, Mic, MicOff, VideoOff, PhoneOff,
  Users, ChevronLeft, Loader2, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { usePostCallback } from "@/hooks/use-fetch"
import {
  LiveKitRoom,
  VideoConference,
  useRoomContext,
} from "@livekit/components-react"
import "@livekit/components-styles"

// ─── Types ────────────────────────────────────────────────────────────────────

type TokenData = {
  token: string
  wsUrl: string
  roomName: string
}

// ─── Entry screen ─────────────────────────────────────────────────────────────

function EntryScreen({
  sessionId,
  onJoin,
}: {
  sessionId: string
  onJoin: (data: TokenData) => void
}) {
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)

  const { execute: getToken, loading, error } = usePostCallback<TokenData, Record<string, never>>(
    `/api/sessions/${sessionId}/token`,
    {
      successMessage: false,
      errorMessage: false,
      onSuccess: (data) => onJoin(data),
    }
  )

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8">
      <div className="text-center">
        <div className="rounded-full bg-primary/10 p-5 mx-auto mb-4 w-fit">
          <Video className="size-10 text-primary" />
        </div>
        <h1 className="text-2xl font-black">Ready to join?</h1>
        <p className="text-muted-foreground mt-1">Check your audio and video before joining.</p>
      </div>

      {/* Device toggles */}
      <div className="flex gap-4">
        <button
          onClick={() => setAudioEnabled((v) => !v)}
          className={`flex flex-col items-center gap-2 rounded-2xl border p-5 w-28 transition-all ${
            audioEnabled
              ? "border-primary bg-primary/5 text-primary"
              : "border-muted-foreground/30 text-muted-foreground"
          }`}
        >
          {audioEnabled ? <Mic className="size-6" /> : <MicOff className="size-6" />}
          <span className="text-xs font-semibold">{audioEnabled ? "Mic On" : "Mic Off"}</span>
        </button>

        <button
          onClick={() => setVideoEnabled((v) => !v)}
          className={`flex flex-col items-center gap-2 rounded-2xl border p-5 w-28 transition-all ${
            videoEnabled
              ? "border-primary bg-primary/5 text-primary"
              : "border-muted-foreground/30 text-muted-foreground"
          }`}
        >
          {videoEnabled ? <Video className="size-6" /> : <VideoOff className="size-6" />}
          <span className="text-xs font-semibold">{videoEnabled ? "Cam On" : "Cam Off"}</span>
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-xl px-4 py-3 max-w-sm text-center">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          onClick={() => getToken({})}
          disabled={loading}
          className="min-w-[200px]"
        >
          {loading ? (
            <><Loader2 className="size-4 animate-spin mr-2" /> Connecting...</>
          ) : (
            <><Video className="size-4 mr-2" /> Join Session</>
          )}
        </Button>

        <Button asChild variant="ghost" size="sm">
          <Link href="/student/classroom">
            <ChevronLeft className="size-4 mr-1" /> Back to Classroom
          </Link>
        </Button>
      </div>
    </div>
  )
}

// ─── Room participant count badge ─────────────────────────────────────────────

function ParticipantBadge() {
  const room = useRoomContext()
  const count = room.numParticipants
  return (
    <Badge variant="outline" className="gap-1.5">
      <Users className="size-3" />
      {count} participant{count !== 1 ? "s" : ""}
    </Badge>
  )
}

// ─── Room page ────────────────────────────────────────────────────────────────

export default function ClassroomRoomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  const [disconnected, setDisconnected] = useState(false)

  if (disconnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="rounded-full bg-muted p-5 mx-auto">
          <PhoneOff className="size-10 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-xl font-bold">You&apos;ve left the session</h2>
          <p className="text-muted-foreground mt-1">Thank you for joining!</p>
        </div>
        <Button asChild>
          <Link href="/student/classroom">Back to Classroom</Link>
        </Button>
      </div>
    )
  }

  if (!tokenData) {
    return <EntryScreen sessionId={id} onJoin={setTokenData} />
  }

  return (
    <div className="-mx-6 -mt-8 h-[calc(100vh-4rem)] flex flex-col">
      {/* Room header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/student/classroom">
              <ChevronLeft className="size-4 mr-1" /> Leave
            </Link>
          </Button>
          <Badge className="bg-emerald-500 gap-1.5 text-white">
            <span className="size-1.5 rounded-full bg-white animate-pulse" />
            Live
          </Badge>
        </div>
        <LiveKitRoom
          token={tokenData.token}
          serverUrl={tokenData.wsUrl}
          connect={false}
        >
          <ParticipantBadge />
        </LiveKitRoom>
      </div>

      {/* LiveKit video conference */}
      <div className="flex-1 overflow-hidden">
        <LiveKitRoom
          token={tokenData.token}
          serverUrl={tokenData.wsUrl}
          connect={true}
          video={false}
          audio={true}
          onDisconnected={() => setDisconnected(true)}
          className="h-full"
        >
          <VideoConference />
        </LiveKitRoom>
      </div>
    </div>
  )
}
