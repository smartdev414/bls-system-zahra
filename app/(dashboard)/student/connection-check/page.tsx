import Link from "next/link"
import { ChevronLeft, Wifi } from "lucide-react"
import { ConnectionCheckPanel } from "@/components/connection/ConnectionCheckPanel"

export const metadata = { title: "Connection check · BSL Learning Platform" }

export default function StudentConnectionCheckPage() {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <div>
        <Link
          href="/student/classroom"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-3.5" /> Back to Classroom
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-2xl font-black">
          <Wifi className="size-6 text-primary" /> Connection check
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Joining from work? Hospitals, police forces, schools and councils often lock their networks
          down. Run this on the computer you&apos;ll actually use for class, and we&apos;ll set it up to
          work — or tell you exactly what to ask your IT team for.
        </p>
      </div>
      <ConnectionCheckPanel />
    </div>
  )
}
