"use client"

// Picture-in-picture self-view for the teacher while they share their screen.
//
// The screen-share layout normally puts the teacher's camera in the left panel,
// but that panel is given over to a pinned student (and a pinned self shows the
// shared screen, not the camera). Whenever that happens the teacher loses sight
// of themselves mid-lesson — which matters more here than in a hearing
// classroom, because they are signing and need to check their own framing.
// This inset guarantees their own feed is on screen the whole time they share.

import { VideoTrack } from "@livekit/components-react"
import type { TrackReference } from "@livekit/components-react"
import { localCameraClassName } from "@/components/classroom/localCameraView"

export function SelfViewInset({ trackRef }: { trackRef: TrackReference }) {
  return (
    <div className="absolute bottom-3 right-3 z-30 w-32 sm:w-40 md:w-48 aspect-video rounded-xl overflow-hidden ring-2 ring-amber-400/80 shadow-2xl bg-zinc-900 pointer-events-none">
      <VideoTrack
        trackRef={trackRef}
        className={localCameraClassName(true, "w-full h-full object-cover")}
      />
      <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/80 to-transparent px-2 pb-0.5">
        <p className="text-[0.625rem] font-semibold text-white">You</p>
      </div>
    </div>
  )
}
