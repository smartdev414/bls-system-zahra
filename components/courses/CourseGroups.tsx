"use client"

import { useMemo, useState } from "react"
import {
  BellRing, CalendarClock, CalendarPlus, ChevronDown, ChevronRight, Loader2,
  Plus, Radio, UserPlus, Users, X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { useFetch } from "@/hooks/use-fetch"
import { StudentPickerModal } from "@/components/classroom/StudentPickerModal"
import { StudentProgressTable, type CourseStudent } from "@/components/courses/StudentProgressTable"
import { useCourseRoster } from "@/components/courses/use-course-roster"
import { ScheduleClassDialog, WHOLE_COURSE, type ClassDefaults } from "@/components/courses/ScheduleClassDialog"
import { timeOf } from "@/components/courses/time-options"
import { AddGroupDialog } from "@/components/courses/AddGroupDialog"
import { WeekBadge, WeekPicker } from "@/components/sessions/class-week"
import { useTutorAccess } from "@/components/tutor-access-provider"
import { VIEW_ONLY_MESSAGE } from "@/lib/tutor-areas"

// ─── Types ────────────────────────────────────────────────────────────────────

type ClassSession = {
  id: string
  title: string
  scheduledAt: string
  durationMins: number
  week: number | null
  status: "SCHEDULED" | "LIVE"
  visibility: "PUBLIC" | "INVITE_ONLY"
  tutorId: string
  tutorName: string
  canManage: boolean
}

type CourseGroup = {
  id: string
  name: string
  // False for a group the office set up, shown to a tutor to use but not change.
  canEdit: boolean
  studentIds: string[]
  sessions: ClassSession[]
}

type GroupsData = {
  groups: CourseGroup[]
  // Classes that are not one of these groups': for everyone on the course, or
  // invite-only ones left from a group since removed.
  courseSessions: ClassSession[]
  mustAssignTutor: boolean
  tutorOptions: Array<{ id: string; name: string }>
  format: "ONLINE" | "IN_PERSON"
  venue: string | null
}

/** Card id for the students who are on the course but in none of its groups. */
const UNGROUPED = "ungrouped"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classDate(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) +
    ", " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  )
}

/**
 * One line that answers "when does this group meet?" — the weekly pattern when
 * the classes share a day and time, otherwise just the next one.
 */
function classSummary(sessions: ClassSession[]): string | null {
  if (sessions.length === 0) return null
  const dates = sessions.map((s) => new Date(s.scheduledAt))
  const sameSlot = dates.every(
    (d) => d.getDay() === dates[0].getDay() && d.getHours() === dates[0].getHours() && d.getMinutes() === dates[0].getMinutes(),
  )
  if (sessions.length > 1 && sameSlot) {
    const day = dates[0].toLocaleDateString("en-GB", { weekday: "long" })
    const time = dates[0].toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    const next = dates[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    return `${day}s at ${time} · next ${next} · ${sessions.length} classes`
  }
  return `Next class ${classDate(sessions[0].scheduledAt)}` + (sessions.length > 1 ? ` · ${sessions.length - 1} more` : "")
}

// ─── Upcoming classes for one group ───────────────────────────────────────────

const CLASSES_SHOWN = 3

function ClassList({
  sessions,
  onChanged,
  showInviteOnly = false,
}: {
  sessions: ClassSession[]
  onChanged: () => void
  /** Outside a group card, say which classes are not open to the whole course. */
  showInviteOnly?: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)
  // Classes ticked to cancel together; null when not choosing.
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [cancellingMany, setCancellingMany] = useState(false)
  // A teacher with a view-only calendar sees the classes but cancels none.
  const { calendar } = useTutorAccess()
  const cancellable = sessions.filter((s) => s.status === "SCHEDULED" && s.canManage && calendar)
  const shown = showAll || picked ? sessions : sessions.slice(0, CLASSES_SHOWN)
  const allPicked = picked !== null && cancellable.length > 0 && cancellable.every((s) => picked.has(s.id))

  function pick(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function cancelPicked() {
    if (!picked || picked.size === 0) return
    const n = picked.size
    if (!window.confirm(`Cancel ${n} class${n === 1 ? "" : "es"}? The students are told they are cancelled.`)) return
    setCancellingMany(true)
    try {
      const res = await fetch("/api/tutor/sessions/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...picked] }),
      })
      if (!res.ok) throw new Error()
      const { cancelled } = await res.json() as { cancelled: number }
      toast.success(`${cancelled} class${cancelled === 1 ? "" : "es"} cancelled`)
      setPicked(null)
      onChanged()
    } catch {
      toast.error("Could not cancel the classes")
    } finally {
      setCancellingMany(false)
    }
  }

  async function cancel(s: ClassSession) {
    if (!window.confirm(`Cancel the class on ${classDate(s.scheduledAt)}? The students are told it is cancelled.`)) return
    setCancelling(s.id)
    try {
      const res = await fetch(`/api/tutor/sessions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      })
      if (!res.ok) throw new Error()
      toast.success("Class cancelled")
      onChanged()
    } catch {
      toast.error("Could not cancel the class")
    } finally {
      setCancelling(null)
    }
  }

  return (
    <div className="divide-y">
      {cancellable.length > 1 && (
        picked ? (
          <div className="flex items-center gap-2.5 px-4 py-2 text-sm bg-muted/30">
            <Checkbox
              checked={allPicked}
              onCheckedChange={(v) => setPicked(v ? new Set(cancellable.map((s) => s.id)) : new Set())}
              aria-label="Select all classes"
            />
            <span className="text-xs flex-1 min-w-0">
              {picked.size > 0 ? `${picked.size} selected` : "Select all"}
            </span>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 px-2 text-xs shrink-0"
              disabled={picked.size === 0 || cancellingMany}
              onClick={() => void cancelPicked()}
            >
              {cancellingMany && <Loader2 className="size-3 mr-1 animate-spin" />}
              Cancel {picked.size > 0 ? picked.size : ""} class{picked.size === 1 ? "" : "es"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs shrink-0"
              disabled={cancellingMany}
              onClick={() => setPicked(null)}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="flex justify-end px-4 py-1">
            <button
              type="button"
              className="py-2 text-xs text-primary hover:underline"
              onClick={() => setPicked(new Set())}
            >
              Select classes to cancel
            </button>
          </div>
        )
      )}
      {shown.map((s) => (
        <div key={s.id} className="flex items-center gap-2.5 px-4 py-2 text-sm">
          {picked && (
            <Checkbox
              checked={picked.has(s.id)}
              disabled={!cancellable.includes(s)}
              onCheckedChange={(v) => pick(s.id, v === true)}
              aria-label={`Select class on ${classDate(s.scheduledAt)}`}
            />
          )}
          {s.status === "LIVE"
            ? <Radio className="size-3.5 text-emerald-600 shrink-0" />
            : <CalendarClock className="size-3.5 text-muted-foreground shrink-0" />}
          <span className="font-medium">{classDate(s.scheduledAt)}</span>
          {s.canManage && calendar && !picked
            ? <WeekPicker sessionId={s.id} week={s.week} date={classDate(s.scheduledAt)} onSaved={onChanged} />
            : <WeekBadge week={s.week} />}
          <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
            {s.durationMins} min · {s.tutorName}
            {showInviteOnly && s.visibility === "INVITE_ONLY" ? " · invited students only" : ""}
          </span>
          {s.status === "LIVE" ? (
            <Badge variant="outline" className="text-[10px] shrink-0 bg-emerald-100 text-emerald-700 border-emerald-200">Live now</Badge>
          ) : s.canManage && calendar && !picked ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive shrink-0"
              disabled={cancelling === s.id}
              onClick={() => cancel(s)}
              aria-label={`Cancel class on ${classDate(s.scheduledAt)}`}
            >
              {cancelling === s.id ? <Loader2 className="size-3 animate-spin" /> : "Cancel"}
            </Button>
          ) : null}
        </div>
      ))}
      {sessions.length > CLASSES_SHOWN && !picked && (
        <button
          type="button"
          className="w-full px-4 py-2 text-left text-xs text-primary hover:bg-muted/30"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show fewer" : `Show all ${sessions.length} classes`}
        </button>
      )}
    </div>
  )
}

// ─── The section ──────────────────────────────────────────────────────────────

/**
 * A course's groups: each group is one class, shown as one card with the two
 * things that define it — its students and when it meets. Adding a group,
 * adding students to it and scheduling its class all happen here, so nobody has
 * to work out which class in a separate list belongs to which students.
 */
export function CourseGroups({
  courseId,
  courseTitle,
  onTotalChange,
}: {
  courseId: string
  courseTitle: string
  /** Keeps the page's "students enrolled" count in step. */
  onTotalChange?: (total: number) => void
}) {
  const roster = useCourseRoster(courseId, onTotalChange)
  // An admin may have made groups or students view only for this teacher.
  const access = useTutorAccess()
  const { data: groupData, loading: groupsLoading, refetch: refetchGroups } = useFetch<GroupsData>(
    `/api/tutor/courses/${courseId}/groups`,
    { errorMessage: "Could not load groups" },
  )

  // Cards the viewer has opened or closed, by id (a card left alone is open only
  // when it is the only one). Remembered per course on this device, so a reload
  // keeps the student lists the teacher had open or closed.
  const cardsKey = `course:groupCards:${courseId}`
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {}
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(cardsKey) ?? "{}")
      return saved && typeof saved === "object" && !Array.isArray(saved)
        ? Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === "boolean"))
        : {}
    } catch {
      return {}
    }
  })
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  // Group id (or WHOLE_COURSE) a class is being scheduled for.
  const [scheduleFor, setScheduleFor] = useState<string | null>(null)
  // Group id (or UNGROUPED) students are being added to.
  const [addStudentsTo, setAddStudentsTo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removingGroup, setRemovingGroup] = useState<string | null>(null)
  // A group created a moment ago, named here until the list reloads with it.
  const [newGroup, setNewGroup] = useState<{ id: string; name: string } | null>(null)

  const students = useMemo(() => roster.data?.students ?? [], [roster.data])
  const groups = useMemo(() => groupData?.groups ?? [], [groupData])
  const courseSessions = groupData?.courseSessions ?? []
  const totalLessons = roster.data?.totalLessons ?? 0
  const totalTests = roster.data?.totalTests ?? 0

  // A group's students are its members who are on the course.
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])
  const studentsOf = (group: CourseGroup) =>
    group.studentIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const grouped = useMemo(() => new Set(groups.flatMap((g) => g.studentIds)), [groups])
  const ungrouped = students.filter((s) => !grouped.has(s.id))
  const behindTotal = students.filter((s) => s.behind).length
  const finishedTotal = students.filter((s) => s.allDone).length

  const cardCount = groups.length + (ungrouped.length > 0 ? 1 : 0)
  const isOpen = (id: string) => chosen[id] ?? cardCount === 1
  function toggle(id: string) {
    const next = { ...chosen, [id]: !isOpen(id) }
    setChosen(next)
    try {
      window.localStorage.setItem(cardsKey, JSON.stringify(next))
    } catch { /* ignore */ }
  }

  function refreshAll() {
    void roster.refetch()
    void refetchGroups()
  }

  const groupName = (id: string) =>
    groups.find((g) => g.id === id)?.name ?? (newGroup?.id === id ? newGroup.name : "the group")

  /**
   * What the schedule form starts with: this group's last class a week on — or,
   * for a group with no classes yet, the time, length and teacher the course's
   * other classes use. The person then only has to confirm or change the date.
   */
  function classDefaults(target: string): ClassDefaults {
    const own = groups.find((g) => g.id === target)?.sessions ?? (target === WHOLE_COURSE ? courseSessions : [])
    const all = [...groups.flatMap((g) => g.sessions), ...courseSessions]
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    const lastOwn = own.length > 0 ? own[own.length - 1] : null
    const ref = lastOwn ?? (all.length > 0 ? all[all.length - 1] : null)
    if (!ref) return {}
    const at = new Date(ref.scheduledAt)
    return {
      date: lastOwn ? new Date(at.getFullYear(), at.getMonth(), at.getDate() + 7) : undefined,
      time: timeOf(at),
      durationMins: ref.durationMins,
      tutorId: ref.tutorId,
      // The week after this group's last class; a first class starts at Week 1.
      week: lastOwn ? (lastOwn.week ? Math.min(lastOwn.week + 1, 52) : null) : 1,
    }
  }

  async function addStudents(ids: Set<string>) {
    if (ids.size === 0) {
      toast.error("Select at least one student")
      return
    }
    const target = addStudentsTo
    if (!target) return
    setSaving(true)
    try {
      // Into a group: they join the group, and with it the course and its classes.
      const res = await fetch(
        target === UNGROUPED ? roster.url : `/api/tutor/groups/${target}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentIds: [...ids] }),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string }
        toast.error(body.message ?? "Could not add students")
        return
      }
      toast.success(`${ids.size} student${ids.size === 1 ? "" : "s"} added to ${target === UNGROUPED ? "the course" : groupName(target)}`)
      setAddStudentsTo(null)
      refreshAll()
    } catch {
      toast.error("Could not add students")
    } finally {
      setSaving(false)
    }
  }

  async function removeGroup(group: CourseGroup) {
    if (!window.confirm(
      `Take ${group.name} off this course? Its students stay on the course and keep their progress; they move to "Not in a group". Classes already scheduled for the group stay in the timetable.`,
    )) return
    setRemovingGroup(group.id)
    try {
      const res = await fetch(`/api/tutor/courses/${courseId}/groups?groupId=${group.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success(`${group.name} taken off the course`)
      refreshAll()
    } catch {
      toast.error("Could not remove the group")
    } finally {
      setRemovingGroup(null)
    }
  }

  const loading = (roster.loading && !roster.data) || (groupsLoading && !groupData)
  // A course with classes is not empty even before anyone signs up — face-to-face
  // courses usually get their dates first.
  const empty = !loading && groups.length === 0 && students.length === 0 && courseSessions.length === 0

  const table = (list: CourseStudent[]) => (
    <StudentProgressTable
      students={list}
      totalLessons={totalLessons}
      totalTests={totalTests}
      remindingIds={roster.remindingIds}
      trophyIds={roster.trophyIds}
      removingId={roster.removingId}
      onRemind={(s) => roster.remind([s])}
      onTrophy={(s) => roster.giveTrophy([s])}
      onRemove={access.students ? async (s) => { if (await roster.remove(s)) void refetchGroups() } : undefined}
    />
  )

  return (
    // A container, so the cards lay themselves out by the width they are given
    // (a side column on wide screens) rather than by the width of the screen.
    <div className="@container">
      {/* Heading */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="font-bold flex items-center gap-2">
            <Users className="size-4 text-primary" /> Groups &amp; Classes
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading
              ? " "
              : empty
              ? "Each group is one class, with its own students and its own day and time."
              : (groups.length > 0 ? `${groups.length} group${groups.length === 1 ? "" : "s"} · ` : "") +
                `${students.length} student${students.length === 1 ? "" : "s"}` +
                (students.length > 1 && totalLessons + totalTests > 0 ? ` · class average ${roster.data?.classAverage ?? 0}%` : "") +
                (finishedTotal > 0 ? ` · ${finishedTotal} all done 🏆` : "") +
                (behindTotal > 0 ? ` · ${behindTotal} behind` : "")}
          </p>
        </div>
        {!empty && (access.students || access.groups || behindTotal > 0) && (
          <div className="flex flex-wrap gap-2">
            {/* One click for everyone behind: a kind "you can catch up" note */}
            {behindTotal > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="border-amber-300 text-amber-800 hover:bg-amber-50"
                disabled={roster.remindingIds.size > 0}
                onClick={() => roster.remind(students.filter((s) => s.behind))}
                title="Send each student who is behind a kind note to revise and finish their tests"
              >
                {roster.remindingIds.size > 1 ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <BellRing className="size-4 mr-1.5" />}
                Encourage {behindTotal} behind
              </Button>
            )}
            {access.students && (
              <Button size="sm" variant="outline" onClick={() => setAddStudentsTo(UNGROUPED)}>
                <UserPlus className="size-4 mr-1.5" /> Add Students
              </Button>
            )}
            {access.groups && (
              <Button size="sm" onClick={() => setAddGroupOpen(true)}>
                <Plus className="size-4 mr-1.5" /> Add Group
              </Button>
            )}
          </div>
        )}
      </div>

      {(!access.groups || !access.students) && (
        <p className="-mt-2 mb-3 text-xs text-muted-foreground">
          {!access.groups && !access.students
            ? "Groups and students are view only for you. Ask an admin if you need to change them."
            : VIEW_ONLY_MESSAGE[access.groups ? "students" : "groups"]}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : empty ? (
        <Card className="shadow-sm border-dashed py-0">
          <CardContent className="py-4 flex flex-col gap-3">
            <ol className="flex flex-col @xl:flex-row gap-2 @xl:gap-6 text-xs">
              {[
                ["Add a group", "of students, or start a new one."],
                ["Schedule its class", "— a day and time, repeating weekly if you like."],
                ["That's it", "— students see the lessons and their class."],
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-2 @xl:flex-1">
                  <span className="size-4.5 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">
                    <span className="font-semibold text-foreground">{title}</span> {text}
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              {access.groups && (
                <Button size="sm" onClick={() => setAddGroupOpen(true)}>
                  <Plus className="size-4 mr-1.5" /> Add Group
                </Button>
              )}
              {access.students && (
                <Button size="sm" variant="outline" onClick={() => setAddStudentsTo(UNGROUPED)}>
                  <UserPlus className="size-4 mr-1.5" /> Add Students without a group
                </Button>
              )}
              {access.calendar && (
                <Button size="sm" variant="outline" onClick={() => setScheduleFor(WHOLE_COURSE)}>
                  <CalendarPlus className="size-4 mr-1.5" /> Schedule class for the whole course
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const list = studentsOf(group)
            const behind = list.filter((s) => s.behind)
            const summary = classSummary(group.sessions)
            const open = isOpen(group.id)
            return (
              <Card key={group.id} className="shadow-sm overflow-hidden py-0 gap-0" data-group={group.name}>
                <div className="flex items-center gap-2 pr-3 sm:pr-4">
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex items-start gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => toggle(group.id)}
                    aria-expanded={open}
                  >
                    {open
                      ? <ChevronDown className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                      : <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-0.5" />}
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">{group.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {list.length} student{list.length === 1 ? "" : "s"}
                        </span>
                        {behind.length > 0 && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 bg-amber-100 text-amber-700 border-amber-200">
                            {behind.length} behind
                          </Badge>
                        )}
                      </span>
                      <span className={`flex items-center gap-1.5 text-xs mt-1 ${summary ? "text-muted-foreground" : "text-amber-700"}`}>
                        <CalendarClock className="size-3.5 shrink-0" />
                        <span className="truncate">{summary ?? "No class scheduled yet"}</span>
                      </span>
                    </span>
                  </button>
                  {/* Lead with the next thing this group needs. */}
                  {list.length === 0 && group.canEdit && access.groups ? (
                    <Button size="sm" className="shrink-0" title="Add students" onClick={() => setAddStudentsTo(group.id)}>
                      <UserPlus className="size-4 @lg:mr-1.5" />
                      <span className="hidden @lg:inline">Add students</span>
                    </Button>
                  ) : access.calendar && (
                    <Button
                      size="sm"
                      variant={summary ? "outline" : "default"}
                      className="shrink-0"
                      title="Schedule class"
                      onClick={() => setScheduleFor(group.id)}
                    >
                      <CalendarPlus className="size-4 @lg:mr-1.5" />
                      <span className="hidden @lg:inline">Schedule class</span>
                    </Button>
                  )}
                </div>

                {open && (
                  <div className="border-t">
                    {group.sessions.length > 0 && (
                      <>
                        <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Class times
                        </p>
                        <ClassList sessions={group.sessions} onChanged={() => void refetchGroups()} />
                      </>
                    )}

                    <div className={group.sessions.length > 0 ? "border-t" : ""}>
                      {list.length === 0 ? (
                        <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                          No students in this group yet.
                        </p>
                      ) : table(list)}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap border-t bg-muted/20 px-4 py-2.5">
                      {group.canEdit && access.groups && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setAddStudentsTo(group.id)}>
                          <UserPlus className="size-3.5 mr-1.5" /> Add students to group
                        </Button>
                      )}
                      {access.calendar && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setScheduleFor(group.id)}>
                          <CalendarPlus className="size-3.5 mr-1.5" /> Schedule class
                        </Button>
                      )}
                      {behind.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={roster.remindingIds.size > 0}
                          onClick={() => roster.remind(behind)}
                        >
                          <BellRing className="size-3.5 mr-1.5" /> Encourage {behind.length} behind
                        </Button>
                      )}
                      {access.groups && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 ml-auto text-muted-foreground hover:text-destructive"
                          disabled={removingGroup === group.id}
                          onClick={() => removeGroup(group)}
                        >
                          {removingGroup === group.id
                            ? <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                            : <X className="size-3.5 mr-1.5" />}
                          Remove group from course
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            )
          })}

          {/* On the course, in no group */}
          {ungrouped.length > 0 && (
            <Card className="shadow-sm overflow-hidden py-0 gap-0" data-group="Not in a group">
              <div className="flex items-center gap-2 pr-3 sm:pr-4">
                <button
                  type="button"
                  className="flex-1 min-w-0 flex items-start gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => toggle(UNGROUPED)}
                  aria-expanded={isOpen(UNGROUPED)}
                >
                  {isOpen(UNGROUPED)
                    ? <ChevronDown className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                    : <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-0.5" />}
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">Not in a group</span>
                      <span className="text-xs text-muted-foreground">
                        {ungrouped.length} student{ungrouped.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="block text-xs text-muted-foreground mt-1">
                      {groups.length > 0
                        ? "On the course, but only invited to classes for the whole course. Add them to a group to give them its class times."
                        : "Schedule a class for everyone, or put them in groups to give each its own day and time."}
                    </span>
                  </span>
                </button>
                {groups.length === 0 && access.calendar && (
                  <Button size="sm" variant="outline" className="shrink-0" title="Schedule class" onClick={() => setScheduleFor(WHOLE_COURSE)}>
                    <CalendarPlus className="size-4 @lg:mr-1.5" />
                    <span className="hidden @lg:inline">Schedule class</span>
                  </Button>
                )}
              </div>
              {isOpen(UNGROUPED) && <div className="border-t">{table(ungrouped)}</div>}
            </Card>
          )}

          {/* Classes for everyone on the course */}
          {courseSessions.length > 0 && (
            <Card className="shadow-sm overflow-hidden py-0 gap-0" data-group="Whole course">
              <div className="flex items-start gap-2 px-4 pt-3.5 pb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Classes for the whole course</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Everyone on the course can join these, whichever group they are in, unless marked otherwise.
                  </p>
                </div>
                {access.calendar && (
                  <Button size="sm" variant="outline" className="shrink-0" title="Schedule class" onClick={() => setScheduleFor(WHOLE_COURSE)}>
                    <CalendarPlus className="size-4 @lg:mr-1.5" />
                    <span className="hidden @lg:inline">Schedule class</span>
                  </Button>
                )}
              </div>
              <div className="border-t">
                <ClassList sessions={courseSessions} onChanged={() => void refetchGroups()} showInviteOnly />
              </div>
            </Card>
          )}
        </div>
      )}

      {addGroupOpen && (
        <AddGroupDialog
          courseId={courseId}
          attachedIds={new Set(groups.map((g) => g.id))}
          onClose={() => setAddGroupOpen(false)}
          onAdded={(group, isNew) => {
            refreshAll()
            // A brand-new group is empty: go straight on to choosing its students.
            if (isNew) { setNewGroup(group); setAddStudentsTo(group.id) }
          }}
        />
      )}

      {scheduleFor && groupData && (
        <ScheduleClassDialog
          courseId={courseId}
          courseTitle={courseTitle}
          groups={groups}
          initialTarget={scheduleFor}
          defaults={classDefaults(scheduleFor)}
          mustAssignTutor={groupData.mustAssignTutor}
          tutorOptions={groupData.tutorOptions}
          inPerson={groupData.format === "IN_PERSON"}
          courseVenue={groupData.venue}
          onClose={() => setScheduleFor(null)}
          onScheduled={() => void refetchGroups()}
        />
      )}

      {addStudentsTo && (
        <StudentPickerModal
          selected={new Set()}
          excludeIds={
            addStudentsTo === UNGROUPED
              ? new Set(students.map((s) => s.id))
              : new Set(groups.find((g) => g.id === addStudentsTo)?.studentIds ?? [])
          }
          hideGroups
          title={
            addStudentsTo === UNGROUPED
              ? "Add Students to Course"
              : `Add Students to ${groupName(addStudentsTo)}`
          }
          description={
            addStudentsTo === UNGROUPED
              ? "These students join the course without a group. Students already on the course are not shown."
              : "They join this group, the course, and the group's upcoming classes."
          }
          confirmLabel={addStudentsTo === UNGROUPED ? "Add to Course" : "Add to Group"}
          confirming={saving}
          onConfirm={(ids) => void addStudents(ids)}
          onClose={() => { if (!saving) setAddStudentsTo(null) }}
        />
      )}
    </div>
  )
}
