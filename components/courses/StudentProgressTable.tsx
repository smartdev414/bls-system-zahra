"use client"

import { BellRing, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export type CourseStudent = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  bslLevel: string | null
  enrolledAt: string
  completedLessons: number
  testsPassed: number
  lastActiveAt: string | null
  /** Work outstanding and nothing done for a week, or since joining a week or more ago. */
  behind: boolean
  lastRemindedAt: string | null
  reminderCount: number
}

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
const COLUMNS = "grid-cols-[minmax(0,1fr)_7rem] @xl:grid-cols-[minmax(0,1fr)_7.5rem_4.5rem_7rem_7rem]"

/**
 * Students with their homework progress, one per row, under plain column
 * headings — who they are, how many lessons and tests they have done out of
 * those released so far, when they were last active, and a reminder button.
 */
export function StudentProgressTable({
  students,
  totalLessons,
  totalTests,
  remindingIds,
  removingId,
  onRemind,
  onRemove,
}: {
  students: CourseStudent[]
  totalLessons: number
  totalTests: number
  remindingIds: Set<string>
  removingId: string | null
  onRemind: (student: CourseStudent) => void
  /** Left out for someone who may not take students off the course. */
  onRemove?: (student: CourseStudent) => void
}) {
  return (
    // Sized by its own width, not the screen's: in a narrow column the progress
    // columns fold into one line under the student's name.
    <div className="@container">
      <div className={`hidden @xl:grid ${COLUMNS} items-center gap-3 px-4 py-2 border-b bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground`}>
        <span>Student</span>
        <span>Lessons done</span>
        <span>Tests</span>
        <span>Last active</span>
        <span className="sr-only">Actions</span>
      </div>

      <div className="divide-y">
        {students.map((student) => {
          const pct = totalLessons > 0 ? Math.round((student.completedLessons / totalLessons) * 100) : 0
          return (
            <div key={student.id} className={`grid ${COLUMNS} items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="size-7 shrink-0">
                  {student.avatarUrl && <AvatarImage src={student.avatarUrl} alt={student.name} />}
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold text-[10px]">
                    {initials(student.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <span className="truncate">{student.name}</span>
                    {student.behind && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0 bg-amber-100 text-amber-700 border-amber-200">
                        Behind
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                  <p className="@xl:hidden text-xs text-muted-foreground truncate">
                    {totalLessons > 0 ? `${student.completedLessons} of ${totalLessons} lessons` : "No lessons yet"}
                    {totalTests > 0 ? ` · ${student.testsPassed} of ${totalTests} tests` : ""}
                  </p>
                </div>
              </div>

              {totalLessons > 0 ? (
                <div className="hidden @xl:flex flex-col gap-1">
                  <span className="text-xs">{student.completedLessons} of {totalLessons}</span>
                  <Progress value={pct} className="h-1.5" />
                </div>
              ) : (
                <span className="hidden @xl:block text-xs text-muted-foreground">No lessons yet</span>
              )}

              <span className="hidden @xl:block text-xs">
                {totalTests > 0 ? `${student.testsPassed} of ${totalTests}` : "—"}
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
                  className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  disabled={remindingIds.has(student.id)}
                  onClick={() => onRemind(student)}
                  aria-label={`Remind ${student.name}`}
                  title="Send a reminder to catch up on lessons and tests"
                >
                  {remindingIds.has(student.id) ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
                  Remind
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
          )
        })}
      </div>
    </div>
  )
}
