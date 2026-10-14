import Link from "next/link"
import { Clock, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Dashboard nudge: people signed up and are waiting for staff to approve them. */
export function AwaitingApprovalBanner({ count, href }: { count: number | undefined; href: string }) {
  if (!count) return null
  return (
    <div className="flex items-center gap-4 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/50">
        <Clock className="size-5 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold">
          {count} {count === 1 ? "person is" : "people are"} waiting for approval
        </p>
        <p className="text-sm opacity-80">They can&apos;t use the platform until you approve them.</p>
      </div>
      <Button asChild size="sm" className="shrink-0">
        <Link href={href}>Review <ArrowRight className="size-3.5 ml-1" /></Link>
      </Button>
    </div>
  )
}
