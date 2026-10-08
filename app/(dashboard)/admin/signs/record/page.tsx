"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

// Browser only: the studio opens the camera and reads its saved settings from
// localStorage on its first render.
const SignRecordingStudio = dynamic(
  () => import("@/components/admin/sign-recording-studio").then((m) => m.SignRecordingStudio),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    ),
  }
)

export default function AdminSignsRecordPage() {
  return <SignRecordingStudio />
}
