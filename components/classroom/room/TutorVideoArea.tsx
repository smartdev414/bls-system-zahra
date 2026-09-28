"use client"

import { useTracks, useLocalParticipant, useIsMuted, useParticipants, VideoTrack } from "@livekit/components-react"
import type { TrackReference } from "@livekit/components-react"
import { Track } from "livekit-client"
import { Camera, CameraOff, Maximize2, Minimize2 } from "lucide-react"
import { localCameraClassName } from "@/components/classroom/localCameraView"
import { OwnScreenShare } from "./OwnScreenShare"

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

  // With a co-teacher in the room there are two "tutor" feeds. A teacher must
  // always see their own on the main stage — otherwise a teacher who joins a
  // breakout group (where this view is the only camera on screen) ends up
  // watching their colleague instead of themselves. Students have no local
  // tutor feed, so they fall through to the first one as before.
  const preferLocal = <T extends { participant: { identity: string; metadata?: string } }>(tracks: T[]) => {
    const tutors = tracks.filter((t) => t.participant.metadata === "tutor")
    return tutors.find((t) => t.participant.identity === localParticipant.identity) ?? tutors[0]
  }

  const tutorCam    = preferLocal(camTracks)
  const tutorScreen = preferLocal(screenTracks)
  const active      = tutorScreen ?? tutorCam
  // Fit the whole frame (no crop) for both camera and screen share: the tutor's
  // full head and signing hands must stay visible, and a full-width main view
  // with object-cover would crop the top of the head off (BSL Deaf-first).
  // Mirror the local camera for self-view; never mirror a screen share.
  const isScreen    = !!tutorScreen
  const mirrorLocal = !isScreen && active?.participant.identity === localParticipant.identity
  // Tells "the teacher isn't here yet" apart from "the teacher is here with no
  // camera published" — the old single message blamed the camera for both.
  const tutorPresent = useParticipants().some((p) => p.metadata === "tutor")

  return (
    <div ref={containerRef} className="relative w-full h-full bg-zinc-950 overflow-hidden group">
      {active ? (
        <TutorFeed
          trackRef={active}
          mirror={mirrorLocal}
          isScreen={isScreen}
          isSelf={active.participant.identity === localParticipant.identity}
        />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500">
          <Camera className="size-14 opacity-30" />
          <span className="text-sm">
            {tutorPresent ? "Waiting for the tutor's camera…" : "Waiting for the tutor to join…"}
          </span>
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

// A camera that is switched off stays published, just muted — rendered as-is it
// is a black rectangle, which in a signed lesson reads as a frozen or broken
// feed. Say what is actually happening instead.
export function TutorFeed({
  trackRef,
  mirror,
  isScreen,
  isSelf,
}: {
  trackRef: TrackReference
  mirror: boolean
  isScreen: boolean
  isSelf: boolean
}) {
  const muted = useIsMuted(trackRef)
  if (isScreen && isSelf) return <OwnScreenShare trackRef={trackRef} />
  if (muted && !isScreen) {
    const name = trackRef.participant.name || "The tutor"
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400">
        <CameraOff className="size-12 opacity-60" />
        <span className="text-sm">
          {isSelf ? "Your camera is off — students can't see you" : `${name} has turned their camera off`}
        </span>
      </div>
    )
  }
  return (
    <VideoTrack
      trackRef={trackRef}
      className={localCameraClassName(mirror, "w-full h-full object-contain")}
    />
  )
}
