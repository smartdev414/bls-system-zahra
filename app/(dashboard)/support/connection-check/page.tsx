import Link from "next/link"
import { ChevronLeft, Wifi } from "lucide-react"
import { ConnectionCheckPanel } from "@/components/connection/ConnectionCheckPanel"

export const metadata = { title: "Connection check · BSL Learning Platform" }

export default function SupportConnectionCheckPage() {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <div>
        <Link
          href="/support"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-3.5" /> Back to dashboard
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-2xl font-black">
          <Wifi className="size-6 text-primary" /> Connection check
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Run this with a student or tutor on the phone — it makes a real classroom
          connection, tests their camera and microphone, and reports exactly what their
          network allows.
        </p>
      </div>
      <ConnectionCheckPanel />
    </div>
  )
}
