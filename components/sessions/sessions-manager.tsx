"use client"

import React, { useState, useMemo, useEffect, createContext, useContext } from "react"
import Link from "next/link"
import {
  Video, CalendarPlus, Clock, Users, Users2,
  Loader2, Radio, CheckCircle2, XCircle,
  CalendarDays, List, MonitorPlay,
  Sparkles, BookOpen, ChevronLeft, ChevronRight,
  Globe, Lock, X, Pencil, Play, Copy,
  Paperclip, FileText, Trash2, Repeat, FolderOpen,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { usePoll } from "@/hooks/use-poll"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { TimePicker } from "@/components/ui/time-picker"
import { Separator } from "@/components/ui/separator"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose, DialogTrigger,
} from "@/components/ui/dialog"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"
import { StudentPickerModal } from "@/components/classroom/StudentPickerModal"
import { TutorPickerModal } from "@/components/classroom/TutorPickerModal"
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload"
import { LibraryPicker } from "@/components/library/LibraryPicker"
import { Pagination } from "@/components/ui/pagination"
import { SegmentedVideoPlayer } from "@/components/ui/segmented-video-player"
import { cn } from "@/lib/utils"
import { SESSION_STATUS_EVENT } from "@/components/layout/session-status-listener"

const RECORDING_PROCESSING_MS = 10 * 60 * 1000
const S3_UPLOAD_GRACE_MS = 3 * 60 * 1000

/**
 * What the signed-in role may do with a session, and where its classroom lives.
 *
 * Tutors get the full surface. Support Team staff build the timetable but never
 * run a room or touch teaching material, so the same screen renders without the
 * classroom, start/stop, recording and resource-file controls. Passing this
 * through context keeps the (deeply nested) card components prop-free.
 */
export type SessionsScope = {
  /** Enter the room, start/end it, and watch its recording (view-only). */
  canTeach: boolean
  /** Attach and remove teaching-material files used in the classroom. */
  canManageResources: boolean
  /** Dashboard root the classroom links hang off (e.g. "/tutor"). */
  basePath: string
  /** Creator can't teach the class themselves, so a lead tutor must be picked. */
  mustAssignTutor: boolean
}

const TUTOR_SCOPE: SessionsScope = {
  canTeach: true,
  canManageResources: true,
  basePath: "/tutor",
  mustAssignTutor: false,
}

const SessionsScopeContext = createContext<SessionsScope>(TUTOR_SCOPE)

function useSessionsScope() {
  return useContext(SessionsScopeContext)
}

function isRecordingProcessing(session: SessionItem): boolean {
  if (session.status !== "COMPLETED") return false
  if (session.recordingUrl) return false
  if (!session.recordingKey && !session.egressId) return false
  if (!session.endedAt) return !!session.egressId

  const elapsed = Date.now() - new Date(session.endedAt).getTime()
  if (elapsed >= RECORDING_PROCESSING_MS) return false
  if (session.egressId) return true
  return !!session.recordingKey && elapsed < S3_UPLOAD_GRACE_MS
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionItem = {
  id: string
  title: string
  description: string | null
  scheduledAt: string
  durationMins: number
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
  visibility: "PUBLIC" | "INVITE_ONLY"
  attendeeCount: number
  maxStudents: number | null
  course: { id: string; title: string } | null
  recordingUrl: string | null
  recordingKey: string | null
  egressId: string | null
  startedAt: string | null
  endedAt: string | null
  // True when the current tutor was invited to co-teach this session (not the
  // owner). Co-tutors can open/join but not edit, cancel, start, or duplicate.
  isCoTutor?: boolean
  // Owning tutor — only sent to staff, who schedule on a tutor's behalf.
  tutorId?: string
  tutorName?: string | null
}

type SessionsData = { sessions: SessionItem[] }

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
type TutorResult = { id: string; name: string; email: string; avatarUrl: string | null }
type SessionBody = {
  title: string; description: string; scheduledAt: string
  durationMins: number; maxStudents: number | undefined; courseId: string | undefined
  visibility: "PUBLIC" | "INVITE_ONLY"; invitedStudentIds: string[]
}
type SessionResource = {
  id: string; title: string; fileUrl: string; fileName: string
  fileSize: number | null; mimeType: string | null
  presentationUrl: string | null; presentationMimeType: string | null
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ScheduleSessionDialog({
  onCreated,
  editSession,
  duplicateSession,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showScheduleButton: showScheduleButton = true,
}: {
  onCreated: () => void
  editSession?: SessionItem
  duplicateSession?: SessionItem
  showScheduleButton?: boolean
  open?: boolean
  onOpenChange?: (v: boolean) => void
}) {
  const isEdit = !!editSession
  const isDuplicate = !!duplicateSession && !editSession
  const scope = useSessionsScope()
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
  const [visibility, setVisibility] = useState<"PUBLIC" | "INVITE_ONLY">("INVITE_ONLY")
  const [invitedStudents, setInvitedStudents] = useState<StudentResult[]>([])
  const [invitedTutors, setInvitedTutors] = useState<TutorResult[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [showTutorPicker, setShowTutorPicker] = useState(false)
  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const [repeatWeeks, setRepeatWeeks] = useState(4)
  // Support Team staff schedule on a tutor's behalf, so the class needs an owner.
  const [leadTutorId, setLeadTutorId] = useState("")

  // Resources state
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([])
  const [savedResources, setSavedResources] = useState<SessionResource[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: coursesData } = useFetch<CoursesData>("/api/tutor/courses", { errorMessage: false })
  const { data: leadTutorData } = useFetch<{ tutors: TutorResult[] }>(
    "/api/tutor/colleagues",
    { immediate: scope.mustAssignTutor, errorMessage: false }
  )

  // Load existing resources, invites, and co-tutors when editing; load when duplicating
  useEffect(() => {
    if (!open) return
    if (isEdit && editSession?.id) {
      if (scope.canManageResources) {
        fetch(`/api/tutor/sessions/${editSession.id}/resources`)
          .then((r) => r.json())
          .then((d: { resources: SessionResource[] }) => setSavedResources(d.resources))
          .catch(() => {})
      }
      fetch(`/api/tutor/sessions/${editSession.id}/invites`)
        .then((r) => r.json())
        .then((d: { invites: Array<{ studentId: string; studentName: string; studentEmail: string }> }) => {
          setInvitedStudents(d.invites.map((i) => ({ id: i.studentId, name: i.studentName, email: i.studentEmail, avatarUrl: null })))
        })
        .catch(() => {})
      fetch(`/api/tutor/sessions/${editSession.id}/co-tutors`)
        .then((r) => r.json())
        .then((d: { coTutors: Array<{ tutorId: string; tutorName: string; tutorEmail: string }> }) => {
          setInvitedTutors(d.coTutors.map((t) => ({ id: t.tutorId, name: t.tutorName, email: t.tutorEmail, avatarUrl: null })))
        })
        .catch(() => {})
    } else if (isDuplicate && duplicateSession?.id) {
      fetch(`/api/tutor/sessions/${duplicateSession.id}/invites`)
        .then((r) => r.json())
        .then((d: { invites: Array<{ studentId: string; studentName: string; studentEmail: string }> }) => {
          setInvitedStudents(d.invites.map((i) => ({ id: i.studentId, name: i.studentName, email: i.studentEmail, avatarUrl: null })))
        })
        .catch(() => {})
      fetch(`/api/tutor/sessions/${duplicateSession.id}/co-tutors`)
        .then((r) => r.json())
        .then((d: { coTutors: Array<{ tutorId: string; tutorName: string; tutorEmail: string }> }) => {
          setInvitedTutors(d.coTutors.map((t) => ({ id: t.tutorId, name: t.tutorName, email: t.tutorEmail, avatarUrl: null })))
        })
        .catch(() => {})
    }
  }, [open, isEdit, isDuplicate, editSession?.id, duplicateSession?.id])

  // Pre-fill form when editing or duplicating
  useEffect(() => {
    const source = editSession ?? duplicateSession
    if (!open || !source) return
    setTitle(source.title)
    setDescription(source.description ?? "")
    setDurationMins(source.durationMins)
    setMaxStudents(source.maxStudents ? String(source.maxStudents) : "")
    setCourseId(source.course?.id ?? "")
    setVisibility(source.visibility ?? "INVITE_ONLY")
    setLeadTutorId(source.tutorId ?? "")
    if (editSession) {
      const d = new Date(editSession.scheduledAt)
      setDate(d)
      setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`)
    }
  }, [open, editSession, duplicateSession])

  function resetForm() {
    setTitle(""); setDescription(""); setDate(undefined); setTime("")
    setDurationMins(60); setMaxStudents(""); setCourseId("")
    setVisibility("PUBLIC"); setInvitedStudents([]); setInvitedTutors([])
    setPendingFiles([]); setSavedResources([]); setSubmitError(null)
    setRepeatWeekly(false); setRepeatWeeks(4); setLeadTutorId("")
  }

  async function attachResources(sessionId: string, files: UploadedFile[]) {
    await Promise.all(files.map((f) =>
      fetch(`/api/tutor/sessions/${sessionId}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: f.fileName,
          fileUrl: f.fileUrl,
          fileName: f.fileName,
          fileSize: f.fileSize,
          mimeType: f.mimeType,
          presentationUrl: f.presentationUrl,
          presentationMimeType: f.presentationMimeType,
        }),
      })
    ))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !time) return
    if (scope.mustAssignTutor && !leadTutorId) {
      setSubmitError("Choose the tutor who will take this class")
      return
    }
    const [hours, minutes] = time.split(":")
    const scheduledAt = new Date(date)
    scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0)

    setSubmitting(true)
    setSubmitError(null)

    try {
      if (isEdit && editSession) {
        const res = await fetch(`/api/tutor/sessions/${editSession.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title, description, scheduledAt: scheduledAt.toISOString(),
            durationMins,
            maxStudents: maxStudents ? parseInt(maxStudents) : undefined,
            courseId: courseId || undefined,
            visibility,
            invitedStudentIds: invitedStudents.map((s) => s.id),
            invitedTutorIds: invitedTutors.map((t) => t.id),
            ...(scope.mustAssignTutor ? { tutorId: leadTutorId } : {}),
          }),
        })
        if (!res.ok) throw new Error((await res.json() as { message?: string }).message ?? "Could not update session")
        if (pendingFiles.length > 0) await attachResources(editSession.id, pendingFiles)
        setOpen(false)
        onCreated()
      } else {
        const occurrences = repeatWeekly ? Math.min(Math.max(repeatWeeks, 2), 52) : 1
        const res = await fetch("/api/tutor/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title, description, scheduledAt: scheduledAt.toISOString(),
            durationMins,
            maxStudents: maxStudents ? parseInt(maxStudents) : undefined,
            courseId: courseId || undefined,
            visibility,
            invitedStudentIds: invitedStudents.map((s) => s.id),
            invitedTutorIds: invitedTutors.map((t) => t.id),
            ...(scope.mustAssignTutor ? { tutorId: leadTutorId } : {}),
            repeatWeeks: occurrences,
          }),
        })
        if (!res.ok) throw new Error((await res.json() as { message?: string }).message ?? "Could not schedule session")
        const data = await res.json() as { session: { id: string }; sessions?: Array<{ id: string }> }
        const created = data.sessions ?? [data.session]
        if (pendingFiles.length > 0) {
          await Promise.all(created.map((s) => attachResources(s.id, pendingFiles)))
        }
        setOpen(false)
        resetForm()
        onCreated()
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  const loading = submitting

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const canSubmit = title.trim() && date && time

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v && !isEdit) resetForm() }}>
      {!isEdit && showScheduleButton && (
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
              : isDuplicate
              ? <><Copy className="size-4 text-primary" /> Duplicate Session</>
              : <><CalendarPlus className="size-4 text-primary" /> Schedule Live Session</>
            }
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the session details below."
              : isDuplicate
              ? "All details have been copied. Set a new date and time, then save."
              : "Set up a new BSL live session for your students."}
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

          {/* Repeat weekly — only when creating a new series, not editing */}
          {!isEdit && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={repeatWeekly}
                  onCheckedChange={(v) => setRepeatWeekly(v === true)}
                />
                <Repeat className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">Repeat weekly</span>
                <span className="text-xs text-muted-foreground">same day &amp; time each week</span>
              </label>
              {repeatWeekly && (
                <div className="flex items-center gap-2 pl-6">
                  <Label htmlFor="s-repeat" className="text-xs text-muted-foreground">for</Label>
                  <Input
                    id="s-repeat"
                    type="number"
                    min={2}
                    max={52}
                    value={repeatWeeks}
                    onChange={(e) => setRepeatWeeks(parseInt(e.target.value) || 2)}
                    className="h-8 w-20 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">weeks</span>
                </div>
              )}
            </div>
          )}

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

          {/* Lead tutor — only when the scheduler isn't teaching it themselves */}
          {scope.mustAssignTutor && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-lead-tutor">Tutor taking this class</Label>
              <select
                id="s-lead-tutor"
                value={leadTutorId}
                onChange={(e) => setLeadTutorId(e.target.value)}
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select a tutor…</option>
                {(leadTutorData?.tutors ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {t.email}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                They own the class and run the classroom; you keep managing the booking.
              </p>
            </div>
          )}

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
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <Users className="size-3.5" /> Invite Students
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
                  className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 py-4 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  <Users className="size-5 opacity-50" />
                  <span className="text-xs">Click to select students or groups</span>
                </button>
              ) : (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {invitedStudents.map((s) => (
                    <span
                      key={s.id}
                      className="flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs px-2.5 py-1 font-medium"
                    >
                      {s.name}
                      <button
                        type="button"
                        onClick={() => setInvitedStudents((prev) => prev.filter((i) => i.id !== s.id))}
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

          {/* Co-teacher invites */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Users2 className="size-3.5" /> Invite Tutors
                {invitedTutors.length > 0 && (
                  <span className="ml-1 text-xs bg-primary/10 text-primary font-semibold px-1.5 py-0.5 rounded-full">
                    {invitedTutors.length}
                  </span>
                )}
              </Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setShowTutorPicker(true)}
              >
                <Users2 className="size-3" />
                {invitedTutors.length > 0 ? "Edit Selection" : "Select Tutors"}
              </Button>
            </div>
            {invitedTutors.length === 0 ? (
              <button
                type="button"
                onClick={() => setShowTutorPicker(true)}
                className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 py-4 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              >
                <Users2 className="size-5 opacity-50" />
                <span className="text-xs">Click to invite colleagues as co-teachers</span>
              </button>
            ) : (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {invitedTutors.map((t) => (
                  <span
                    key={t.id}
                    className="flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs px-2.5 py-1 font-medium"
                  >
                    {t.name}
                    <button
                      type="button"
                      onClick={() => setInvitedTutors((prev) => prev.filter((i) => i.id !== t.id))}
                      className="ml-0.5 rounded-full hover:bg-primary/20 transition-colors"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Invited tutors can co-teach this session and will see it in their sessions list.
            </p>
          </div>

          {/* Resource files — teaching material, so hidden from roles without it */}
          {scope.canManageResources && <>
          <Separator />
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <Label className="flex items-center gap-1.5 flex-wrap">
                <Paperclip className="size-3.5" /> Resource Files
                <span className="text-muted-foreground font-normal text-xs">(for presenting in class — students cannot download)</span>
              </Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 shrink-0"
                onClick={() => setLibraryOpen(true)}
              >
                <FolderOpen className="size-3" />
                Choose from library
              </Button>
            </div>
            <LibraryPicker
              open={libraryOpen}
              onOpenChange={setLibraryOpen}
              allowedTypes={["VIDEO", "PDF", "IMAGE", "DOCUMENT", "AUDIO"]}
              attachedUrls={[
                ...savedResources.map((r) => r.fileUrl),
                ...pendingFiles.map((f) => f.fileUrl),
              ]}
              onPick={(picked) => setPendingFiles((prev) => [...prev, ...picked])}
            />

            {/* Saved resources (edit mode) */}
            {savedResources.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2 overflow-hidden">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.fileName}</p>
                  {r.fileSize && <p className="text-xs text-muted-foreground">{formatBytes(r.fileSize)}</p>}
                </div>
                <Button
                  type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={async () => {
                    await fetch(`/api/tutor/sessions/${editSession!.id}/resources/${r.id}`, { method: "DELETE" })
                    setSavedResources((prev) => prev.filter((x) => x.id !== r.id))
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            {/* Pending new uploads */}
            {pendingFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border bg-emerald-50 border-emerald-200 px-3 py-2 overflow-hidden">
                <FileText className="size-4 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.fileName}</p>
                  <p className="text-xs text-emerald-600">
                    {formatBytes(f.fileSize)} · Ready to save
                    {f.presentationUrl ? " · PDF ready for classroom" : ""}
                  </p>
                </div>
                <Button
                  type="button" variant="ghost" size="icon" className="size-7 shrink-0"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}

            {/* Upload a new file — resets after each upload so user can keep adding */}
            <FileUpload
              accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.ppt,.pptx,image/*,video/*,audio/*"
              label="Attach a file (PDF, Word, PowerPoint, image, video, audio)"
              uploaded={null}
              onUploaded={(f) => setPendingFiles((prev) => [...prev, f])}
            />
          </div>
          </>}

          {submitError && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {submitError}
            </p>
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
              : isEdit
              ? "Save Changes"
              : isDuplicate
              ? "Schedule Duplicate"
              : repeatWeekly
              ? `Schedule ${Math.min(Math.max(repeatWeeks, 2), 52)} Sessions`
              : "Schedule Session"
            }
          </Button>
        </DialogFooter>
      </DialogContent>

      {showPicker && (
        <StudentPickerModal
          selected={new Set(invitedStudents.map((s) => s.id))}
          onConfirm={(_ids: any, students: React.SetStateAction<StudentResult[]>) => {
            setInvitedStudents(students)
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showTutorPicker && (
        <TutorPickerModal
          selected={new Set(invitedTutors.map((t) => t.id))}
          onConfirm={(_ids, tutors) => {
            setInvitedTutors(tutors)
            setShowTutorPicker(false)
          }}
          onClose={() => setShowTutorPicker(false)}
        />
      )}
    </Dialog>
  )
}

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
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const scope = useSessionsScope()
  const [recordingOpen, setRecordingOpen] = useState(false)
  const [recordingSegments, setRecordingSegments] = useState<string[]>([])
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

  const recordingProcessing = isRecordingProcessing(session)

  // Waiting for a recording to finish processing. Paused while the tab is
  // hidden or the link is down: a five-second poll is the fastest thing on the
  // page and the first to stack up when a public Wi-Fi connection stalls.
  usePoll(
    () => { onMutated?.() },
    5_000,
    { enabled: recordingProcessing && !!onMutated, immediate: false },
  )

  async function openRecording() {
    setRecordingLoading(true)
    try {
      const res  = await fetch(`/api/sessions/${session.id}/recording`)
      const data = await res.json() as { url?: string; segments?: string[]; message?: string }
      if (!res.ok) {
        toast.error(data.message ?? "Recording is not available yet")
        return
      }
      const segs = data.segments ?? (data.url ? [data.url] : [])
      if (segs.length) { setRecordingSegments(segs); setRecordingOpen(true) }
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
              {session.isCoTutor && (
                <Badge variant="outline" className="text-xs gap-1 border-primary/30 text-primary bg-primary/5">
                  <Users className="size-3" />
                  Co-teaching
                </Badge>
              )}
            </div>
            <h3 className="font-bold text-base leading-snug">{session.title}</h3>
            {session.description && (
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{session.description}</p>
            )}
          </div>

          {/* Primary action — top-right for quick access. Co-tutors open/join but
              never start (flipping status is the owner's action). */}
          {scope.canTeach && session.status === "LIVE" && (
            <Button asChild size="sm" className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
              <Link href={`${scope.basePath}/classroom/${session.id}`}>
                <MonitorPlay className="size-3.5" /> {session.isCoTutor ? "Join Classroom" : "Open Classroom"}
              </Link>
            </Button>
          )}
          {scope.canTeach && session.status === "SCHEDULED" && (
            session.isCoTutor ? (
              <Button asChild size="sm" variant="outline" className="shrink-0 gap-1.5">
                <Link href={`${scope.basePath}/classroom/${session.id}`}>
                  <MonitorPlay className="size-3.5" /> Open Classroom
                </Link>
              </Button>
            ) : (
              <Button size="sm" className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                disabled={patching} onClick={() => patch({ status: "LIVE" })}>
                <Radio className="size-3.5" /> Start
              </Button>
            )
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
          {session.isCoTutor && (session.status === "LIVE" || session.status === "SCHEDULED") && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Users className="size-3" /> You&apos;re a co-teacher — the host manages this session
            </span>
          )}
          {session.status === "LIVE" && !session.isCoTutor && (
            <Button size="sm" variant="outline" disabled={patching} className="h-7 text-xs"
              onClick={() => patch({ status: "COMPLETED" })}>
              <CheckCircle2 className="size-3 mr-1.5" /> End Session
            </Button>
          )}
          {session.status === "SCHEDULED" && !session.isCoTutor && (
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
          {scope.canTeach && session.status === "COMPLETED" && session.recordingUrl && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                disabled={recordingLoading} onClick={openRecording}>
                {recordingLoading
                  ? <Loader2 className="size-3 animate-spin" />
                  : <Play className="size-3" />}
                Watch
              </Button>
            </>
          )}
          {scope.canTeach && recordingProcessing && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" /> Recording processing…
            </span>
          )}
          {scope.canTeach && session.status === "COMPLETED" && !session.recordingUrl && !recordingProcessing && (
            <span className="text-xs text-muted-foreground">No recording available</span>
          )}
          {session.status === "CANCELLED" && (
            <span className="text-xs text-muted-foreground">This session was cancelled</span>
          )}
          {!session.isCoTutor && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1.5 ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setDuplicateOpen(true)}
            >
              <Copy className="size-3" /> Duplicate
            </Button>
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

      {/* Duplicate dialog */}
      <ScheduleSessionDialog
        duplicateSession={session}
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        onCreated={() => { setDuplicateOpen(false); onMutated?.() }}
        showScheduleButton={false}
      />

      {/* Recording viewer — segmented playback so pause/resume gaps don't
          show up as awkward dead time. */}
      <Dialog open={recordingOpen} onOpenChange={setRecordingOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{session.title} — Recording</DialogTitle>
          </DialogHeader>
          {recordingSegments.length > 0 && (
            <SegmentedVideoPlayer
              segments={recordingSegments}
              className="w-full rounded-lg bg-black"
              style={{ maxHeight: "60vh" }}
              autoPlay
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
    <div className="flex flex-col md:flex-row gap-5 md:items-start">
      {/* ── Main grid ── */}
      <div className="w-full md:flex-1 md:min-w-0 flex flex-col gap-3">
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
      <div className="w-full md:w-64 md:shrink-0 flex flex-col gap-4 md:mt-10">
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
    <div className="w-full md:w-64 md:shrink-0 flex flex-col gap-4 md:mt-10">
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

const PAST_PAGE_SIZE = 10

function ListView({ sessions, onMutated }: { sessions: SessionItem[]; onMutated: () => void }) {
  const [pastPage, setPastPage] = useState(1)

  const live      = sessions.filter((s) => s.status === "LIVE")
  const upcoming  = sessions.filter((s) => s.status === "SCHEDULED")
  const past      = sessions.filter((s) => s.status === "COMPLETED" || s.status === "CANCELLED")
  const pastTotalPages = Math.ceil(past.length / PAST_PAGE_SIZE)
  const pastPaged = past.slice((pastPage - 1) * PAST_PAGE_SIZE, pastPage * PAST_PAGE_SIZE)

  return (
    <div className="flex flex-col md:flex-row gap-5 md:items-start">
      {/* Main list */}
      <div className="w-full md:flex-1 md:min-w-0 flex flex-col gap-8">
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
            {pastPaged.map((s) => <SessionCard key={s.id} session={s} onMutated={onMutated} />)}
            {pastTotalPages > 1 && (
              <Pagination page={pastPage} totalPages={pastTotalPages} onPageChange={setPastPage} className="mt-2" />
            )}
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

export function SessionsManager({
  scope = TUTOR_SCOPE,
  heading = "Live Sessions",
  subheading = "Manage your BSL live classes",
}: {
  scope?: SessionsScope
  heading?: string
  subheading?: string
}) {
  const [view, setView] = useState<"list" | "calendar">("list")

  const { data, loading, refetch } = useFetch<SessionsData>("/api/tutor/sessions", {
    errorMessage: "Could not load sessions",
  })

  const sessions = data?.sessions ?? []

  // Co-teachers don't get a push when the host ends from another tab unless we
  // poll or listen — the layout listener dispatches SESSION_STATUS_EVENT.
  useEffect(() => {
    const onStatus = () => { void refetch() }
    window.addEventListener(SESSION_STATUS_EVENT, onStatus)
    return () => window.removeEventListener(SESSION_STATUS_EVENT, onStatus)
  }, [refetch])

  usePoll(
    () => refetch(),
    30_000,
    { enabled: sessions.some((s) => s.status === "LIVE"), immediate: false },
  )

  return (
    <SessionsScopeContext.Provider value={scope}>
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Video className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">{heading}</h1>
            <p className="text-sm text-muted-foreground">{subheading}</p>
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
    </SessionsScopeContext.Provider>
  )
}
