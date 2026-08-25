import Link from "next/link"
import { ChevronLeft, Wifi } from "lucide-react"
import { ConnectionCheckPanel } from "@/components/connection/ConnectionCheckPanel"

export const metadata = { title: "Connection check · BSL Learning Platform" }

export default function TutorConnectionCheckPage() {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <div>
        <Link
          href="/tutor/sessions"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-3.5" /> Back to Live Sessions
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-2xl font-black">
          <Wifi className="size-6 text-primary" /> Connection check
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Run this on the computer you&apos;ll teach from, or send the link to a student who
          can&apos;t get into class from work. It makes a real classroom connection and reports exactly
          what the network allows.
        </p>
      </div>
      <ConnectionCheckPanel />
    </div>
  )
}
