"use client"

import { useRef } from "react"
import { mediaSrc } from "@/lib/protected-media"

// ProtectedVideo
// ──────────────
// `<video>` for anything a tutor or the school uploaded. Use it instead of a
// raw tag so every player gets the same treatment:
//
// • `src` is routed through /api/media, so the file is only served to a
//   signed-in viewer who is allowed to have it (see lib/protected-media.ts).
// • No download button, no cast/PiP hand-off, no right-click "Save video as" —
//   unless `allowDownload` is set, which is for tutors only. These only remove
//   the easy routes — the access check is the real control.
// • The signed URL behind /api/media expires. A seek after that fails as a
//   network error, so we reload once at the same position to pick up a fresh
//   one instead of leaving the viewer on a dead player.

type Props = Omit<React.ComponentProps<"video">, "src" | "controlsList"> & {
  src: string
  /** Tutors may save a copy; leave off for students. */
  allowDownload?: boolean
}

const RECOVERY_COOLDOWN_MS = 60_000

export function ProtectedVideo({
  src,
  allowDownload = false,
  onError,
  onContextMenu,
  ...props
}: Props) {
  const lastRecoveryRef = useRef(0)

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    const expired = v.error?.code === MediaError.MEDIA_ERR_NETWORK
    if (expired && Date.now() - lastRecoveryRef.current > RECOVERY_COOLDOWN_MS) {
      lastRecoveryRef.current = Date.now()
      const at = v.currentTime
      const wasPlaying = !v.paused
      v.load()
      v.currentTime = at
      if (wasPlaying) v.play().catch(() => { /* needs a user gesture — controls still work */ })
      return
    }
    onError?.(e)
  }

  return (
    <video
      {...props}
      src={mediaSrc(src)}
      controlsList={allowDownload ? "noremoteplayback" : "nodownload noremoteplayback"}
      disablePictureInPicture
      onError={handleError}
      onContextMenu={(e) => {
        if (!allowDownload) e.preventDefault()
        onContextMenu?.(e)
      }}
    />
  )
}
