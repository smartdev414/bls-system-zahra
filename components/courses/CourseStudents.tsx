"use client"

import { useEffect } from "react"
import { Users, Loader2, BellRing } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { StudentProgressTable } from "@/components/courses/StudentProgressTable"
import { useCourseRoster } from "@/components/courses/use-course-roster"

/**
 * Everyone on a course in one list: how far each has got with the lessons and
 * tests released so far, who has fallen behind, and a one-click reminder.
 *
 * This is the Support Team's view, on the enrolments screen. The course page
 * shows the same students organised by group — see `CourseGroups`.
 */
export function CourseStudents({
  courseId,
  onTotalChange,
  refreshKey = 0,
}: {
  courseId: string
  /** Keeps a parent's "students enrolled" count in step with this list. */
  onTotalChange?: (total: number) => void
  /** Bump to reload after the parent changes who is on the course. */
  refreshKey?: number
}) {
  const roster = useCourseRoster(courseId, onTotalChange)
  const { data, loading, refetch } = roster

  useEffect(() => {
    if (refreshKey > 0) void refetch()
  }, [refreshKey, refetch])

  const students = data?.students ?? []
  const behind = students.filter((s) => s.behind)

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
        {behind.length > 0 && (
          <Button size="sm" variant="outline" disabled={roster.remindingIds.size > 0} onClick={() => roster.remind(behind)}>
            {roster.remindingIds.size > 1 ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <BellRing className="size-4 mr-1.5" />}
            Remind {behind.length} behind
          </Button>
        )}
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : students.length === 0 ? (
        <Card className="shadow-sm border-dashed">
          <CardContent className="py-10 text-center">
            <Users className="size-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No students on this course yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm overflow-hidden py-0">
          <div className="max-h-96 overflow-y-auto">
            <StudentProgressTable
              students={students}
              totalLessons={data?.totalLessons ?? 0}
              totalTests={data?.totalTests ?? 0}
              remindingIds={roster.remindingIds}
              removingId={roster.removingId}
              onRemind={(s) => roster.remind([s])}
              onRemove={(s) => void roster.remove(s)}
            />
          </div>
        </Card>
      )}
    </div>
  )
}
