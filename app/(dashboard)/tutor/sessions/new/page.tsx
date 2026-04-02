"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ChevronLeft, CalendarPlus } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { TimePicker } from "@/components/ui/time-picker"
import { usePostCallback, useFetch } from "@/hooks/use-fetch"

type SessionBody = {
  title: string
  description: string
  scheduledAt: string
  durationMins: number
  maxStudents: number | undefined
  courseId: string | undefined
}

type CoursesData = {
  courses: Array<{ id: string; title: string }>
}

export default function NewSessionPage() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [time, setTime] = useState("")
  const [durationMins, setDurationMins] = useState(60)
  const [maxStudents, setMaxStudents] = useState("")
  const [courseId, setCourseId] = useState("")

  const { data: coursesData } = useFetch<CoursesData>("/api/tutor/courses", { errorMessage: false })

  const { execute: createSession, loading } = usePostCallback<{ session: { id: string } }, SessionBody>(
    "/api/tutor/sessions",
    {
      successMessage: "Session scheduled!",
      errorMessage: "Could not schedule session",
      onSuccess: () => router.push("/tutor/sessions"),
    }
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !time) return
    const [hours, minutes] = time.split(":")
    const scheduledAt = new Date(date)
    scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0)
    createSession({
      title,
      description,
      scheduledAt: scheduledAt.toISOString(),
      durationMins,
      maxStudents: maxStudents ? parseInt(maxStudents) : undefined,
      courseId: courseId || undefined,
    })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href="/tutor/sessions">
          <ChevronLeft className="size-4 mr-1" /> Sessions
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-black tracking-tight">Schedule Live Session</h1>
        <p className="text-muted-foreground mt-1">Set up a new BSL live session for your students.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarPlus className="size-4 text-primary" /> Session Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">Session Title <span className="text-destructive">*</span></Label>
              <Input
                id="title"
                placeholder="e.g. BSL Fingerspelling Basics"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="What will students learn in this session?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Date <span className="text-destructive">*</span></Label>
                <DatePicker
                  value={date}
                  onChange={setDate}
                  placeholder="Pick a date"
                  disabled={(d) => d < today}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Time <span className="text-destructive">*</span></Label>
                <TimePicker value={time} onChange={setTime} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="duration">Duration (minutes) <span className="text-destructive">*</span></Label>
                <Input
                  id="duration"
                  type="number"
                  min={5}
                  max={480}
                  value={durationMins}
                  onChange={(e) => setDurationMins(parseInt(e.target.value))}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="maxStudents">Max Students</Label>
                <Input
                  id="maxStudents"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={maxStudents}
                  onChange={(e) => setMaxStudents(e.target.value)}
                />
              </div>
            </div>

            {coursesData?.courses.length ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="courseId">Link to Course (optional)</Label>
                <select
                  id="courseId"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">No course</option>
                  {coursesData.courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={loading || !title.trim() || !date || !time}
              >
                {loading ? "Scheduling..." : "Schedule Session"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/tutor/sessions">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
