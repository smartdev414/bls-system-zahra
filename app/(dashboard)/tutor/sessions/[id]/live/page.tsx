"use client"

import { use, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2, AlertCircle } from "lucide-react"
import { LiveKitRoom } from "@livekit/components-react"
import "@livekit/components-styles"
import { ClassroomRoom } from "@/components/classroom/ClassroomRoom"
import { useFetch, usePostCallback, usePatchCallback } from "@/hooks/use-fetch"

// ─── Types ────────────────────────────────────────────────────────────────────

type TokenData = { token: string; wsUrl: string; roomName: string }

type SessionInfo = {
  session: {
    id: string
    title: string
    status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
    tutorId: string
    tutor: { name: string }
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorLiveClassroomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  const [ended, setEnded] = useState(false)

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

  // Auto-start session and get token when page loads
  useEffect(() => {
    if (!data) return
    const { status } = data.session

    const start = async () => {
      if (status === "SCHEDULED") {
        await patchStatus({ status: "LIVE" })
      }
      getToken({})
    }

    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const handleLeave = async () => {
    setEnded(true)
    router.push(`/tutor/sessions/${id}`)
  }

  const handleEndSession = async () => {
    await patchStatus({ status: "COMPLETED" })
    setEnded(true)
    router.push(`/tutor/sessions/${id}`)
  }

  // ── Loading / error states ──────────────────────────────────────────────────

  if (infoLoading || (!tokenData && !tokenError && !infoError)) {
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

  if (ended || !tokenData) return null

  return (
    <LiveKitRoom
      token={tokenData.token}
      serverUrl={tokenData.wsUrl}
      connect={true}
      video={true}
      audio={true}
      onDisconnected={handleLeave}
    >
      <ClassroomRoom
        isTutor={true}
        sessionTitle={data?.session?.title ?? "Live Session"}
        onLeave={handleEndSession}
      />
    </LiveKitRoom>
  )
}
