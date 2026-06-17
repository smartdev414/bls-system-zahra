"use client"

import { useTracks, useLocalParticipant, VideoTrack } from "@livekit/components-react"
import { Track } from "livekit-client"
import { Camera, Maximize2, Minimize2 } from "lucide-react"
import { localCameraClassName } from "@/components/classroom/localCameraView"

export function TutorVideoArea({
  containerRef,
  isFullscreen,
  onToggleFullscreen,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  isFullscreen: boolean
  onToggleFullscreen: () => void
}) {
  const camTracks    = useTracks([Track.Source.Camera],      { onlySubscribed: false })
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })
  const { localParticipant } = useLocalParticipant()

  const tutorCam    = camTracks.find((t) => t.participant.metadata === "tutor")
  const tutorScreen = screenTracks.find((t) => t.participant.metadata === "tutor")
  const active      = tutorScreen ?? tutorCam
  // Fit the whole frame (no crop) for both camera and screen share: the tutor's
  // full head and signing hands must stay visible, and a full-width main view
  // with object-cover would crop the top of the head off (BSL Deaf-first).
  // Mirror the local camera for self-view; never mirror a screen share.
  const isScreen    = !!tutorScreen
  const mirrorLocal = !isScreen && active?.participant.identity === localParticipant.identity

  return (
    <div ref={containerRef} className="relative w-full h-full bg-zinc-950 overflow-hidden group">
      {active ? (
        <VideoTrack
          trackRef={active}
          className={localCameraClassName(mirrorLocal, "w-full h-full object-contain")}
        />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700">
          <Camera className="size-14 opacity-20" />
          <span className="text-sm opacity-60">Waiting for tutor camera…</span>
        </div>
      )}

      {active && (
        <div className="absolute bottom-12 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full">
          {active.participant.name ?? active.participant.identity}
        </div>
      )}

      <button
        onClick={onToggleFullscreen}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70 text-white rounded-lg p-1.5 backdrop-blur-sm"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  )
}
