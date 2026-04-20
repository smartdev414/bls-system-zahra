"use client"

import { useTracks, useLocalParticipant, AudioTrack } from "@livekit/components-react"
import { Track } from "livekit-client"

export function AudioRenderer() {
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true })
  const { localParticipant } = useLocalParticipant()
  return (
    <>
      {tracks
        .filter((t) => t.participant.identity !== localParticipant.identity)
        .map((t) => (
          <AudioTrack key={t.participant.identity} trackRef={t} />
        ))}
    </>
  )
}
