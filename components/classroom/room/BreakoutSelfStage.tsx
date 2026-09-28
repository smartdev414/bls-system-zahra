"use client"

// What a student sees on the stage inside a breakout group before anybody
// else's camera is up — most often right after rejoining, when their group-mates
// haven't reconnected yet.
//
// It used to be text only ("turn on your camera"), which left the student
// hunting through the participants strip for their own tile to check they were
// even on. So the stage shows their own camera the moment it is live, and
// offers the switch itself when it isn't: the camera is always one click away,
// wherever they are in the room.

import { useState } from "react"
import { useLocalParticipant, useTracks, VideoTrack } from "@livekit/components-react"
import { Track } from "livekit-client"
import { Camera, Users2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { localCameraClassName, isLiveVideo } from "@/components/classroom/localCameraView"
import { writeDevicePreference } from "@/components/classroom/devicePreference"

export function BreakoutSelfStage({
  groupName,
  compact = false,
}: {
  groupName: string
  /** Half-stage variant, used beside slides / a whiteboard / a shared screen. */
  compact?: boolean
}) {
  const { localParticipant } = useLocalParticipant()
  const camTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const [busy, setBusy] = useState(false)

  const ownCam = camTracks.find(
    (t) => t.participant.identity === localParticipant.identity && isLiveVideo(t),
  )

  const enableCamera = async () => {
    setBusy(true)
    try {
      await localParticipant.setCameraEnabled(true)
      // So a reload or rejoin brings the camera back on, as the controls bar does.
      writeDevicePreference("camera", true)
    } catch {
      /* Permission denied or no device — the controls bar reports it too. */
    } finally {
      setBusy(false)
    }
  }

  if (ownCam) {
    return (
      <div className="relative w-full h-full bg-zinc-900 overflow-hidden">
        <VideoTrack
          trackRef={ownCam}
          className={localCameraClassName(true, "w-full h-full object-contain")}
        />
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
          <Users2 className="size-3 text-primary" />
          {groupName} · You
        </div>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-zinc-400 bg-black/60 rounded-full px-3 py-1 backdrop-blur-sm whitespace-nowrap">
          Waiting for your group — they&apos;ll appear here when their cameras are on
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      "flex flex-col items-center justify-center w-full h-full text-zinc-400 text-center bg-zinc-900",
      compact ? "gap-2 px-3" : "gap-3 px-6",
    )}>
      <Users2 className={cn("opacity-30", compact ? "size-8" : "size-12")} />
      <p className={cn("font-semibold text-zinc-200", compact ? "text-xs" : "text-sm")}>
        You&apos;re in {groupName}
      </p>
      <button
        onClick={() => { void enableCamera() }}
        disabled={busy}
        className={cn(
          "flex items-center gap-1.5 rounded-xl font-semibold bg-primary text-white hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-wait",
          compact ? "px-3 h-8 text-xs" : "px-4 h-10 text-sm",
        )}
      >
        <Camera className={compact ? "size-3.5" : "size-4"} />
        {busy ? "Starting camera…" : "Turn on my camera"}
      </button>
      <p className={cn("text-zinc-500 max-w-sm", compact ? "text-[11px]" : "text-xs")}>
        Your group-mates appear here as soon as their cameras are on.
      </p>
    </div>
  )
}
