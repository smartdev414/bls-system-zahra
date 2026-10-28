"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  Users, Search, BookOpen, Loader2, ChevronDown, ChevronUp,
  CalendarPlus, Check, Filter, ArrowUpDown, FolderOpen,
  UserPlus
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
import { Pagination } from "@/components/ui/pagination"
import { ManageGroupsModal } from "@/components/classroom/ManageGroupsModal"
import { InviteStudentsEmailModal } from "@/components/tutor/InviteStudentsEmailModal"
import { toast } from "sonner"
import { levelColor, type CourseLevel } from "@/lib/levels"
import { useTutorAccess } from "@/components/tutor-access-provider"
import { VIEW_ONLY_MESSAGE } from "@/lib/tutor-areas"

type CourseProgress = {
  id: string
  title: string
  enrolledAt: string
  totalLessons: number
  completedLessons: number
  completion: number
}

type Student = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  bslLevel: string | null
  joinedAt: string
  source: "enrolled" | "invited" | "both"
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

type SortKey = "name-asc" | "name-desc" | "joined-desc" | "joined-asc" | "progress-desc" | "progress-asc"

const SORT_LABELS: Record<SortKey, string> = {
  "name-asc": "Name A→Z",
  "name-desc": "Name Z→A",
  "joined-desc": "Joined (newest)",
  "joined-asc": "Joined (oldest)",
  "progress-desc": "Progress (high)",
  "progress-asc": "Progress (low)",
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
  const access = useTutorAccess()
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [levelFilter, setLevelFilter] = useState<string>("ALL")
  const [sortKey, setSortKey] = useState<SortKey>("name-asc")
  const [inviteStudent, setInviteStudent] = useState<Student | null>(null)
  const [messagingId, setMessagingId] = useState<string | null>(null)
  const [showGroups, setShowGroups] = useState(false)
  const [showEmailInvite, setShowEmailInvite] = useState(false)

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)

  const { data, loading } = useFetch<StudentsData>(`/api/tutor/students?${params.toString()}`, {
    errorMessage: "Could not load students",
  })

  const allStudents = data?.students ?? []

  // Filter + sort client-side
  const processed = useMemo(() => {
    let list = allStudents
    if (levelFilter !== "ALL") list = list.filter((s) => s.bslLevel === levelFilter)

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
        default: return 0
      }
    })
    return list
  }, [allStudents, levelFilter, sortKey])

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

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center min-h-75">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : paginated.length ? (
        <Card className="shadow-sm overflow-hidden">
          {/* Column headers */}
          <div className="hidden sm:grid grid-cols-[1fr_80px_56px_100px_72px] gap-3 px-4 py-2 border-b bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Student</span>
            <span>Level</span>
            <span className="text-center">Courses</span>
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
                  <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_80px_56px_100px_72px] items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors group">
                    {/* Name + email — clickable to expand */}
                    <button
                      className="flex items-center gap-2.5 min-w-0 text-left"
                      onClick={() => setExpandedId(isExpanded ? null : student.id)}
                    >
                      <Avatar className="size-7 shrink-0">
                        {student.avatarUrl && <AvatarImage src={student.avatarUrl} alt={student.name} />}
                        <AvatarFallback className="bg-primary/10 text-primary font-semibold text-[10px]">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
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
                        className="size-7 text-muted-foreground hover:text-foreground"
                        title="Invite to live classroom"
                        onClick={() => setInviteStudent(student)}
                      >
                        <CalendarPlus className="size-3.5" />
                      </Button>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t bg-muted/10">
                      <div className="px-4 py-1.5 border-b border-dashed">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Enrolled Courses
                        </p>
                      </div>
                      {student.courses.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-muted-foreground">No courses enrolled.</p>
                      ) : student.courses.map((course, i) => (
                        <div key={course.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t" : ""}`}>
                          <div className="rounded-md bg-primary/10 p-1 shrink-0">
                            <BookOpen className="size-3.5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{course.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {course.completedLessons}/{course.totalLessons} lessons ·{" "}
                              Enrolled {new Date(course.enrolledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 w-20 shrink-0">
                            <span className="text-[11px] font-semibold">{course.completion}%</span>
                            <Progress value={course.completion} className="h-1.5 w-full" />
                          </div>
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
                {debouncedQuery || levelFilter !== "ALL"
                  ? "No students match your filters"
                  : "No students yet"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {debouncedQuery || levelFilter !== "ALL"
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
