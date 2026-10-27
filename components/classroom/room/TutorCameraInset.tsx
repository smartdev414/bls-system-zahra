"use client"

// Shows just the tutor's camera feed during PPT split-screen mode so students
// can read BSL signs alongside slides.

import { useTracks, useLocalParticipant, useParticipants } from "@livekit/components-react"
import { Track } from "livekit-client"
import { Camera, Users2 } from "lucide-react"
import { BreakoutSelfStage } from "./BreakoutSelfStage"
import { TutorFeed } from "./TutorVideoArea"

// `hidden` is set for a student whose breakout group the tutor has not joined:
// the tutor is elsewhere, so this slot shows where they are instead of a feed.
// `breakoutGroupName` names the student's own group when they're in one, so the
// placeholder explains the situation rather than just showing a blank panel.
// `preferIdentity` is the teacher to show when there are two — the one sharing
// their screen, so the class reads the signer next to what they are explaining.
export function TutorCameraInset({
  hidden = false,
  breakoutGroupName = null,
  preferIdentity = null,
}: {
  hidden?: boolean
  breakoutGroupName?: string | null
  preferIdentity?: string | null
}) {
  const camTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const { localParticipant } = useLocalParticipant()
  // With a co-teacher in the room there are two "tutor" cameras. The sharing
  // teacher wins: students used to get whichever teacher joined first, so a
  // co-teacher explaining their own screen was left signing in a small tile.
  // Otherwise a teacher sees their own feed, and a student the first teacher.
  const tutorCams = camTracks.filter((t) => t.participant.metadata === "tutor")
  const tutorCam  =
    (preferIdentity ? tutorCams.find((t) => t.participant.identity === preferIdentity) : undefined) ??
    tutorCams.find((t) => t.participant.identity === localParticipant.identity) ??
    tutorCams[0]
  const name      = tutorCam?.participant.name ?? tutorCam?.participant.identity ?? "Tutor"
  const mirrorLocal = tutorCam?.participant.identity === localParticipant.identity
  // "Camera off" was shown for a tutor who had left the room altogether.
  const tutorPresent = useParticipants().some((p) => p.metadata === "tutor")

  if (hidden) {
    // In a breakout the slot belongs to the student's own group: show their own
    // camera (and the switch to turn it on) rather than an explanation they
    // can't act on without going looking for their tile.
    if (breakoutGroupName) {
      return <BreakoutSelfStage groupName={breakoutGroupName} compact />
    }
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 bg-zinc-900 text-zinc-600 px-3 text-center">
        <Users2 className="size-8 opacity-20" />
        <span className="text-xs opacity-60">
          Tutor isn&apos;t in your group right now
        </span>
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
          <TutorFeed
            trackRef={tutorCam}
            mirror={mirrorLocal}
            isScreen={false}
            isSelf={tutorCam.participant.identity === localParticipant.identity}
          />
          {/* Bottom-left: top-left sat under the room's logo watermark. */}
          <div className="absolute bottom-2 left-2 bg-amber-500/80 text-black text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm">
            BSL · {name}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
          <Camera className="size-8 opacity-20" />
          <span className="text-xs opacity-70 text-center px-2">
            {tutorPresent ? "Tutor camera off" : "Waiting for the tutor to join…"}
          </span>
        </div>
      )}
    </div>
  )
}
