"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

// The dictionary's recorder: shows each word or question while it is filmed and
// stops by itself when the hands come back to rest. Browser only — it opens the camera.
const SignRecordingStudio = dynamic(
  () => import("@/components/admin/sign-recording-studio").then((m) => m.SignRecordingStudio),
  { ssr: false, loading: () => <Loader2 className="mx-auto mt-24 size-8 animate-spin text-primary" /> }
)

/**
 * The recorder in a medium-size window over the page, filming `items` in
 * order; null keeps it closed. Not full screen: on a big monitor that made the
 * camera far larger than the tutor wanted to sign into. It only closes from
 * its Done button, so a take still uploading is never lost to a stray click.
 */
export function FilmOverlay({ items, onRecorded, onClose }: {
  items: { id: string; word: string }[] | null
  onRecorded: (id: string, fileUrl: string) => void
  onClose: () => void
}) {
  if (!items) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-6">
      <div role="dialog" aria-modal="true" aria-label="Film your signs"
        className="max-h-full w-full max-w-4xl overflow-y-auto rounded-2xl border bg-background p-4 shadow-2xl sm:p-6">
        <SignRecordingStudio words={items} onRecorded={onRecorded} onClose={onClose} />
      </div>
    </div>
  )
}
