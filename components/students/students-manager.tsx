"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Users, Search, BookOpen, Loader2, ChevronDown, ChevronUp,
  CalendarPlus, Check, Filter, ArrowUpDown, FolderOpen,
  UserPlus, ClipboardCheck, BellRing, Clock, LogIn, GraduationCap, Activity, ArrowRight, UserX
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { useRememberedState } from "@/hooks/use-remembered-state"
import { Pagination } from "@/components/ui/pagination"
import { ManageGroupsModal } from "@/components/classroom/ManageGroupsModal"
import { InviteStudentsEmailModal } from "@/components/tutor/InviteStudentsEmailModal"
import { toast } from "sonner"
import { levelColor, type CourseLevel } from "@/lib/levels"
import { useTutorAccess } from "@/components/tutor-access-provider"
import { VIEW_ONLY_MESSAGE } from "@/lib/tutor-areas"
import { ENGAGEMENT_LOOK, STUDY_WINDOW_DAYS, agoLabel, type Engagement } from "@/lib/engagement"

type TestStatus = "PASSED" | "WITH_TEACHER" | "NOT_PASSED" | "TO_MARK" | "STARTED" | "RETURNED" | "NOT_STARTED"

type CourseProgress = {
  id: string
  title: string
  enrolledAt: string
  totalLessons: number
  completedLessons: number
  completion: number
  tests: { id: string; title: string; status: TestStatus; score: number | null; attempts: number }[]
}

// What each test status looks like — red and amber are the ones still to do.
const TEST_STATUS: Record<TestStatus, { label: string; className: string }> = {
  PASSED:       { label: "Passed",                className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  WITH_TEACHER: { label: "Sent in – to mark",     className: "bg-sky-50 text-sky-700 border-sky-200" },
  NOT_PASSED:   { label: "Done – not passed",     className: "bg-orange-50 text-orange-700 border-orange-200" },
  TO_MARK:      { label: "Not finished – marking", className: "bg-amber-50 text-amber-700 border-amber-200" },
  STARTED:      { label: "Started – not sent",    className: "bg-amber-50 text-amber-700 border-amber-200" },
  RETURNED:     { label: "Sent back to student",  className: "bg-amber-50 text-amber-700 border-amber-200" },
  NOT_STARTED:  { label: "Not started",           className: "bg-red-50 text-red-700 border-red-200" },
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Statuses that still need something from the student (as lib/test-progress.ts). */
const UNFINISHED: ReadonlySet<TestStatus> = new Set(["NOT_STARTED", "STARTED", "RETURNED", "TO_MARK"])

type Show = "all" | "unfinished" | "away" | "done" | Engagement

const SHOW_FILTER: Record<Exclude<Show, "all">, (s: Student) => boolean> = {
  unfinished: (s) => s.testsUnfinished > 0,
  // Kept for a filter remembered from before the engagement cards.
  away: (s) => s.engagement === "inactive" || s.engagement === "never",
  done: (s) => s.testsUnfinished === 0 && s.testsDone > 0,
  studying: (s) => s.engagement === "studying",
  browsing: (s) => s.engagement === "browsing",
  inactive: (s) => s.engagement === "inactive",
  never: (s) => s.engagement === "never",
}

type SummaryCard = { key: Exclude<Show, "all">; label: string; icon: typeof Clock; iconBg: string; iconColor: string; active: string }

// Who is actually studying — the first thing a teacher wants to know.
const ENGAGEMENT_SUMMARY: SummaryCard[] = [
  { key: "studying", label: `Studying (last ${STUDY_WINDOW_DAYS} days)`, icon: GraduationCap, iconBg: "bg-emerald-50", iconColor: "text-emerald-600", active: "bg-emerald-50/60 border-emerald-200 ring-emerald-200" },
  { key: "browsing", label: "Signing in, not studying", icon: LogIn, iconBg: "bg-amber-50", iconColor: "text-amber-600", active: "bg-amber-50/60 border-amber-200 ring-amber-200" },
  { key: "inactive", label: `Inactive ${STUDY_WINDOW_DAYS}+ days`, icon: Clock, iconBg: "bg-red-50", iconColor: "text-red-600", active: "bg-red-50/60 border-red-200 ring-red-200" },
  { key: "never", label: "Never signed in", icon: UserX, iconBg: "bg-muted", iconColor: "text-muted-foreground", active: "bg-muted/60 border-border ring-border" },
]

const SUMMARY: SummaryCard[] = [
  { key: "unfinished", label: "Have tests not finished", icon: ClipboardCheck, iconBg: "bg-red-50", iconColor: "text-red-600", active: "bg-red-50/60 border-red-200 ring-red-200" },
  { key: "done", label: "Finished every test", icon: Check, iconBg: "bg-emerald-50", iconColor: "text-emerald-600", active: "bg-emerald-50/60 border-emerald-200 ring-emerald-200" },
]

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS) : null
}

function seenLabel(iso: string | null) {
  const days = daysSince(iso)
  return days === null ? "Never" : days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`
}

function seenClass(iso: string | null) {
  const days = daysSince(iso)
  return days === null || days >= 7 ? "text-red-600 font-semibold" : days >= 3 ? "text-amber-600 font-medium" : "text-emerald-700"
}

const shortDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })

type Student = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  bslLevel: string | null
  joinedAt: string
  source: "enrolled" | "invited" | "both"
  /** Last time they used the platform, and the UK dates they used it on in the last 30 days. */
  lastSeenAt: string | null
  activeDates: string[]
  lastLoginAt: string | null
  /** Last lesson, test, class, league game or reflection, and the UK dates with any in the last 30 days. */
  lastStudiedAt: string | null
  studyDates: string[]
  engagement: Engagement
  online: boolean
  lastRemindedAt: string | null
  testsDone: number
  testsUnfinished: number
  courses: CourseProgress[]
}

type StudentsData = { students: Student[]; total: number }

type LiveSession = {
  id: string
  title: string
  scheduledAt: string
  status: string
  course: { id: string; title: string } | null
}

type SessionsData = { sessions: LiveSession[] }

const PAGE_SIZE = 50

// Student · Level · Courses · Activity · Tests · Progress · actions
const COLUMNS = "sm:grid-cols-[1fr_56px_56px_132px_104px_90px_40px]"

type SortKey = "name-asc" | "name-desc" | "joined-desc" | "joined-asc" | "progress-desc" | "progress-asc" | "tests-unfinished" | "seen-oldest" | "studied-oldest" | "studied-recent"

const SORT_LABELS: Record<SortKey, string> = {
  "name-asc": "Name A→Z",
  "name-desc": "Name Z→A",
  "joined-desc": "Joined (newest)",
  "joined-asc": "Joined (oldest)",
  "progress-desc": "Progress (high)",
  "progress-asc": "Progress (low)",
  "tests-unfinished": "Most tests not finished",
  "seen-oldest": "Not seen for longest",
  "studied-oldest": "Not studied for longest",
  "studied-recent": "Studied most recently",
}

function EngagementPill({ student }: { student: Student }) {
  const look = ENGAGEMENT_LOOK[student.engagement]
  return (
    <span title={look.hint} className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none w-fit ${look.className}`}>
      <span className={`size-1.5 rounded-full ${look.dot}`} />
      {look.label === "Signing in, not studying" ? "Not studying" : look.label}
    </span>
  )
}

function InviteModal({
  student,
  onClose,
}: {
  student: Student
  onClose: () => void
}) {
  const { data, loading } = useFetch<SessionsData>("/api/tutor/sessions", {
    errorMessage: "Could not load sessions",
  })
  const [sending, setSending] = useState<string | null>(null)
  const [sent, setSent] = useState<Set<string>>(new Set())

  const scheduled = (data?.sessions ?? []).filter((s) => s.status === "SCHEDULED")

  async function invite(sessionId: string) {
    setSending(sessionId)
    try {
      const res = await fetch(`/api/tutor/sessions/${sessionId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id }),
      })
      if (res.ok) setSent((prev) => new Set(prev).add(sessionId))
    } finally {
      setSending(null)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to Live Classroom</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Invite <span className="font-medium text-foreground">{student.name}</span> to a scheduled session
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : scheduled.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No scheduled sessions. Create one in the Classroom tab.
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
            {scheduled.map((s) => {
              const alreadySent = sent.has(s.id)
              const isSending = sending === s.id
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(s.scheduledAt).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {s.course ? ` · ${s.course.title}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={alreadySent ? "outline" : "default"}
                    className="shrink-0 h-7 text-xs gap-1"
                    disabled={alreadySent || isSending}
                    onClick={() => invite(s.id)}
                  >
                    {isSending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : alreadySent ? (
                      <><Check className="size-3" /> Invited</>
                    ) : (
                      "Invite"
                    )}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}


export function StudentsManager() {
  const router = useRouter()
  // Admins see the same list; their course pages live under /admin.
  const pathname = usePathname()
  const base = pathname.startsWith("/admin") ? "/admin" : "/tutor"
  // Where this role's student pages live (support has its own tree).
  const pathBase = pathname.startsWith("/support") ? "/support" : base
  // The summary cards above the list double as quick filters.
  const [show, setShow] = useRememberedState<Show>("show", "all")
  const [remindingKey, setRemindingKey] = useState<string | null>(null)
  const access = useTutorAccess()
  const [query, setQuery] = useRememberedState("query", "")
  const [page, setPage] = useRememberedState("page", 1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [levelFilter, setLevelFilter] = useRememberedState<string>("levelFilter", "ALL")
  const [sortKey, setSortKey] = useRememberedState<SortKey>("sortKey", "name-asc")
  const [inviteStudent, setInviteStudent] = useState<Student | null>(null)
  const [messagingId, setMessagingId] = useState<string | null>(null)
  const [showGroups, setShowGroups] = useState(false)
  const [showEmailInvite, setShowEmailInvite] = useState(false)

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)

  const { data, loading, refetch } = useFetch<StudentsData>(`/api/tutor/students?${params.toString()}`, {
    errorMessage: "Could not load students",
  })

  const allStudents = data?.students ?? []

  // Filter + sort client-side
  const processed = useMemo(() => {
    let list = allStudents
    if (levelFilter !== "ALL") list = list.filter((s) => s.bslLevel === levelFilter)
    if (show !== "all") list = list.filter(SHOW_FILTER[show])

    list = [...list].sort((a, b) => {
      const aProgress = a.courses.length > 0
        ? a.courses.reduce((s, c) => s + c.completion, 0) / a.courses.length : 0
      const bProgress = b.courses.length > 0
        ? b.courses.reduce((s, c) => s + c.completion, 0) / b.courses.length : 0

      switch (sortKey) {
        case "name-asc": return a.name.localeCompare(b.name)
        case "name-desc": return b.name.localeCompare(a.name)
        case "joined-desc": return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
        case "joined-asc": return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
        case "progress-desc": return bProgress - aProgress
        case "progress-asc": return aProgress - bProgress
        case "tests-unfinished": return b.testsUnfinished - a.testsUnfinished || a.name.localeCompare(b.name)
        case "seen-oldest": {
          const seen = (s: Student) => (s.lastSeenAt ? new Date(s.lastSeenAt).getTime() : 0)
          return seen(a) - seen(b)
        }
        case "studied-oldest":
        case "studied-recent": {
          const studied = (s: Student) => (s.lastStudiedAt ? new Date(s.lastStudiedAt).getTime() : 0)
          return sortKey === "studied-oldest" ? studied(a) - studied(b) : studied(b) - studied(a)
        }
        default: return 0
      }
    })
    return list
  }, [allStudents, levelFilter, show, sortKey])

  /** Sends one student a reminder now, naming the tests they have left on that course. */
  async function remindNow(student: Student, course: CourseProgress) {
    const left = course.tests.filter((t) => UNFINISHED.has(t.status)).map((t) => t.title)
    setRemindingKey(`${student.id}:${course.id}`)
    try {
      const res = await fetch(`/api/tutor/courses/${course.id}/students/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: [student.id], message: left.length ? `Tests to finish: ${left.join(", ")}.` : undefined }),
      })
      const body = await res.json().catch(() => ({})) as { sent?: number; message?: string }
      if (!res.ok) toast.error(body.message ?? "Could not send the reminder")
      else if (!body.sent) toast.info(`${student.name} was already reminded today`)
      else { toast.success(`Reminder sent to ${student.name}`); void refetch() }
    } catch {
      toast.error("Could not send the reminder")
    } finally {
      setRemindingKey(null)
    }
  }

  const totalPages = Math.ceil(processed.length / PAGE_SIZE)
  const paginated = processed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function openMessage(student: Student) {
    setMessagingId(student.id)
    try {
      await fetch("/api/messages/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: student.id }),
      })
      router.push("/tutor/messages")
    } finally {
      setMessagingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Users className="size-6 text-primary" /> Students
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {loading ? "\u00A0" : `${data?.total ?? 0} student${data?.total !== 1 ? "s" : ""} enrolled across your courses`}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowGroups(true)}>
            <FolderOpen className="size-3.5" /> {access.groups ? "Manage Groups" : "Groups"}
          </Button>
          {access.students && (
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowEmailInvite(true)}>
              <UserPlus className="size-3.5" /> Invite Students
            </Button>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search students..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1) }}
              className="pl-8 h-8 w-48 text-sm"
            />
          </div>

          {/* Level filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Filter className="size-3" />
                {levelFilter === "ALL" ? "All Levels" : levelFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setLevelFilter("ALL"); setPage(1) }}>
                All Levels {levelFilter === "ALL" && <Check className="ml-auto size-3" />}
              </DropdownMenuItem>
              {(["L1","L2","L3","L4","L5","L6"] as CourseLevel[]).map((l) => (
                <DropdownMenuItem key={l} onClick={() => { setLevelFilter(l); setPage(1) }}>
                  {l} {levelFilter === l && <Check className="ml-auto size-3" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <ArrowUpDown className="size-3" />
                {SORT_LABELS[sortKey]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([key, label]) => (
                <DropdownMenuItem key={key} onClick={() => setSortKey(key)}>
                  {label} {sortKey === key && <Check className="ml-auto size-3" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!access.students && <p className="text-xs text-muted-foreground -mt-2">{VIEW_ONLY_MESSAGE.students}</p>}

      {/* At a glance: who needs chasing. Each card filters the list. */}
      {!loading && allStudents.length > 0 && (
        <div className="flex flex-col gap-2">
          {[ENGAGEMENT_SUMMARY, SUMMARY].map((cards, row) => (
          <div key={row} className={`grid grid-cols-1 gap-2 ${row === 0 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}>
            {cards.map((card) => {
              const count = allStudents.filter(SHOW_FILTER[card.key]).length
              const active = show === card.key
              const Icon = card.icon
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => { setShow(active ? "all" : card.key); setPage(1) }}
                  aria-pressed={active}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:shadow-sm ${active ? `${card.active} ring-2` : "bg-card hover:bg-muted/30"}`}
                >
                  <div className={`rounded-lg p-2 shrink-0 ${card.iconBg}`}>
                    <Icon className={`size-4 ${card.iconColor}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xl font-black leading-none ${count > 0 ? card.iconColor : "text-muted-foreground"}`}>{count}</p>
                    <p className="text-xs text-muted-foreground mt-1">{card.label}</p>
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground shrink-0">{active ? "Show all" : "Show"}</span>
                </button>
              )
            })}
          </div>
          ))}
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Activity className="size-3 shrink-0" />
            &ldquo;Studying&rdquo; means a lesson, test, live class, league game or self-reflection in the last{` ${STUDY_WINDOW_DAYS} days `}&mdash; not just signing in.
          </p>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <BellRing className="size-3 shrink-0" />
            Students with tests not finished get an email reminder automatically every 2 days until they finish. Click a student to see each test.
          </p>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center min-h-75">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : paginated.length ? (
        <Card className="shadow-sm overflow-hidden py-0 gap-0">
          {/* Column headers */}
          <div className={`hidden sm:grid ${COLUMNS} gap-3 px-4 py-2 border-b bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground`}>
            <span>Student</span>
            <span>Level</span>
            <span className="text-center">Courses</span>
            <span>Activity</span>
            <span>Tests</span>
            <span>Progress</span>
            <span />
          </div>

          <div className="divide-y">
            {paginated.map((student) => {
              const isExpanded = expandedId === student.id
              const initials = student.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
              const overallCompletion = student.courses.length > 0
                ? Math.round(student.courses.reduce((s, c) => s + c.completion, 0) / student.courses.length)
                : 0
              const isMessaging = messagingId === student.id

              return (
                <div key={student.id}>
                  {/* Student row */}
                  <div className={`grid grid-cols-[1fr_auto] ${COLUMNS} items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors group`}>
                    {/* Name + email — clickable to expand */}
                    <button
                      className="flex items-center gap-2.5 min-w-0 text-left"
                      onClick={() => setExpandedId(isExpanded ? null : student.id)}
                    >
                      <span className="relative shrink-0">
                        <Avatar className="size-7">
                          {student.avatarUrl && <AvatarImage src={student.avatarUrl} alt={student.name} />}
                          <AvatarFallback className="bg-primary/10 text-primary font-semibold text-[10px]">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        {student.online && (
                          <span title="Online now" className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate leading-none">{student.name}</span>
                          {(student.source === "invited" || student.source === "both") && (
                            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-sky-50 text-sky-600 border-sky-200">
                              Invited
                            </span>
                          )}
                          {isExpanded
                            ? <ChevronUp className="size-3 text-muted-foreground shrink-0" />
                            : <ChevronDown className="size-3 text-muted-foreground shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{student.email}</p>
                        {/* Phones: the two things that matter most, under the name. */}
                        <p className="sm:hidden text-[11px] mt-0.5 flex flex-wrap items-center gap-x-1">
                          <EngagementPill student={student} />
                          <span className={seenClass(student.lastSeenAt)}>Seen {seenLabel(student.lastSeenAt).toLowerCase()}</span>
                          {student.testsUnfinished > 0 && <span className="text-red-600 font-semibold"> · {student.testsUnfinished} test{student.testsUnfinished === 1 ? "" : "s"} not finished</span>}
                        </p>
                      </div>
                    </button>

                    {/* Level */}
                    <div className="hidden sm:flex">
                      {student.bslLevel ? (
                        <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${levelColor[student.bslLevel as CourseLevel] ?? ""}`}>
                          {student.bslLevel}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    {/* Courses */}
                    <div className="hidden sm:flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <BookOpen className="size-3" />
                      {student.courses.length}
                    </div>

                    {/* Activity: are they studying, and when were they last on */}
                    <div className="hidden sm:flex flex-col gap-1 text-[11px] leading-tight min-w-0">
                      <EngagementPill student={student} />
                      <span
                        className={seenClass(student.lastSeenAt)}
                        title={[
                          `Last on the platform: ${student.lastSeenAt ? new Date(student.lastSeenAt).toLocaleString("en-GB") : "never"}`,
                          `Last studied: ${student.lastStudiedAt ? new Date(student.lastStudiedAt).toLocaleString("en-GB") : "never"}`,
                        ].join("\n")}
                      >
                        {student.online ? "Online now" : `Seen ${seenLabel(student.lastSeenAt).toLowerCase()}`}
                      </span>
                    </div>

                    {/* Tests */}
                    <div className="hidden sm:flex flex-col text-xs leading-tight">
                      {student.testsDone + student.testsUnfinished === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span>{student.testsDone} of {student.testsDone + student.testsUnfinished} done</span>
                          {student.testsUnfinished > 0
                            ? <span className="text-[11px] text-red-600 font-semibold">{student.testsUnfinished} not finished</span>
                            : <span className="text-[11px] text-emerald-700 font-medium">All done</span>}
                        </>
                      )}
                    </div>

                    {/* Progress */}
                    <div className="hidden sm:flex flex-col gap-1">
                      <span className="text-[11px] font-medium">{overallCompletion}%</span>
                      <Progress value={overallCompletion} className="h-1.5 w-full" />
                    </div>

                    <div className="flex items-center gap-1 justify-end">
                      {/* Inviting to a class changes the calendar. */}
                      {access.calendar && <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 sm:size-7 text-muted-foreground hover:text-foreground"
                        title="Invite to a live class"
                        aria-label={`Invite ${student.name} to a live class`}
                        onClick={() => setInviteStudent(student)}
                      >
                        <CalendarPlus className="size-3.5" />
                      </Button>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t bg-muted/10">
                      {/* When they have been on the platform, and reminders */}
                      <div className="px-4 py-2.5 border-b border-dashed text-xs flex flex-col gap-1">
                        {/* The whole history — learning, homework, sign-ins — is one tap away. */}
                        <Link
                          href={`${pathBase}/students/${student.id}`}
                          className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
                        >
                          See {student.name.split(" ")[0]}&apos;s full learning history <ArrowRight className="size-3.5" />
                        </Link>
                        <p className="flex items-center gap-1.5">
                          <Clock className="size-3.5 text-muted-foreground shrink-0" />
                          <span>
                            Last seen{" "}
                            <span className={seenClass(student.lastSeenAt)}>
                              {student.lastSeenAt
                                ? new Date(student.lastSeenAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                                : "never"}
                            </span>
                            {" · "}on the platform on {student.activeDates.length} day{student.activeDates.length === 1 ? "" : "s"} in the last 30
                          </span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <LogIn className="size-3.5 text-muted-foreground shrink-0" />
                          <span>
                            Last signed in{" "}
                            <span className="font-medium">
                              {student.lastLoginAt
                                ? new Date(student.lastLoginAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                                : "— not recorded yet"}
                            </span>
                          </span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <GraduationCap className="size-3.5 text-muted-foreground shrink-0" />
                          <span>
                            Last studied{" "}
                            <span className="font-medium">{agoLabel(student.lastStudiedAt).toLowerCase()}</span>
                            {" · "}studied on {student.studyDates.length} of the {student.activeDates.length} day{student.activeDates.length === 1 ? "" : "s"} they were on
                          </span>
                        </p>
                        {student.activeDates.length > 0 && (
                          <div className="flex flex-wrap gap-1 pl-5">
                            {student.activeDates.map((d) => {
                              const studied = student.studyDates.includes(d)
                              return (
                                <span
                                  key={d}
                                  title={studied ? "Studied this day" : "Signed in, no learning"}
                                  className={`rounded border px-1.5 py-0.5 text-[10px] ${studied ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-background text-muted-foreground"}`}
                                >
                                  {shortDay(d)}
                                </span>
                              )
                            })}
                          </div>
                        )}
                        <p className="flex items-center gap-1.5 text-muted-foreground">
                          <BellRing className="size-3.5 shrink-0" />
                          {student.lastRemindedAt
                            ? `Last reminded ${new Date(student.lastRemindedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`
                            : "Not reminded yet"}
                          {student.testsUnfinished > 0 ? " · reminded by email every 2 days until their tests are finished" : ""}
                        </p>
                      </div>
                      <div className="px-4 py-1.5 border-b border-dashed">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Enrolled Courses
                        </p>
                      </div>
                      {student.courses.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-muted-foreground">No courses enrolled.</p>
                      ) : student.courses.map((course, i) => (
                        <div key={course.id} className={`px-4 py-2.5 ${i > 0 ? "border-t" : ""}`}>
                          {/* On a phone the title gets the full width and Remind + progress wrap below it. */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <div className="rounded-md bg-primary/10 p-1 shrink-0">
                            <BookOpen className="size-3.5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-48">
                            <p className="text-sm font-medium sm:truncate">{course.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {course.completedLessons}/{course.totalLessons} lessons ·{" "}
                              Enrolled {new Date(course.enrolledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            </p>
                          </div>
                          {course.tests.some((t) => UNFINISHED.has(t.status)) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 sm:h-7 px-2 text-xs gap-1 shrink-0 ml-8 sm:ml-0"
                              disabled={remindingKey === `${student.id}:${course.id}`}
                              onClick={() => void remindNow(student, course)}
                              title="Send a reminder now, naming the tests left on this course"
                            >
                              {remindingKey === `${student.id}:${course.id}`
                                ? <Loader2 className="size-3.5 animate-spin" />
                                : <BellRing className="size-3.5" />}
                              Remind now
                            </Button>
                          )}
                          <div className="flex flex-col items-end gap-1 w-20 shrink-0 ml-auto">
                            <span className="text-[11px] font-semibold">{course.completion}%</span>
                            <Progress value={course.completion} className="h-1.5 w-full" />
                          </div>
                          </div>
                          {/* Every released test on the course, done or not */}
                          {course.tests.length > 0 && (
                            <div className="mt-2 ml-8 flex flex-col divide-y rounded-md border bg-background">
                              {course.tests.map((t) => {
                                const look = TEST_STATUS[t.status]
                                return (
                                  <Link
                                    key={t.id}
                                    href={`${base}/courses/${course.id}/lessons/${t.id}`}
                                    className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/40"
                                    title="Open this test's results"
                                  >
                                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                                    {t.score !== null && (t.status === "PASSED" || t.status === "NOT_PASSED") && (
                                      <span className="text-muted-foreground shrink-0">{t.score}%</span>
                                    )}
                                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${look.className}`}>
                                      {look.label}
                                    </span>
                                  </Link>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-muted p-6">
              <Users className="size-10 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-lg">
                {debouncedQuery || levelFilter !== "ALL" || show !== "all"
                  ? "No students match your filters"
                  : "No students yet"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {debouncedQuery || levelFilter !== "ALL" || show !== "all"
                  ? "Try adjusting your search or filters."
                  : "Students will appear here once they enrol in your courses or accept your invitation."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="mt-2" />
      )}

      {inviteStudent && (
        <InviteModal student={inviteStudent} onClose={() => setInviteStudent(null)} />
      )}

      {showGroups && (
        <ManageGroupsModal onClose={() => setShowGroups(false)} />
      )}

      {showEmailInvite && (
        <InviteStudentsEmailModal onClose={() => setShowEmailInvite(false)} />
      )}
    </div>
  )
}
