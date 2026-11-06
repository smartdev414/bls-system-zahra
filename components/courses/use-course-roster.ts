"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useFetch } from "@/hooks/use-fetch"
import type { CourseStudent } from "@/components/courses/StudentProgressTable"

export type RosterData = {
  students: CourseStudent[]
  total: number
  // Lessons and tests released to students so far — what progress is measured against.
  totalLessons: number
  totalTests: number
  /** The class's average progress, 0–100. */
  classAverage: number
}

/**
 * The students on a course and the two things done to them from a list:
 * reminding them to catch up, and taking them off the course. Shared by every
 * screen that shows the course's students, so they behave the same everywhere.
 */
export function useCourseRoster(courseId: string, onTotalChange?: (total: number) => void) {
  const url = `/api/tutor/courses/${courseId}/students`
  const { data, loading, refetch } = useFetch<RosterData>(url, {
    errorMessage: "Could not load students",
    onSuccess: (d) => onTotalChange?.(d.total),
  })

  // Student ids a reminder is being sent to right now.
  const [remindingIds, setRemindingIds] = useState<Set<string>>(new Set())
  const [removingId, setRemovingId] = useState<string | null>(null)
  // Student ids a trophy is being given to right now.
  const [trophyIds, setTrophyIds] = useState<Set<string>>(new Set())

  async function giveTrophy(targets: CourseStudent[]) {
    if (targets.length === 0) return
    setTrophyIds(new Set(targets.map((s) => s.id)))
    try {
      const res = await fetch(`${url}/trophy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: targets.map((s) => s.id) }),
      })
      const body = await res.json().catch(() => ({})) as { given?: number; message?: string }
      if (!res.ok) {
        toast.error(body.message ?? "Could not give the trophy")
        return
      }
      const given = body.given ?? 0
      if (given === 0) {
        toast.info(targets.length === 1 ? `${targets[0].name} already got a trophy today` : "They all got a trophy today already")
      } else {
        toast.success(`🏆 Trophy sent to ${given === 1 && targets.length === 1 ? targets[0].name : `${given} students`}`)
      }
      void refetch()
    } catch {
      toast.error("Could not give the trophy")
    } finally {
      setTrophyIds(new Set())
    }
  }

  async function remind(targets: CourseStudent[]) {
    if (targets.length === 0) return
    setRemindingIds(new Set(targets.map((s) => s.id)))
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
      void refetch()
    } catch {
      toast.error("Could not send the reminder")
    } finally {
      setRemindingIds(new Set())
    }
  }

  /** Resolves true when the student was removed. */
  async function remove(student: CourseStudent): Promise<boolean> {
    const progressNote = student.completedLessons > 0
      ? ` Their progress (${student.completedLessons} completed lesson${student.completedLessons === 1 ? "" : "s"}) will be deleted.`
      : ""
    if (!window.confirm(`Remove ${student.name} from this course?${progressNote} This cannot be undone.`)) return false

    setRemovingId(student.id)
    try {
      const res = await fetch(`${url}?studentId=${student.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string }
        toast.error(body.message ?? "Could not remove student")
        return false
      }
      toast.success(`${student.name} removed from the course`)
      void refetch()
      return true
    } catch {
      toast.error("Could not remove student")
      return false
    } finally {
      setRemovingId(null)
    }
  }

  return { url, data, loading, refetch, remind, remove, giveTrophy, remindingIds, removingId, trophyIds }
}
