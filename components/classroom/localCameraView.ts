import { cn } from "@/lib/utils"
import { isTrackReference, type TrackReference, type TrackReferenceOrPlaceholder } from "@livekit/components-react"

/** Mirror the local camera so self-view matches a familiar mirror (signing, grooming). */
export function localCameraClassName(
  isLocal: boolean,
  base = "w-full h-full object-cover",
) {
  return cn(base, isLocal && "-scale-x-100")
}

/**
 * A camera that has been turned off stays published — LiveKit only mutes it —
 * so a track reference alone doesn't mean there is a picture. Rendering a muted
 * track draws an empty black frame where the initial placeholder should be,
 * which students read as "my camera is broken".
 */
export function isLiveVideo(
  t: TrackReferenceOrPlaceholder,
): t is TrackReference {
  return isTrackReference(t) && !t.publication.isMuted
}
