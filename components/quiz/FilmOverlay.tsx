"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

// The dictionary's recorder: shows each word or question while it is filmed and
// stops by itself when the hands come back to rest. Browser only — it opens the camera.
const SignRecordingStudio = dynamic(
  () => import("@/components/admin/sign-recording-studio").then((m) => m.SignRecordingStudio),
  { ssr: false, loading: () => <Loader2 className="mx-auto mt-24 size-8 animate-spin text-primary" /> }
)

/** The recorder over the whole page, filming `items` in order; null keeps it closed. */
export function FilmOverlay({ items, onRecorded, onClose }: {
  items: { id: string; word: string }[] | null
  onRecorded: (id: string, fileUrl: string) => void
  onClose: () => void
}) {
  if (!items) return null
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background p-4 sm:p-6">
      <SignRecordingStudio words={items} onRecorded={onRecorded} onClose={onClose} />
    </div>
  )
}
