"use client"

// Shows just the tutor's camera feed during PPT split-screen mode so students
// can read BSL signs alongside slides.

import { useTracks, useLocalParticipant, VideoTrack } from "@livekit/components-react"
import { Track } from "livekit-client"
import { Camera } from "lucide-react"
import { localCameraClassName } from "@/components/classroom/localCameraView"

export function TutorCameraInset() {
  const camTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const { localParticipant } = useLocalParticipant()
  const tutorCam  = camTracks.find((t) => t.participant.metadata === "tutor")
  const name      = tutorCam?.participant.name ?? tutorCam?.participant.identity ?? "Tutor"
  const mirrorLocal = tutorCam?.participant.identity === localParticipant.identity

  return (
    <div className="relative w-full h-full bg-zinc-900 overflow-hidden">
      {tutorCam ? (
        <>
          {/* Fit the whole frame (no crop) so the tutor's full head and signing
              hands stay visible regardless of panel width; self-view is mirrored.
              object-cover would crop the head off when this view is full-width. */}
          <VideoTrack
            trackRef={tutorCam}
            className={localCameraClassName(mirrorLocal, "w-full h-full object-contain")}
          />
          <div className="absolute top-2 left-2 bg-amber-500/80 text-black text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm">
            BSL · {name}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
          <Camera className="size-8 opacity-20" />
          <span className="text-xs opacity-50 text-center px-2">Tutor camera off</span>
        </div>
      )}
    </div>
  )
}
