"use client"

import { BellRing, Loader2, Trophy, X } from "lucide-react"
import type { RosterStudent } from "@/lib/course-roster"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

/** One student on the course, as the roster API sends it (see lib/course-roster.ts). */
export type CourseStudent = RosterStudent

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function lastActive(iso: string | null) {
  if (!iso) return "Not started"
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`
}

// Fixed widths (not `auto`) so the headings sit exactly over their columns.
const COLUMNS = "grid-cols-[minmax(0,1fr)_auto] @xl:grid-cols-[1.75rem_minmax(0,1fr)_8rem_4rem_4rem_7rem_9.5rem]"

const MEDALS = ["🥇", "🥈", "🥉"]

/** The student's place in the class: a medal for the top three, then a number. */
function Place({ student }: { student: CourseStudent }) {
  // Nobody is "last" before they have started: no place until they do something.
  if (student.percent === 0) return <span className="text-xs text-muted-foreground/60" title="Not started yet">–</span>
  if (student.rank <= 3) {
    return <span className="text-lg leading-none" title={`${ordinal(student.rank)} in the class`}>{MEDALS[student.rank - 1]}</span>
  }
  return <span className="text-xs font-semibold text-muted-foreground" title={`${ordinal(student.rank)} in the class`}>{student.rank}</span>
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const badge = "text-[10px] h-4 px-1 shrink-0"

/**
 * The class at a glance, best first: each student's place, how much of what has
 * been released they have done, when they were last active — and one click to
 * give a trophy or send a reminder. Students well behind the rest of the class
 * are marked, and their reminder is a kind "you can catch up" note.
 */
export function StudentProgressTable({
  students,
  totalLessons,
  totalTests,
  remindingIds,
  trophyIds,
  removingId,
  onRemind,
  onTrophy,
  onRemove,
}: {
  students: CourseStudent[]
  totalLessons: number
  totalTests: number
  remindingIds: Set<string>
  /** Student ids a trophy is being given to right now. */
  trophyIds: Set<string>
  removingId: string | null
  onRemind: (student: CourseStudent) => void
  onTrophy: (student: CourseStudent) => void
  /** Left out for someone who may not take students off the course. */
  onRemove?: (student: CourseStudent) => void
}) {
  const ranked = [...students].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  const work = totalLessons + totalTests
  return (
    // Sized by its own width, not the screen's: in a narrow column the progress
    // columns fold into one line under the student's name.
    <div className="@container">
      <div className={`hidden @xl:grid ${COLUMNS} items-center gap-3 px-4 py-2 border-b bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground`}>
        <span title="Place in the class">#</span>
        <span>Student</span>
        <span>Progress</span>
        <span>Lessons</span>
        <span>Tests</span>
        <span>Last active</span>
        <span className="sr-only">Actions</span>
      </div>

      <div className="divide-y">
        {ranked.map((student) => (
          <div
            key={student.id}
            className={`grid ${COLUMNS} items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors ${student.behindClass ? "bg-amber-50/60" : ""}`}
            data-student={student.name}
          >
            <div className="hidden @xl:flex justify-center"><Place student={student} /></div>

            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar className="size-7 shrink-0">
                {student.avatarUrl && <AvatarImage src={student.avatarUrl} alt={student.name} />}
                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-[10px]">
                  {initials(student.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                  {student.percent > 0 && student.rank <= 3 && (
                    <span className="@xl:hidden"><Place student={student} /></span>
                  )}
                  <span className="truncate">{student.name}</span>
                  {student.trophies > 0 && (
                    <Badge
                      variant="outline"
                      className={`${badge} gap-0.5 bg-amber-100 text-amber-800 border-amber-200`}
                      title={`${student.trophies} trophy${student.trophies === 1 ? "" : "s"} on this course${student.lastTrophyAt ? ` — last ${shortDate(student.lastTrophyAt)}` : ""}`}
                    >
                      🏆{student.trophies > 1 ? ` ×${student.trophies}` : ""}
                    </Badge>
                  )}
                  {student.allDone ? (
                    <Badge variant="outline" className={`${badge} bg-emerald-100 text-emerald-700 border-emerald-200`}>
                      All done
                    </Badge>
                  ) : student.behindClass ? (
                    <Badge
                      variant="outline"
                      className={`${badge} bg-amber-100 text-amber-700 border-amber-200`}
                      title="Well behind the rest of the class"
                    >
                      Behind the class
                    </Badge>
                  ) : student.inactive ? (
                    <Badge
                      variant="outline"
                      className={`${badge} bg-amber-100 text-amber-700 border-amber-200`}
                      title="Work to do and nothing done for a week"
                    >
                      Not active
                    </Badge>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                <p className="@xl:hidden text-xs text-muted-foreground truncate">
                  {work > 0 ? `${student.percent}% done` : "Nothing released yet"}
                  {totalLessons > 0 ? ` · ${student.completedLessons}/${totalLessons} lessons` : ""}
                  {totalTests > 0 ? ` · ${student.testsDone}/${totalTests} tests` : ""}
                </p>
              </div>
            </div>

            {work > 0 ? (
              <div className="hidden @xl:flex flex-col gap-1">
                <span className="text-xs font-medium">{student.percent}%</span>
                <Progress
                  value={student.percent}
                  className={`h-1.5 ${student.allDone ? "[&>div]:bg-emerald-500" : student.behindClass ? "[&>div]:bg-amber-500" : ""}`}
                />
              </div>
            ) : (
              <span className="hidden @xl:block text-xs text-muted-foreground">Nothing yet</span>
            )}

            <span className="hidden @xl:block text-xs">
              {totalLessons > 0 ? `${student.completedLessons}/${totalLessons}` : "—"}
            </span>

            <span className="hidden @xl:block text-xs">
              {totalTests > 0 ? `${student.testsDone}/${totalTests}` : "—"}
            </span>

            <div className="hidden @xl:block text-xs">
              <span className={student.lastActiveAt ? "" : "text-muted-foreground"}>{lastActive(student.lastActiveAt)}</span>
              {student.lastRemindedAt && (
                <span className="block text-[11px] text-muted-foreground">
                  Reminded {shortDate(student.lastRemindedAt)}
                  {student.reminderCount > 1 ? ` (×${student.reminderCount})` : ""}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 justify-end">
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-2 text-xs gap-1 ${student.trophyDue ? "text-amber-600 hover:text-amber-700" : "text-muted-foreground hover:text-amber-600"}`}
                disabled={trophyIds.has(student.id)}
                onClick={() => onTrophy(student)}
                aria-label={`Give ${student.name} a trophy`}
                title="Give a trophy for their hard work (they get one automatically when they finish everything)"
              >
                {trophyIds.has(student.id) ? <Loader2 className="size-3.5 animate-spin" /> : <Trophy className="size-3.5" />}
                <span className="hidden @xl:inline">Trophy</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-2 text-xs gap-1 ${student.behindClass ? "text-amber-700 hover:text-amber-800" : "text-muted-foreground hover:text-foreground"}`}
                disabled={remindingIds.has(student.id) || student.allDone}
                onClick={() => onRemind(student)}
                aria-label={`Remind ${student.name}`}
                title={student.allDone
                  ? "Nothing to catch up on"
                  : student.behindClass
                  ? "Send a kind note: they are behind the class but can catch up — revise and finish their tests"
                  : "Send a reminder to catch up on lessons and tests"}
              >
                {remindingIds.has(student.id) ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
                <span className="hidden @xl:inline">{student.behindClass ? "Encourage" : "Remind"}</span>
              </Button>
              {onRemove && <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                disabled={removingId === student.id}
                onClick={() => onRemove(student)}
                aria-label={`Remove ${student.name}`}
                title="Remove from this course"
              >
                {removingId === student.id ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
              </Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
