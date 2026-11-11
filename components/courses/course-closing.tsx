"use client"

import { useState } from "react"
import { CalendarX2, ChevronDown, DoorClosed, DoorOpen, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePutCallback } from "@/hooks/use-fetch"
import { isCourseClosed } from "@/lib/course-closing"

/**
 * Course open / closed (lib/course-closing.ts). Sits with Publish and Private
 * on the course page: close the course now, or pick the last day and it closes
 * itself that night. Students then lose access to it, and anyone whose courses
 * have all finished can no longer use the student space.
 */

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
}

/** yyyy-mm-dd for a date input, in the browser's time. */
function dateValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The end of that day, so students keep the whole last day. */
function endOfDay(value: string): string {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, m - 1, d, 23, 59, 0, 0).toISOString()
}

/** "Closed" or "Closes 19 Dec" beside the course's other badges. */
export function CourseClosedBadge({ closesAt }: { closesAt: string | null }) {
  if (!closesAt) return null
  return isCourseClosed({ closesAt }) ? (
    <Badge variant="outline" className="bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200">
      <DoorClosed className="size-3 mr-1" /> Closed
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      <CalendarX2 className="size-3 mr-1" /> Closes {new Date(closesAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
    </Badge>
  )
}

export function CourseClosingButton({
  courseId,
  closesAt,
  onSaved,
}: {
  courseId: string
  closesAt: string | null
  onSaved: (closesAt: string | null) => void
}) {
  const closed = isCourseClosed({ closesAt })
  const [dialog, setDialog] = useState<"now" | "date" | null>(null)
  const [day, setDay] = useState("")

  const { execute, loading } = usePutCallback<{ course: { closesAt: string | null } }, { closesAt: string | null }>(
    `/api/tutor/courses/${courseId}`,
    {
      successMessage: (d) => !d.course.closesAt
        ? "Course is open — students can use it again"
        : isCourseClosed(d.course)
        ? "Course closed — students can no longer open it"
        : `Course will close at the end of ${dayLabel(d.course.closesAt)}`,
      errorMessage: "Could not change when the course closes",
      onSuccess: (d) => { setDialog(null); onSaved(d.course.closesAt) },
    },
  )

  const label = closed ? "Closed" : closesAt ? `Closes ${new Date(closesAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Open"
  const Icon = closed ? DoorClosed : DoorOpen

  function openDatePicker() {
    const suggestion = closesAt ? new Date(closesAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    setDay(dateValue(suggestion))
    setDialog("date")
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={loading} aria-label={`Course: ${label}`}>
            {loading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Icon className="size-3.5 mr-1.5" />}
            {label} <ChevronDown className="size-3.5 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {closed ? (
            <DropdownMenuItem onSelect={() => execute({ closesAt: null })} className="items-start gap-2">
              <DoorOpen className="size-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Reopen the course</p>
                <p className="text-xs text-muted-foreground">Students can use its lessons and tests again</p>
              </div>
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => setDialog("now")} className="items-start gap-2">
                <DoorClosed className="size-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Close the course now</p>
                  <p className="text-xs text-muted-foreground">The course has finished — students lose access</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openDatePicker} className="items-start gap-2">
                <CalendarX2 className="size-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{closesAt ? "Change the last day" : "Close on a date"}</p>
                  <p className="text-xs text-muted-foreground">It closes on its own at the end of that day</p>
                </div>
              </DropdownMenuItem>
              {closesAt && (
                <DropdownMenuItem onSelect={() => execute({ closesAt: null })} className="items-start gap-2">
                  <DoorOpen className="size-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Keep it open</p>
                    <p className="text-xs text-muted-foreground">Remove the closing date</p>
                  </div>
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-md">
          {dialog === "now" ? (
            <>
              <DialogHeader>
                <DialogTitle>Close this course now?</DialogTitle>
                <DialogDescription>
                  Students on it will no longer be able to open its lessons, tests or files. Anyone with no other
                  course still running will see a &ldquo;your course has finished&rdquo; page instead of their student
                  space. Their work and marks are kept, and you can reopen the course at any time.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
                <Button disabled={loading} onClick={() => execute({ closesAt: new Date().toISOString() })}>
                  {loading && <Loader2 className="size-4 mr-1.5 animate-spin" />}
                  Close the course
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>When does the course finish?</DialogTitle>
                <DialogDescription>
                  Students keep access until the end of this day. After that the course closes on its own.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5 py-2">
                <Label htmlFor="course-last-day">Last day</Label>
                <Input
                  id="course-last-day"
                  type="date"
                  value={day}
                  min={dateValue(new Date())}
                  onChange={(e) => setDay(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
                <Button disabled={!day || loading} onClick={() => execute({ closesAt: endOfDay(day) })}>
                  {loading && <Loader2 className="size-4 mr-1.5 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
