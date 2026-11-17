import { History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type AttemptSummary = { id: string; score: number; passed: boolean; createdAt: string }

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export function attemptsLeftText(left: number | null) {
  if (left === null) return null
  return left === 0 ? "No attempts left" : `${left} attempt${left !== 1 ? "s" : ""} left`
}

/** A student's own goes at a test, newest first. Shows nothing until there is one. */
export function AttemptHistory({ attempts }: { attempts: AttemptSummary[] }) {
  if (attempts.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <History className="size-3.5" /> Your attempts
      </p>
      <div className="rounded-xl border divide-y">
        {attempts.map((a, i) => (
          <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">
              Attempt {attempts.length - i} · {shortDate(a.createdAt)}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">{a.score}%</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[0.625rem]",
                  a.passed
                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                    : "bg-rose-100 text-rose-700 border-rose-200"
                )}
              >
                {a.passed ? "Passed" : "Not passed"}
              </Badge>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
