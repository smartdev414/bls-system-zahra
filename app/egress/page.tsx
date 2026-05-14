"use client"

// LiveKit custom egress template
// ────────────────────────────────
// This page is loaded by LiveKit's headless-Chrome egress worker, NOT by a
// regular user. The worker navigates to:
//
//   {customBaseUrl}?url={liveKitWsUrl}&token={egressJoinToken}&layout={name}
//
// When `customBaseUrl` is set in startRoomCompositeEgress, LiveKit appends
// those query params automatically. The template's job is to:
//   1. Connect to the room as a view-only participant using `token`.
//   2. Render whatever the recording should look like (here: a video grid
//      with the Deaf Signs logo overlaid in the top-left).
//   3. Signal readiness via `lk-egress-template-ready` (and the legacy
//      `window.READY_TO_RECORD` flag) so the worker starts capturing.
//
// IMPORTANT: this route is PUBLIC. Access is gated by the JWT in the URL —
// only the egress worker has it, and it's view-only.

import { useEffect, useMemo, useState } from "react"
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useConnectionState,
} from "@livekit/components-react"
import { Track, ConnectionState } from "livekit-client"
import "@livekit/components-styles"
import { LogoWatermark } from "@/components/layout/logo"

// We can't use useSearchParams in a `force-dynamic` page reliably inside the
// egress browser (no JS routing) — read directly from `window.location`.
function readQueryParams() {
  if (typeof window === "undefined") return { url: null, token: null, layout: null }
  const params = new URLSearchParams(window.location.search)
  return {
    url:    params.get("url"),
    token:  params.get("token"),
    layout: params.get("layout"),
  }
}

function CompositeGrid() {
  // Subscribe to every camera and screen-share track in the room. Filtering
  // here mirrors what live participants see, so the recording matches.
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: true },
  )

  if (tracks.length === 0) {
    // Render a black frame with the logo while waiting for the first track to
    // subscribe — keeps the recording from starting with a flash of nothing.
    return (
      <div className="absolute inset-0 bg-black" />
    )
  }

  return (
    <GridLayout tracks={tracks} className="absolute inset-0">
      <ParticipantTile />
    </GridLayout>
  )
}

// Signals readiness to the egress worker once the room has connected and at
// least one frame has been rendered. The dispatch happens on the next animation
// frame so the worker captures actual video, not the loading placeholder.
function ReadySignal() {
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      // Legacy boolean — some egress worker builds still check this.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).READY_TO_RECORD = true
      // Current event — the canonical signal LiveKit Cloud documents.
      window.dispatchEvent(new Event("lk-egress-template-ready"))
    })
    return () => window.cancelAnimationFrame(id)
  }, [])
  return null
}

export default function EgressTemplatePage() {
  // Querystring is only available client-side; mounted=true gates the room
  // until after hydration so SSR doesn't try to read window.location.
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  const { url, token } = useMemo(() => (mounted ? readQueryParams() : { url: null, token: null }), [mounted])

  if (!mounted) return null

  // If someone navigates here directly (no token), show a benign placeholder.
  if (!url || !token) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center text-white/40 text-sm font-mono">
        egress template — no session
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <LiveKitRoom
        serverUrl={url}
        token={token}
        connect
        // The egress worker shouldn't publish anything; it's a viewer only.
        video={false}
        audio={false}
        // The egress JWT is scoped to the room; once connected we're ready.
        // RoomAudioRenderer is what feeds audio into the captured tab.
      >
        <CompositeGrid />

        {/* Brand watermark — embedded in the recorded MP4. Sits above the
            video grid but is non-interactive. */}
        <LogoWatermark className="top-4 left-4" size={56} />

        {/* Pipe audio so the recording has sound. */}
        <RoomAudioRenderer />

        {/* Tell the egress worker to start capturing. */}
        <RoomReadyBridge />
      </LiveKitRoom>
    </div>
  )
}

// Hooks into the LiveKitRoom's connection state so we only mark ready AFTER
// the room has actually joined. useConnectionState reads from the React
// context that <LiveKitRoom> provides, so it stays in sync with the actual
// Room object's state transitions.
function RoomReadyBridge() {
  const state = useConnectionState()
  if (state !== ConnectionState.Connected) return null
  return <ReadySignal />
}
