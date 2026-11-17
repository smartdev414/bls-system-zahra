"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeft, BookOpen, CalendarDays, CheckCircle2, ClipboardCheck, Clock, GraduationCap,
  Loader2, LogIn, NotebookPen, ShieldAlert, Trophy, Video, XCircle, PlayCircle,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useFetch } from "@/hooks/use-fetch"
import { StudentReceptiveCard } from "@/components/receptive-log/student-receptive-card"
import { levelColor, type CourseLevel } from "@/lib/levels"
import {
  ENGAGEMENT_LOOK, FAILURE_LABEL, LOGIN_METHOD_LABEL, agoLabel, deviceOf, type Engagement,
} from "@/lib/engagement"

type Kind = "lesson" | "lesson-completed" | "test" | "class" | "league" | "reflection"

type ActivityData = {
  student: {
    id: string; name: string; email: string; avatarUrl: string | null; bslLevel: string | null
    status: string; createdAt: string; lastLoginAt: string | null; lastActiveAt: string | null
  }
  lastSeenAt: string | null
  lastStudiedAt: string | null
  engagement: Engagement
  online: boolean
  last30: { daysActive: number; daysStudied: number; logins: number; failedLogins: number } & Record<Kind, number>
  days: Array<{ date: string; active: boolean; learning: number; kinds: Partial<Record<Kind, number>> }>
  courses: Array<{
    id: string; title: string; enrolledAt: string
    totalLessons: number; completedLessons: number
    /** Homework tests released so far, and how many they've sat or sent in. */
    totalTests: number; testsDone: number
    /** Lessons and tests together, 0–100. */
    completion: number
    classAverage: number
    behindClass: boolean
    inactive: boolean
    closed: boolean
  }>
  timeline: Array<{ at: string; kind: Kind; title: string; detail: string | null }>
  logins: Array<{
    id: string; createdAt: string; success: boolean; method: string; failureReason: string | null
    client: string; ip: string | null; userAgent: string | null
  }>
}

const KIND_LOOK: Record<Kind, { label: string; icon: typeof BookOpen; color: string }> = {
  lesson: { label: "Lesson", icon: PlayCircle, color: "text-sky-600 bg-sky-50 dark:bg-sky-950/40" },
  "lesson-completed": { label: "Lesson completed", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
  test: { label: "Test", icon: ClipboardCheck, color: "text-violet-600 bg-violet-50 dark:bg-violet-950/40" },
  class: { label: "Live class", icon: Video, color: "text-rose-600 bg-rose-50 dark:bg-rose-950/40" },
  league: { label: "League", icon: Trophy, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
  reflection: { label: "Self-reflection", icon: NotebookPen, color: "text-teal-600 bg-teal-50 dark:bg-teal-950/40" },
}

const fullDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })

function EngagementBadge({ engagement, online }: { engagement: Engagement; online: boolean }) {
  const look = ENGAGEMENT_LOOK[engagement]
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span title={look.hint} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${look.className}`}>
        <span className={`size-1.5 rounded-full ${look.dot}`} /> {look.label}
      </span>
      {online && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          Online now
        </span>
      )}
    </span>
  )
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon: typeof Clock }) {
  return (
    <div className="rounded-xl border bg-card p-3 flex flex-col gap-1 min-w-0">
      <p className="text-[0.6875rem] text-muted-foreground flex items-center gap-1.5"><Icon className="size-3.5 shrink-0" /> {label}</p>
      <p className="text-lg font-black leading-tight tabular-nums truncate">{value}</p>
      {sub && <p className="text-[0.6875rem] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  )
}

/** 12 weeks, one column per week (Mon → Sun), like a contributions calendar. */
function ActivityCalendar({ days }: { days: ActivityData["days"] }) {
  // Pad the front so the first column starts on a Monday.
  const firstDow = (new Date(`${days[0]?.date}T12:00:00`).getDay() + 6) % 7
  const cells: Array<ActivityData["days"][number] | null> = [...Array(firstDow).fill(null), ...days]
  const weeks: typeof cells[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const shade = (d: ActivityData["days"][number]) =>
    d.learning >= 6 ? "bg-emerald-600"
      : d.learning >= 3 ? "bg-emerald-500"
      : d.learning >= 1 ? "bg-emerald-300 dark:bg-emerald-700"
      : d.active ? "bg-amber-300 dark:bg-amber-700"
      : "bg-muted"

  const tip = (d: ActivityData["days"][number]) => {
    const parts = (Object.entries(d.kinds) as [Kind, number][])
      .filter(([k]) => k !== "lesson-completed")
      .map(([k, n]) => `${n} ${KIND_LOOK[k].label.toLowerCase()}${n === 1 ? "" : "s"}`)
    return `${dayLabel(d.date)}: ${parts.length ? parts.join(", ") : d.active ? "signed in, no learning" : "not on the platform"}`
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        <div className="flex flex-col gap-[3px] pr-1 text-[0.5625rem] text-muted-foreground">
          {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((l, i) => <span key={i} className="h-3 leading-3">{l}</span>)}
        </div>
        {weeks.map((w, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {w.map((d, j) =>
              d ? (
                <span key={d.date} title={tip(d)} className={`size-3 rounded-[3px] ${shade(d)}`} />
              ) : (
                <span key={`pad-${j}`} className="size-3" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap text-[0.6875rem] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-3 rounded-[3px] bg-muted" /> Not on</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded-[3px] bg-amber-300 dark:bg-amber-700" /> Signed in, no learning</span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-[3px] bg-emerald-300 dark:bg-emerald-700" />
          <span className="size-3 rounded-[3px] bg-emerald-500" />
          <span className="size-3 rounded-[3px] bg-emerald-600" /> Studying (more → darker)
        </span>
      </div>
    </div>
  )
}

export function StudentActivityView({ studentId }: { studentId: string }) {
  const pathname = usePathname()
  const base = pathname.split("/")[1] // tutor | admin | support
  const { data, loading, error } = useFetch<ActivityData>(`/api/tutor/students/${studentId}/activity`, {
    errorMessage: "Could not load this student's activity",
  })

  if (loading && !data) {
    return <div className="flex items-center justify-center min-h-75"><Loader2 className="size-8 animate-spin text-primary" /></div>
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink base={base} />
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{error?.message ?? "Student not found."}</CardContent></Card>
      </div>
    )
  }

  const { student, last30 } = data
  const initials = student.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
  const failed30 = last30.failedLogins
  const showIp = data.logins.some((l) => l.ip)

  return (
    <div className="flex flex-col gap-4">
      <BackLink base={base} />

      {/* Who, and the one-line answer: are they studying? */}
      <Card className="shadow-sm">
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Avatar className="size-14 shrink-0">
            {student.avatarUrl && <AvatarImage src={student.avatarUrl} alt={student.name} />}
            <AvatarFallback className="bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black tracking-tight truncate">{student.name}</h1>
              {student.bslLevel && (
                <Badge variant="outline" className={`text-[0.625rem] h-5 px-1.5 ${levelColor[student.bslLevel as CourseLevel] ?? ""}`}>{student.bslLevel}</Badge>
              )}
              {student.status !== "ACTIVE" && <Badge variant="outline" className="text-[0.625rem] h-5">{student.status.toLowerCase()}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="break-all">{student.email}</span>
              {" · "}
              <span className="whitespace-nowrap">joined {new Date(student.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            </p>
            <EngagementBadge engagement={data.engagement} online={data.online} />
          </div>
        </CardContent>
      </Card>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {/* Sign-ins are only recorded since 11 Nov 2026, so "Never" would be wrong for anyone older. */}
        <Stat icon={LogIn} label="Last sign-in" value={student.lastLoginAt ? agoLabel(student.lastLoginAt) : "Not yet"} sub={student.lastLoginAt ? fullDate(student.lastLoginAt) : "Recorded from their next sign-in"} />
        <Stat icon={Clock} label="Last on the platform" value={agoLabel(data.lastSeenAt)} sub={data.lastSeenAt ? fullDate(data.lastSeenAt) : undefined} />
        <Stat icon={GraduationCap} label="Last studied" value={agoLabel(data.lastStudiedAt)} sub={data.lastStudiedAt ? fullDate(data.lastStudiedAt) : "No learning yet"} />
        <Stat icon={CalendarDays} label="Days on, last 30" value={last30.daysActive} sub={student.lastLoginAt ? `${last30.logins} sign-in${last30.logins === 1 ? "" : "s"}` : undefined} />
        <Stat icon={BookOpen} label="Days studied, last 30" value={last30.daysStudied} sub={last30.daysActive > last30.daysStudied ? `${last30.daysActive - last30.daysStudied} day${last30.daysActive - last30.daysStudied === 1 ? "" : "s"} on without studying` : undefined} />
        <Stat icon={ClipboardCheck} label="Done in last 30 days" value={last30.lesson + last30.test + last30.class + last30.league + last30.reflection}
          sub={[
            last30["lesson-completed"] && `${last30["lesson-completed"]} lesson${last30["lesson-completed"] === 1 ? "" : "s"} done`,
            last30.test && `${last30.test} test${last30.test === 1 ? "" : "s"}`,
            last30.class && `${last30.class} class${last30.class === 1 ? "" : "es"}`,
          ].filter(Boolean).join(" · ") || "Nothing yet"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        <div className="flex flex-col gap-4 min-w-0">
          <Card className="shadow-sm">
            <CardHeader><CardTitle className="text-sm">Last 12 weeks</CardTitle></CardHeader>
            <CardContent><ActivityCalendar days={data.days} /></CardContent>
          </Card>

          <StudentReceptiveCard studentId={student.id} studentName={student.name} />

          <Card className="shadow-sm gap-0">
            <CardHeader className="pb-3"><CardTitle className="text-sm">Learning activity</CardTitle></CardHeader>
            {data.timeline.length === 0 ? (
              <CardContent className="py-8 text-center text-sm text-muted-foreground">No lessons, tests or classes yet.</CardContent>
            ) : (
              <ol className="divide-y border-t">
                {data.timeline.map((t, i) => {
                  const look = KIND_LOOK[t.kind]
                  const Icon = look.icon
                  return (
                    <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                      <span className={`rounded-md p-1.5 shrink-0 ${look.color}`}><Icon className="size-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{t.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{t.detail ?? look.label}</p>
                      </div>
                      <time className="text-[0.6875rem] text-muted-foreground shrink-0 text-right" dateTime={t.at} title={fullDate(t.at)}>
                        {agoLabel(t.at)}
                      </time>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <Card className="shadow-sm gap-0">
            <CardHeader className="pb-3"><CardTitle className="text-sm">Courses</CardTitle></CardHeader>
            {data.courses.length === 0 ? (
              <CardContent className="py-6 text-center text-sm text-muted-foreground">Not on any course.</CardContent>
            ) : (
              <ul className="divide-y border-t">
                {data.courses.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      {base === "support"
                        ? <span className="text-sm font-medium truncate">{c.title}</span>
                        : <Link href={`/${base}/courses/${c.id}`} className="text-sm font-medium truncate hover:underline">{c.title}</Link>}
                      <span className="text-xs font-semibold tabular-nums">{c.completion}%</span>
                    </div>
                    <Progress value={c.completion} className="h-1.5" />
                    <p className="text-[0.6875rem] text-muted-foreground">
                      {[
                        c.totalLessons > 0 && `${c.completedLessons}/${c.totalLessons} lessons`,
                        c.totalTests > 0 && `${c.testsDone}/${c.totalTests} homework tests`,
                        c.classAverage > 0 && `class average ${c.classAverage}%`,
                      ].filter(Boolean).join(" · ") || "Nothing released yet"}
                    </p>
                    {(c.closed || c.behindClass || c.inactive) && (
                      <p className={`text-[0.6875rem] font-semibold ${c.closed ? "text-muted-foreground" : "text-rose-600"}`}>
                        {c.closed ? "Course finished" : c.behindClass ? "Behind the class" : "No course work for a week"}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="shadow-sm gap-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between gap-2">
                Sign-in history
                {failed30 > 0 && (
                  <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-red-600">
                    <ShieldAlert className="size-3.5" /> {failed30} failed in 30 days
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            {data.logins.length === 0 ? (
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No sign-ins recorded yet. Sign-ins are recorded from now on.
              </CardContent>
            ) : (
              <ul className="divide-y border-t max-h-[480px] overflow-y-auto">
                {data.logins.map((l) => (
                  <li key={l.id} className="px-4 py-2 flex items-start gap-2.5">
                    {l.success
                      ? <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                      : <XCircle className="size-4 text-red-600 shrink-0 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{fullDate(l.createdAt)}</p>
                      <p className="text-[0.6875rem] text-muted-foreground truncate">
                        {l.success ? LOGIN_METHOD_LABEL[l.method] ?? l.method : FAILURE_LABEL[l.failureReason ?? ""] ?? "Failed"}
                        {" · "}{deviceOf(l.userAgent, l.client)}
                        {showIp && l.ip ? ` · ${l.ip}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function BackLink({ base }: { base: string }) {
  return (
    <Link href={`/${base}/students`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit">
      <ArrowLeft className="size-4" /> All students
    </Link>
  )
}
