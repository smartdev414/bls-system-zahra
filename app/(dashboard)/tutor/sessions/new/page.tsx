"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ChevronLeft, CalendarPlus, Users, X, Globe, Lock } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { TimePicker } from "@/components/ui/time-picker"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { usePostCallback, useFetch } from "@/hooks/use-fetch"
import { StudentPickerModal } from "@/components/classroom/StudentPickerModal"

type SessionBody = {
  title: string
  description: string
  scheduledAt: string
  durationMins: number
  maxStudents: number | undefined
  courseId: string | undefined
  visibility: "PUBLIC" | "INVITE_ONLY"
  invitedStudentIds: string[]
}

type CoursesData = {
  courses: Array<{ id: string; title: string }>
}

type PickedStudent = { id: string; name: string; email: string }

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
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
  const [visibility, setVisibility] = useState<"PUBLIC" | "INVITE_ONLY">("PUBLIC")
  const [invitedStudents, setInvitedStudents] = useState<PickedStudent[]>([])
  const [showPicker, setShowPicker] = useState(false)

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
      visibility,
      invitedStudentIds: visibility === "INVITE_ONLY" ? invitedStudents.map((s) => s.id) : [],
    })
  }

  function removeInvitee(id: string) {
    setInvitedStudents((prev) => prev.filter((s) => s.id !== id))
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

            {/* Visibility */}
            <div className="flex flex-col gap-2">
              <Label>Visibility</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVisibility("PUBLIC")}
                  className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-colors ${
                    visibility === "PUBLIC"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-muted-foreground/40"
                  }`}
                >
                  <Globe className="size-4 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Public</p>
                    <p className="text-xs text-muted-foreground">All enrolled students</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility("INVITE_ONLY")}
                  className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-colors ${
                    visibility === "INVITE_ONLY"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-muted-foreground/40"
                  }`}
                >
                  <Lock className="size-4 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Invite Only</p>
                    <p className="text-xs text-muted-foreground">Selected students only</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Invite section (only shown for INVITE_ONLY) */}
            {visibility === "INVITE_ONLY" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    Invited Students
                    {invitedStudents.length > 0 && (
                      <span className="ml-1 text-xs bg-primary/10 text-primary font-semibold px-1.5 py-0.5 rounded-full">
                        {invitedStudents.length}
                      </span>
                    )}
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => setShowPicker(true)}
                  >
                    <Users className="size-3" />
                    {invitedStudents.length > 0 ? "Edit Selection" : "Select Students"}
                  </Button>
                </div>

                {invitedStudents.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowPicker(true)}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 py-5 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    <Users className="size-5 opacity-50" />
                    <span className="text-xs">Click to select students or groups</span>
                  </button>
                ) : (
                  <div className="rounded-lg border bg-muted/20 divide-y max-h-48 overflow-y-auto">
                    {invitedStudents.map((student) => (
                      <div key={student.id} className="flex items-center gap-2.5 px-3 py-2">
                        <Avatar className="size-6 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-[9px]">
                            {initials(student.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{student.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{student.email}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeInvitee(student.id)}
                          className="size-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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

      {showPicker && (
        <StudentPickerModal
          selected={new Set(invitedStudents.map((s) => s.id))}
          onConfirm={(ids, students) => {
            setInvitedStudents(students)
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
