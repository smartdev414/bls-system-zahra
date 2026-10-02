"use client"

import { useEffect, useMemo, useState } from "react"
import { Users, UserPlus, Loader2, X, BellRing } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFetch, usePostCallback } from "@/hooks/use-fetch"
import { StudentPickerModal } from "@/components/classroom/StudentPickerModal"
import { levelColor, type CourseLevel } from "@/lib/levels"
import { toast } from "sonner"

type CourseStudent = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  bslLevel: string | null
  enrolledAt: string
  completedLessons: number
  testsPassed: number
  lastActiveAt: string | null
  /** Work outstanding and nothing done for a week (or ever). */
  behind: boolean
  lastRemindedAt: string | null
  reminderCount: number
}

type StudentsData = {
  students: CourseStudent[]
  total: number
  // Lessons and tests released to students so far — what progress is measured against.
  totalLessons: number
  totalTests: number
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`
}

/**
 * The students on a course: who is on it, how far each has got with the
 * lessons and tests released so far, who has fallen behind, and a one-click
 * reminder for them. Students are added one by one or a whole group at a time.
 *
 * Used on the course page (teachers, admins) and on the Support Team's
 * enrolments screen, which has its own way of adding students (`hideAdd`).
 */
export function CourseStudents({
  courseId,
  onTotalChange,
  hideAdd = false,
  refreshKey = 0,
}: {
  courseId: string
  /** Keeps a parent's "students enrolled" count in step with this list. */
  onTotalChange?: (total: number) => void
  hideAdd?: boolean
  /** Bump to reload after the parent changes who is on the course. */
  refreshKey?: number
}) {
  const url = `/api/tutor/courses/${courseId}/students`
  const { data, loading, refetch } = useFetch<StudentsData>(url, {
    errorMessage: "Could not load students",
    onSuccess: (d) => onTotalChange?.(d.total),
  })

  useEffect(() => {
    if (refreshKey > 0) void refetch()
  }, [refreshKey, refetch])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  // Student ids a reminder is being sent to right now.
  const [reminding, setReminding] = useState<Set<string>>(new Set())

  const students = data?.students ?? []
  const totalLessons = data?.totalLessons ?? 0
  const totalTests = data?.totalTests ?? 0
  const enrolledIds = useMemo(() => new Set((data?.students ?? []).map((s) => s.id)), [data])
  const behind = students.filter((s) => s.behind)

  const { execute: addStudents, loading: adding } = usePostCallback<
    { added: number; skipped: number },
    { studentIds: string[] }
  >(url, {
    successMessage: (d) =>
      d.added === 0
        ? "Those students are already on this course"
        : `${d.added} student${d.added === 1 ? "" : "s"} added to the course`,
    errorMessage: "Could not add students",
    onSuccess: () => { setPickerOpen(false); refetch() },
  })

  async function remind(targets: CourseStudent[]) {
    if (targets.length === 0) return
    setReminding(new Set(targets.map((s) => s.id)))
    try {
      const res = await fetch(`${url}/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: targets.map((s) => s.id) }),
      })
      const body = await res.json().catch(() => ({})) as { sent?: number; skipped?: number; message?: string }
      if (!res.ok) {
        toast.error(body.message ?? "Could not send the reminder")
        return
      }
      const sent = body.sent ?? 0
      const skipped = body.skipped ?? 0
      if (sent === 0) {
        toast.info(targets.length === 1 ? `${targets[0].name} was already reminded today` : "They were all reminded already today")
      } else {
        toast.success(
          `Reminder sent to ${sent === 1 && targets.length === 1 ? targets[0].name : `${sent} student${sent === 1 ? "" : "s"}`}` +
          (skipped > 0 ? ` (${skipped} already reminded today)` : ""),
        )
      }
      refetch()
    } catch {
      toast.error("Could not send the reminder")
    } finally {
      setReminding(new Set())
    }
  }

  async function removeStudent(student: CourseStudent) {
    const progressNote = student.completedLessons > 0
      ? ` Their progress (${student.completedLessons} completed lesson${student.completedLessons === 1 ? "" : "s"}) will be deleted.`
      : ""
    if (!window.confirm(`Remove ${student.name} from this course?${progressNote} This cannot be undone.`)) return

    setRemovingId(student.id)
    try {
      const res = await fetch(`${url}?studentId=${student.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string }
        toast.error(body.message ?? "Could not remove student")
        return
      }
      toast.success(`${student.name} removed from the course`)
      refetch()
    } catch {
      toast.error("Could not remove student")
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h2 className="font-bold flex items-center gap-2">
          <Users className="size-4 text-primary" /> Students
          {data && <Badge variant="outline" className="text-[10px]">{data.total}</Badge>}
          {behind.length > 0 && (
            <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">
              {behind.length} behind
            </Badge>
          )}
        </h2>
        <div className="flex gap-2">
          {behind.length > 0 && (
            <Button size="sm" variant="outline" disabled={reminding.size > 0} onClick={() => remind(behind)}>
              {reminding.size > 1 ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <BellRing className="size-4 mr-1.5" />}
              Remind {behind.length} behind
            </Button>
          )}
          {!hideAdd && (
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              <UserPlus className="size-4 mr-1.5" /> Add Students
            </Button>
          )}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : students.length === 0 ? (
        <Card className="shadow-sm border-dashed">
          <CardContent className="py-10 text-center">
            <Users className="size-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No students on this course yet. Add them one by one or pick a whole group.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm overflow-hidden py-0">
          <div className="divide-y max-h-96 overflow-y-auto">
            {students.map((student) => (
              <div key={student.id} className="flex items-center gap-2.5 px-3 sm:px-5 py-2.5 hover:bg-muted/20 transition-colors">
                <Avatar className="size-7 shrink-0">
                  {student.avatarUrl && <AvatarImage src={student.avatarUrl} alt={student.name} />}
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold text-[10px]">
                    {initials(student.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    <span className="truncate">{student.name}</span>
                    {student.behind && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0 bg-amber-100 text-amber-700 border-amber-200">
                        Behind
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {student.lastActiveAt ? `Last active ${daysAgo(student.lastActiveAt)}` : "No activity yet"}
                    {student.lastRemindedAt &&
                      ` · Reminded ${shortDate(student.lastRemindedAt)}${student.reminderCount > 1 ? ` (${student.reminderCount} times)` : ""}`}
                  </p>
                </div>
                {student.bslLevel && (
                  <Badge variant="outline" className={`text-[10px] h-5 px-1.5 shrink-0 hidden md:inline-flex ${levelColor[student.bslLevel as CourseLevel] ?? ""}`}>
                    {student.bslLevel}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline text-right">
                  {student.completedLessons}/{totalLessons} lessons
                  {totalTests > 0 && <><br />{student.testsPassed}/{totalTests} tests</>}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                  disabled={reminding.has(student.id)}
                  onClick={() => remind([student])}
                  title="Send a reminder to catch up"
                  aria-label={`Remind ${student.name}`}
                >
                  {reminding.has(student.id) ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-destructive hover:text-destructive"
                  disabled={removingId === student.id}
                  onClick={() => removeStudent(student)}
                  aria-label={`Remove ${student.name}`}
                >
                  {removingId === student.id ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {pickerOpen && (
        <StudentPickerModal
          selected={new Set()}
          excludeIds={enrolledIds}
          title="Add Students to Course"
          description="Choose individual students or pick a whole group. Students already on the course are not shown."
          confirmLabel="Add to Course"
          confirming={adding}
          onConfirm={(ids) => {
            if (ids.size === 0) {
              toast.error("Select at least one student")
              return
            }
            addStudents({ studentIds: [...ids] })
          }}
          onClose={() => { if (!adding) setPickerOpen(false) }}
        />
      )}
    </div>
  )
}
