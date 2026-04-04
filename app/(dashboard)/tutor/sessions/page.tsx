"use client"

import React, { useState, useMemo, useEffect, useRef } from "react"
import Link from "next/link"
import {
  Video, CalendarPlus, Clock, Users,
  Loader2, Radio, CheckCircle2, XCircle,
  CalendarDays, List, Download, MonitorPlay,
  Sparkles, BookOpen, ChevronLeft, ChevronRight,
  Calendar, Globe, Lock, X, Search, UserPlus, Pencil, Play,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { TimePicker } from "@/components/ui/time-picker"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose, DialogTrigger,
} from "@/components/ui/dialog"
import { useFetch, usePatchCallback, usePostCallback } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionItem = {
  id: string
  title: string
  description: string | null
  scheduledAt: string
  durationMins: number
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
  attendeeCount: number
  maxStudents: number | null
  course: { id: string; title: string } | null
  recordingUrl: string | null
  startedAt: string | null
  endedAt: string | null
}

type SessionsData = { sessions: SessionItem[] }

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS = {
  SCHEDULED: {
    label: "Scheduled",
    dot: "bg-amber-400",
    badge: "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
    card: "border-border hover:border-primary/30",
    chip: "bg-primary/80 text-primary-foreground",
    icon: Clock,
  },
  LIVE: {
    label: "Live Now",
    dot: "bg-emerald-500 animate-pulse",
    badge: "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
    card: "border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/50 to-background dark:from-emerald-950/20",
    chip: "bg-emerald-500 text-white",
    icon: Radio,
  },
  COMPLETED: {
    label: "Completed",
    dot: "bg-muted-foreground/40",
    badge: "border-border text-muted-foreground bg-muted/60",
    card: "border-border opacity-90",
    chip: "bg-muted text-muted-foreground",
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: "Cancelled",
    dot: "bg-rose-400",
    badge: "border-rose-200 text-rose-600 bg-rose-50 dark:bg-rose-950 dark:text-rose-300",
    card: "border-border opacity-70",
    chip: "bg-rose-100 text-rose-600 dark:bg-rose-900/60 dark:text-rose-300",
    icon: XCircle,
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

// Build a 6-row month grid (Mon–Sun)
function buildMonthGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7 // 0=Mon
  const start = new Date(year, month, 1 - startOffset)
  const weeks: Date[][] = []
  const cursor = new Date(start)
  for (let w = 0; w < 6; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

// ─── Schedule Session Dialog ──────────────────────────────────────────────────

type CoursesData = { courses: Array<{ id: string; title: string }> }
type StudentResult = { id: string; name: string; email: string; avatarUrl: string | null }
type SessionBody = {
  title: string; description: string; scheduledAt: string
  durationMins: number; maxStudents: number | undefined; courseId: string | undefined
  visibility: "PUBLIC" | "INVITE_ONLY"; invitedStudentIds: string[]
}

function ScheduleSessionDialog({
  onCreated,
  editSession,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  onCreated: () => void
  editSession?: SessionItem
  open?: boolean
  onOpenChange?: (v: boolean) => void
}) {
  const isEdit = !!editSession
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [time, setTime] = useState("")
  const [durationMins, setDurationMins] = useState(60)
  const [maxStudents, setMaxStudents] = useState("")
  const [courseId, setCourseId] = useState("")
  const [visibility, setVisibility] = useState<"PUBLIC" | "INVITE_ONLY">("PUBLIC")
  const [invitedStudents, setInvitedStudents] = useState<StudentResult[]>([])
  const [studentSearch, setStudentSearch] = useState("")
  const [searchResults, setSearchResults] = useState<StudentResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const { data: coursesData } = useFetch<CoursesData>("/api/tutor/courses", { errorMessage: false })

  // Pre-fill form when editing
  useEffect(() => {
    if (open && editSession) {
      const d = new Date(editSession.scheduledAt)
      setTitle(editSession.title)
      setDescription(editSession.description ?? "")
      setDate(d)
      setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`)
      setDurationMins(editSession.durationMins)
      setMaxStudents(editSession.maxStudents ? String(editSession.maxStudents) : "")
      setCourseId(editSession.course?.id ?? "")
    }
  }, [open, editSession])

  // Debounced student search
  useEffect(() => {
    if (!studentSearch.trim()) { setSearchResults([]); setShowDropdown(false); return }
    const t = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const res = await fetch(`/api/tutor/students/search?q=${encodeURIComponent(studentSearch)}`)
        const data = await res.json() as { students: StudentResult[] }
        setSearchResults(data.students.filter(s => !invitedStudents.some(i => i.id === s.id)))
        setShowDropdown(true)
      } finally { setSearchLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [studentSearch, invitedStudents])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const { execute: create, loading: creating } = usePostCallback<{ session: { id: string } }, SessionBody>(
    "/api/tutor/sessions",
    {
      successMessage: "Session scheduled!",
      errorMessage: "Could not schedule session",
      onSuccess: () => { setOpen(false); resetForm(); onCreated() },
    }
  )

  const { execute: update, loading: updating } = usePatchCallback<{ session: SessionItem }, Partial<SessionBody>>(
    `/api/tutor/sessions/${editSession?.id ?? ""}`,
    {
      successMessage: "Session updated!",
      errorMessage: "Could not update session",
      onSuccess: () => { setOpen(false); onCreated() },
    }
  )

  const loading = creating || updating

  function resetForm() {
    setTitle(""); setDescription(""); setDate(undefined); setTime("")
    setDurationMins(60); setMaxStudents(""); setCourseId("")
    setVisibility("PUBLIC"); setInvitedStudents([]); setStudentSearch(""); setSearchResults([])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !time) return
    const [hours, minutes] = time.split(":")
    const scheduledAt = new Date(date)
    scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0)
    const body: Partial<SessionBody> = {
      title, description, scheduledAt: scheduledAt.toISOString(),
      durationMins,
      maxStudents: maxStudents ? parseInt(maxStudents) : undefined,
      courseId: courseId || undefined,
    }
    if (isEdit) {
      update(body)
    } else {
      create({ ...body, visibility, invitedStudentIds: invitedStudents.map(s => s.id) } as SessionBody)
    }
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const canSubmit = title.trim() && date && time

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v && !isEdit) resetForm() }}>
      {!isEdit && (
        <DialogTrigger asChild>
          <Button size="sm">
            <CalendarPlus className="size-4 mr-1.5" /> Schedule Session
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit
              ? <><Pencil className="size-4 text-primary" /> Edit Session</>
              : <><CalendarPlus className="size-4 text-primary" /> Schedule Live Session</>
            }
          </DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the session details below." : "Set up a new BSL live session for your students."}
          </DialogDescription>
        </DialogHeader>

        <form id="schedule-form" onSubmit={handleSubmit} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault() }} className="flex flex-col gap-4 py-1">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="s-title"
              placeholder="e.g. BSL Fingerspelling Basics"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-desc">Description</Label>
            <Textarea
              id="s-desc"
              placeholder="What will students learn?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Date <span className="text-destructive">*</span></Label>
              <DatePicker value={date} onChange={setDate} placeholder="Pick a date" disabled={(d) => d < today} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Time <span className="text-destructive">*</span></Label>
              <TimePicker value={time} onChange={setTime} />
            </div>
          </div>

          {/* Duration + Max students */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-dur">Duration (min) <span className="text-destructive">*</span></Label>
              <Input
                id="s-dur"
                type="number"
                min={5}
                max={480}
                value={durationMins}
                onChange={(e) => setDurationMins(parseInt(e.target.value))}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-max">Max Students</Label>
              <Input
                id="s-max"
                type="number"
                min={1}
                placeholder="Unlimited"
                value={maxStudents}
                onChange={(e) => setMaxStudents(e.target.value)}
              />
            </div>
          </div>

          {/* Course */}
          {coursesData?.courses.length ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-course">Link to Course (optional)</Label>
              <select
                id="s-course"
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
          <div className="flex flex-col gap-1.5">
            <Label>Visibility</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVisibility("PUBLIC")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-colors",
                  visibility === "PUBLIC"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                )}
              >
                <Globe className="size-4" /> Public
              </button>
              <button
                type="button"
                onClick={() => setVisibility("INVITE_ONLY")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-colors",
                  visibility === "INVITE_ONLY"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                )}
              >
                <Lock className="size-4" /> Invite Only
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {visibility === "PUBLIC"
                ? "Any enrolled student can join this session."
                : "Only students you invite will see and join this session."}
            </p>
          </div>

          {/* Student invite (only when INVITE_ONLY) */}
          {visibility === "INVITE_ONLY" && (
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-1.5"><UserPlus className="size-3.5" /> Invite Students</Label>
              {/* Search input */}
              <div className="relative" ref={searchRef}>
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search by name or email…"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                  className="pl-8"
                />
                {searchLoading && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
                )}
                {/* Dropdown */}
                {showDropdown && searchResults.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 w-full rounded-lg border bg-popover shadow-md overflow-hidden">
                    {searchResults.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setInvitedStudents(prev => [...prev, s])
                          setStudentSearch("")
                          setShowDropdown(false)
                        }}
                      >
                        <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{s.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showDropdown && !searchLoading && searchResults.length === 0 && studentSearch.trim() && (
                  <div className="absolute z-50 top-full mt-1 w-full rounded-lg border bg-popover shadow-md px-3 py-2 text-sm text-muted-foreground">
                    No students found
                  </div>
                )}
              </div>
              {/* Selected chips */}
              {invitedStudents.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {invitedStudents.map((s) => (
                    <span
                      key={s.id}
                      className="flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs px-2.5 py-1 font-medium"
                    >
                      {s.name}
                      <button
                        type="button"
                        onClick={() => setInvitedStudents(prev => prev.filter(i => i.id !== s.id))}
                        className="ml-0.5 rounded-full hover:bg-primary/20 transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="submit"
            form="schedule-form"
            disabled={loading || !canSubmit}
          >
            {loading
            ? <><Loader2 className="size-3.5 animate-spin mr-1.5" />{isEdit ? "Saving…" : "Scheduling…"}</>
            : isEdit ? "Save Changes" : "Schedule Session"
          }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({
  session,
  onMutated,
}: {
  session: SessionItem
  onMutated?: () => void
}) {
  const cfg = STATUS[session.status]
  const StatusIcon = cfg.icon
  const scheduled = new Date(session.scheduledAt)
  const [editOpen, setEditOpen] = useState(false)
  const [recordingOpen, setRecordingOpen] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordingLoading, setRecordingLoading] = useState(false)

  const { execute: patch, loading: patching } = usePatchCallback<
    { session: SessionItem },
    { status: "LIVE" | "COMPLETED" | "CANCELLED" }
  >(`/api/tutor/sessions/${session.id}`, {
    successMessage: (d) =>
      `Session ${(d as { session: { status: string } }).session.status.toLowerCase()}`,
    errorMessage: "Could not update session",
    onSuccess: () => onMutated?.(),
  })

  async function openRecording() {
    setRecordingLoading(true)
    try {
      const res  = await fetch(`/api/sessions/${session.id}/recording`)
      const data = await res.json() as { url?: string }
      if (data.url) { setRecordingUrl(data.url); setRecordingOpen(true) }
    } finally {
      setRecordingLoading(false)
    }
  }

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden transition-all hover:shadow-sm",
      cfg.card
    )}>
      {/* Live banner */}
      {session.status === "LIVE" && (
        <div className="bg-emerald-500 text-white px-4 py-1.5 flex items-center gap-2">
          <Radio className="size-3 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wide">Session in progress</span>
        </div>
      )}

      <div className="p-5 flex flex-col gap-4">
        {/* Top: badges + title + description */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge variant="outline" className={cn("text-xs gap-1", cfg.badge)}>
                <StatusIcon className="size-3" />
                {cfg.label}
              </Badge>
              {session.course && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <BookOpen className="size-3" />
                  {session.course.title}
                </span>
              )}
            </div>
            <h3 className="font-bold text-base leading-snug">{session.title}</h3>
            {session.description && (
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{session.description}</p>
            )}
          </div>

          {/* Primary action — top-right for quick access */}
          {session.status === "LIVE" && (
            <Button asChild size="sm" className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
              <Link href={`/tutor/sessions/${session.id}/live`}>
                <MonitorPlay className="size-3.5" /> Open Classroom
              </Link>
            </Button>
          )}
          {session.status === "SCHEDULED" && (
            <Button size="sm" className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              disabled={patching} onClick={() => patch({ status: "LIVE" })}>
              <Radio className="size-3.5" /> Start
            </Button>
          )}
        </div>

        {/* Meta row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-muted/40 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Date</p>
            <p className="text-xs font-semibold">
              {scheduled.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            </p>
          </div>
          <div className="bg-muted/40 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Time</p>
            <p className="text-xs font-semibold">
              {scheduled.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <div className="bg-muted/40 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Duration</p>
            <p className="text-xs font-semibold">{session.durationMins} min</p>
          </div>
          <div className="bg-muted/40 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Students</p>
            <p className="text-xs font-semibold">
              {session.attendeeCount}{session.maxStudents ? ` / ${session.maxStudents}` : " joined"}
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
          {session.status === "LIVE" && (
            <Button size="sm" variant="outline" disabled={patching} className="h-7 text-xs"
              onClick={() => patch({ status: "COMPLETED" })}>
              <CheckCircle2 className="size-3 mr-1.5" /> End Session
            </Button>
          )}
          {session.status === "SCHEDULED" && (
            <>
              <Button size="sm" variant="outline" disabled={patching}
                className="h-7 text-xs gap-1.5"
                onClick={() => setEditOpen(true)}>
                <Pencil className="size-3" /> Edit
              </Button>
              <Button size="sm" variant="outline" disabled={patching}
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => patch({ status: "CANCELLED" })}>
                <XCircle className="size-3 mr-1.5" /> Cancel
              </Button>
            </>
          )}
          {session.status === "COMPLETED" && session.recordingUrl && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                disabled={recordingLoading} onClick={openRecording}>
                {recordingLoading
                  ? <Loader2 className="size-3 animate-spin" />
                  : <Play className="size-3" />}
                Watch
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                disabled={recordingLoading}
                onClick={async () => {
                  setRecordingLoading(true)
                  try {
                    const res  = await fetch(`/api/sessions/${session.id}/recording`)
                    const data = await res.json() as { url?: string }
                    if (data.url) {
                      const a = document.createElement("a")
                      a.href = data.url
                      a.download = `${session.title}.mp4`
                      a.click()
                    }
                  } finally { setRecordingLoading(false) }
                }}>
                <Download className="size-3" /> Download
              </Button>
            </>
          )}
          {session.status === "COMPLETED" && !session.recordingUrl && (
            <span className="text-xs text-muted-foreground">No recording available</span>
          )}
          {session.status === "CANCELLED" && (
            <span className="text-xs text-muted-foreground">This session was cancelled</span>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <ScheduleSessionDialog
        editSession={session}
        open={editOpen}
        onOpenChange={setEditOpen}
        onCreated={() => { setEditOpen(false); onMutated?.() }}
      />

      {/* Recording viewer */}
      <Dialog open={recordingOpen} onOpenChange={setRecordingOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{session.title} — Recording</DialogTitle>
          </DialogHeader>
          {recordingUrl && (
            <video
              src={recordingUrl}
              controls
              className="w-full rounded-lg bg-black"
              style={{ maxHeight: "60vh" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Big Calendar View ────────────────────────────────────────────────────────

function BigCalendar({ sessions, onMutated }: { sessions: SessionItem[]; onMutated: () => void }) {
  const today = useMemo(() => new Date(), [])
  const [current, setCurrent] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<Date>(today)

  const weeks = useMemo(
    () => buildMonthGrid(current.getFullYear(), current.getMonth()),
    [current]
  )

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, SessionItem[]>()
    for (const s of sessions) {
      const key = new Date(s.scheduledAt).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return map
  }, [sessions])

  const selectedSessions = sessionsByDay.get(selectedDay.toDateString()) ?? []

  // Upcoming sessions (next 5 not on selectedDay)
  const upcomingPreviews = useMemo(() =>
    sessions
      .filter((s) => s.status === "SCHEDULED" || s.status === "LIVE")
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .slice(0, 5),
    [sessions]
  )

  const monthLabel = current.toLocaleDateString("en-GB", { month: "long", year: "numeric" })

  function prevMonth() {
    const d = new Date(current)
    d.setMonth(d.getMonth() - 1)
    setCurrent(d)
  }
  function nextMonth() {
    const d = new Date(current)
    d.setMonth(d.getMonth() + 1)
    setCurrent(d)
  }

  const selectedLabel = selectedDay.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  })

  return (
    <div className="flex gap-5 items-start">
      {/* ── Main grid ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Month nav */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">{monthLabel}</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7" onClick={prevMonth}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
              onClick={() => { setCurrent(new Date()); setSelectedDay(new Date()) }}>
              Today
            </Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={nextMonth}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* Grid */}
        <div className="rounded-2xl border border-border overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 bg-muted/50 border-b border-border">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-2 text-center text-[11px] font-semibold text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {/* Weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b last:border-b-0 border-border">
              {week.map((day, di) => {
                const isThisMonth = day.getMonth() === current.getMonth()
                const isToday = isSameDay(day, today)
                const isSelected = isSameDay(day, selectedDay)
                const daySessions = sessionsByDay.get(day.toDateString()) ?? []

                return (
                  <div
                    key={di}
                    onClick={() => setSelectedDay(new Date(day))}
                    className={cn(
                      "min-h-22.5 p-1.5 border-r last:border-r-0 border-border cursor-pointer transition-colors group",
                      isThisMonth ? "bg-background" : "bg-muted/15",
                      isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                      !isSelected && "hover:bg-muted/30"
                    )}
                  >
                    {/* Date number */}
                    <div className="flex justify-end mb-1">
                      <span className={cn(
                        "size-6 flex items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                        isToday && "bg-primary text-primary-foreground",
                        !isToday && isThisMonth && "text-foreground group-hover:text-primary",
                        !isToday && !isThisMonth && "text-muted-foreground/40"
                      )}>
                        {day.getDate()}
                      </span>
                    </div>

                    {/* Event chips */}
                    <div className="flex flex-col gap-0.5">
                      {daySessions.slice(0, 3).map((s) => (
                        <div
                          key={s.id}
                          className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded-md truncate leading-tight",
                            STATUS[s.status].chip
                          )}
                        >
                          {formatTime(s.scheduledAt)} {s.title}
                        </div>
                      ))}
                      {daySessions.length > 3 && (
                        <span className="text-[9px] text-muted-foreground pl-1 font-medium">
                          +{daySessions.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Selected day sessions (below calendar) */}
        {selectedSessions.length > 0 && (
          <div className="flex flex-col gap-3 pt-1">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <CalendarDays className="size-3.5" />
              {selectedLabel}
              <Badge variant="secondary" className="text-xs">{selectedSessions.length}</Badge>
            </h3>
            {selectedSessions.map((s) => (
              <SessionCard key={s.id} session={s} onMutated={onMutated} />
            ))}
          </div>
        )}
      </div>

      {/* ── Right sidebar ── */}
      <div className="w-64 shrink-0 flex flex-col gap-4 mt-10">
        {/* Selected day panel */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className={cn(
            "px-4 py-3 border-b border-border",
            isSameDay(selectedDay, today) ? "bg-primary/5" : "bg-muted/30"
          )}>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
              {isSameDay(selectedDay, today) ? "Today" : selectedDay.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" })}
            </p>
            <p className="text-2xl font-black tabular-nums leading-none mt-0.5">
              {selectedDay.getDate()}
            </p>
          </div>

          <div className="p-3 flex flex-col gap-2">
            {selectedSessions.length > 0 ? (
              selectedSessions.map((s) => (
                <div key={s.id} className="flex items-start gap-2 group">
                  <div className={cn("w-0.5 self-stretch rounded-full shrink-0 mt-0.5", STATUS[s.status].dot.replace("animate-pulse", ""))} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatTime(s.scheduledAt)} · {s.durationMins} min
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("text-[9px] px-1 h-4 shrink-0", STATUS[s.status].badge)}>
                    {STATUS[s.status].label}
                  </Badge>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <p className="text-xs text-muted-foreground">No sessions</p>
                <ScheduleSessionDialog onCreated={onMutated} />
              </div>
            )}
          </div>
        </div>

        {/* Upcoming sessions */}
        {upcomingPreviews.length > 0 && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Upcoming</p>
            </div>
            <div className="p-3 flex flex-col gap-2">
              {upcomingPreviews.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    const d = new Date(s.scheduledAt)
                    setCurrent(new Date(d.getFullYear(), d.getMonth(), 1))
                    setSelectedDay(d)
                  }}
                  className="flex items-start gap-2 text-left w-full hover:bg-muted/40 rounded-lg p-1.5 -mx-1.5 transition-colors group"
                >
                  <div className={cn("w-0.5 self-stretch rounded-full shrink-0 mt-0.5", STATUS[s.status].dot.replace("animate-pulse", ""))} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(s.scheduledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      {" · "}{formatTime(s.scheduledAt)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick stats */}
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Overview</p>
          {(["LIVE", "SCHEDULED", "COMPLETED"] as const).map((status) => {
            const count = sessions.filter((s) => s.status === status).length
            if (!count) return null
            const cfg = STATUS[status]
            return (
              <div key={status} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", cfg.dot.replace("animate-pulse", ""))} />
                  <span className="text-xs text-muted-foreground">{cfg.label}</span>
                </div>
                <span className="text-xs font-bold tabular-nums">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Shared Sidebar ───────────────────────────────────────────────────────────

function SessionsSidebar({ sessions, onMutated }: { sessions: SessionItem[]; onMutated: () => void }) {
  const today = new Date()
  const todaySessions = sessions.filter((s) => isSameDay(new Date(s.scheduledAt), today))
  const upcomingPreviews = sessions
    .filter((s) => s.status === "SCHEDULED" || s.status === "LIVE")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 5)

  return (
    <div className="w-64 shrink-0 flex flex-col gap-4 mt-10">
      {/* Today */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-primary/5">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Today</p>
          <p className="text-2xl font-black tabular-nums leading-none mt-0.5">{today.getDate()}</p>
          <p className="text-xs text-muted-foreground">
            {today.toLocaleDateString("en-GB", { weekday: "long", month: "short" })}
          </p>
        </div>
        <div className="p-3 flex flex-col gap-2">
          {todaySessions.length > 0 ? (
            todaySessions.map((s) => (
              <div key={s.id} className="flex items-start gap-2">
                <div className={cn("w-0.5 self-stretch rounded-full shrink-0 mt-0.5", STATUS[s.status].dot.replace("animate-pulse", ""))} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">{formatTime(s.scheduledAt)} · {s.durationMins} min</p>
                </div>
                <Badge variant="outline" className={cn("text-[9px] px-1 h-4 shrink-0", STATUS[s.status].badge)}>
                  {STATUS[s.status].label}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">No sessions today</p>
          )}
        </div>
      </div>

      {/* Upcoming */}
      {upcomingPreviews.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Upcoming</p>
          </div>
          <div className="p-3 flex flex-col gap-2">
            {upcomingPreviews.map((s) => (
              <div key={s.id} className="flex items-start gap-2 rounded-lg p-1.5 -mx-1.5">
                <div className={cn("w-0.5 self-stretch rounded-full shrink-0 mt-0.5", STATUS[s.status].dot.replace("animate-pulse", ""))} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(s.scheduledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {" · "}{formatTime(s.scheduledAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overview stats */}
      <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Overview</p>
        {(["LIVE", "SCHEDULED", "COMPLETED"] as const).map((status) => {
          const count = sessions.filter((s) => s.status === status).length
          if (!count) return null
          const cfg = STATUS[status]
          return (
            <div key={status} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", cfg.dot.replace("animate-pulse", ""))} />
                <span className="text-xs text-muted-foreground">{cfg.label}</span>
              </div>
              <span className="text-xs font-bold tabular-nums">{count}</span>
            </div>
          )
        })}
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground">No sessions yet.</p>
        )}
      </div>

      {/* Quick schedule */}
      <ScheduleSessionDialog onCreated={onMutated} />
    </div>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({ sessions, onMutated }: { sessions: SessionItem[]; onMutated: () => void }) {
  const live      = sessions.filter((s) => s.status === "LIVE")
  const upcoming  = sessions.filter((s) => s.status === "SCHEDULED")
  const past      = sessions.filter((s) => s.status === "COMPLETED" || s.status === "CANCELLED")

  return (
    <div className="flex gap-5 items-start">
      {/* Main list */}
      <div className="flex-1 min-w-0 flex flex-col gap-8">
        {live.length > 0 && (
          <Section title="Live Now" dot>
            {live.map((s) => <SessionCard key={s.id} session={s} onMutated={onMutated} />)}
          </Section>
        )}
        <Section title="Upcoming">
          {upcoming.length > 0 ? (
            upcoming.map((s) => <SessionCard key={s.id} session={s} onMutated={onMutated} />)
          ) : (
            <div className="rounded-2xl border border-dashed py-10 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">No upcoming sessions yet.</p>
            </div>
          )}
        </Section>
        {past.length > 0 && (
          <Section title="Past Sessions">
            {past.map((s) => <SessionCard key={s.id} session={s} onMutated={onMutated} />)}
          </Section>
        )}
      </div>

      {/* Sidebar — same layout as calendar */}
      <SessionsSidebar sessions={sessions} onMutated={onMutated} />
    </div>
  )
}

function Section({ title, dot, children }: { title: string; dot?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
        {dot && <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />}
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorSessionsPage() {
  const [view, setView] = useState<"list" | "calendar">("list")

  const { data, loading, refetch } = useFetch<SessionsData>("/api/tutor/sessions", {
    errorMessage: "Could not load sessions",
  })

  const sessions = data?.sessions ?? []

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Video className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Live Sessions</h1>
            <p className="text-sm text-muted-foreground">Manage your BSL live classes</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-muted/40 p-1">
            <button
              onClick={() => setView("list")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                view === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="size-3.5" /> List
            </button>
            <button
              onClick={() => setView("calendar")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                view === "calendar" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarDays className="size-3.5" /> Calendar
            </button>
          </div>

          <ScheduleSessionDialog onCreated={refetch} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : view === "calendar" ? (
        <BigCalendar sessions={sessions} onMutated={refetch} />
      ) : (
        <ListView sessions={sessions} onMutated={refetch} />
      )}
    </div>
  )
}
