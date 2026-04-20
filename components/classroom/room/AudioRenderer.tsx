"use client"

import { useTracks, useLocalParticipant, AudioTrack } from "@livekit/components-react"
import { Track } from "livekit-client"

// `audibleIdentities` — when provided, only those identities are played out.
// Used during breakouts so students hear just their group-mates (and the tutor
// if they're visiting), and tutors hear only the group they're currently
// visiting. `null` → play everyone, the default full-room behaviour.
export function AudioRenderer({
  audibleIdentities,
}: {
  audibleIdentities?: Set<string> | null
} = {}) {
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true })
  const { localParticipant } = useLocalParticipant()
  return (
    <>
      {tracks
        .filter((t) => t.participant.identity !== localParticipant.identity)
        .filter((t) => !audibleIdentities || audibleIdentities.has(t.participant.identity))
        .map((t) => (
          <AudioTrack key={t.participant.identity} trackRef={t} />
        ))}
    </>
  )
}
