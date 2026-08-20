"use client"

// Shows just the tutor's camera feed during PPT split-screen mode so students
// can read BSL signs alongside slides.

import { useTracks, useLocalParticipant, VideoTrack } from "@livekit/components-react"
import { Track } from "livekit-client"
import { Camera, Users2 } from "lucide-react"
import { localCameraClassName } from "@/components/classroom/localCameraView"

// `hidden` is set for a student whose breakout group the tutor has not joined:
// the tutor is elsewhere, so this slot shows where they are instead of a feed.
// `breakoutGroupName` names the student's own group when they're in one, so the
// placeholder explains the situation rather than just showing a blank panel.
export function TutorCameraInset({
  hidden = false,
  breakoutGroupName = null,
}: {
  hidden?: boolean
  breakoutGroupName?: string | null
}) {
  const camTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const { localParticipant } = useLocalParticipant()
  // With a co-teacher in the room there are two "tutor" cameras. A teacher must
  // always see their own feed here — otherwise a teacher who is screen-sharing
  // (this panel is the only camera on screen in that layout) ends up watching
  // their colleague instead of themselves.
  const tutorCams = camTracks.filter((t) => t.participant.metadata === "tutor")
  const tutorCam  =
    tutorCams.find((t) => t.participant.identity === localParticipant.identity) ?? tutorCams[0]
  const name      = tutorCam?.participant.name ?? tutorCam?.participant.identity ?? "Tutor"
  const mirrorLocal = tutorCam?.participant.identity === localParticipant.identity

  if (hidden) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 bg-zinc-900 text-zinc-600 px-3 text-center">
        <Users2 className="size-8 opacity-20" />
        {breakoutGroupName ? (
          <>
            <span className="text-xs font-semibold text-zinc-400">
              You&apos;re in {breakoutGroupName}
            </span>
            <span className="text-[11px] opacity-60 max-w-52">
              Turn your camera on — your group appears here, and the lesson stays on the right.
            </span>
          </>
        ) : (
          <span className="text-xs opacity-60">
            Tutor isn&apos;t in your group right now
          </span>
        )}
      </div>
    )
  }

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
