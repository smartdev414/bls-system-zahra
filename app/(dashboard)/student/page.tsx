"use client"

import Link from "next/link"
import {
  BookOpen, Library, FlaskConical, Video, Settings,
  FolderOpen, Calendar, ArrowRight, Clock, Loader2,
  PlayCircle, FileText, CheckCircle2, Radio,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { useFetch } from "@/hooks/use-fetch"
import { ThisWeekCard, type ThisWeek } from "@/components/student/this-week-card"

type CurrentCourse = {
  courseId: string
  courseTitle: string
  thumbnailUrl: string | null
  tutorName: string
  completion: number
  completedLessons: number
  totalLessons: number
  nextLesson: { id: string; title: string; type: string } | null
}

type DashboardData = {
  student: { name: string; bslLevel: string | null }
  stats: {
    completedLessons: number
    totalLessons: number
    classesAttended: number
    completion: number
    testsPassed: number
    totalTests: number
  }
  currentCourse: CurrentCourse | null
  thisWeek: ThisWeek
  upcomingSessions: Array<{
    id: string
    title: string
    scheduledAt: string
    tutorName: string
    status: string
  }>
}

const modules = [
  { label: "Courses", desc: "Continue learning", href: "/student/courses", icon: BookOpen },
  { label: "Resources", desc: "Course materials", href: "/student/resources", icon: FolderOpen },
  { label: "Dictionary", desc: "Search signs", href: "/student/dictionary", icon: Library },
  { label: "Tests", desc: "Practice exams", href: "/student/tests", icon: FlaskConical },
  { label: "Classroom", desc: "Live sessions", href: "/student/classroom", icon: Video },
  { label: "Settings", desc: "Preferences", href: "/student/settings", icon: Settings },
]

const lessonTypeIcon = {
  VIDEO: PlayCircle,
  TEXT: FileText,
  QUIZ: FlaskConical,
}

function formatSessionDate(iso: string) {
  const date = new Date(iso)
  return {
    month: date.toLocaleString("en-GB", { month: "short" }).toUpperCase(),
    day: date.getDate(),
    time: date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

export default function StudentDashboardPage() {
  const { data, loading } = useFetch<DashboardData>("/api/student/dashboard", {
    errorMessage: "Could not load dashboard data",
  })

  const name = data?.student.name?.split(" ")[0] ?? "there"
  const stats = data?.stats ?? { completedLessons: 0, totalLessons: 0, completion: 0, testsPassed: 0, totalTests: 0, classesAttended: 0 }
  const liveSessions = data?.upcomingSessions.filter((s) => s.status === "LIVE") ?? []
  const scheduledSessions = data?.upcomingSessions.filter((s) => s.status !== "LIVE") ?? []

  return (
    <div className="flex flex-col gap-6">

      {/* Welcome banner */}
      <div className="rounded-2xl bg-primary p-8 text-primary-foreground relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="absolute -right-4 top-16 size-28 rounded-full bg-white/5" />
        <div className="relative max-w-lg">
          {loading ? (
            <Loader2 className="size-5 animate-spin opacity-60" />
          ) : (
            <>
              <h1 className="text-3xl font-black tracking-tight mb-2">
                Welcome back, {name}!
              </h1>
              <p className="text-primary-foreground/80 mb-5">
                {stats.completedLessons > 0
                  ? `You've completed ${stats.completedLessons} of ${stats.totalLessons} lessons — keep it up!`
                  : "You're just getting started. Pick a lesson below to begin your BSL journey!"}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <Button asChild variant="secondary" size="sm">
                  <Link href="/student/courses">
                    My Courses <ArrowRight className="size-4 ml-1.5" />
                  </Link>
                </Button>
                {liveSessions.length > 0 && (
                  <Button asChild size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white border-0 gap-1.5">
                    <Link href={`/student/classroom/${liveSessions[0].id}`}>
                      <Radio className="size-3.5 animate-pulse" />
                      Join Live Session
                    </Link>
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — current course + stats + modules */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* This week: next class, homework, last class's recording */}
          <ThisWeekCard
            data={data?.thisWeek ?? null}
            loading={loading}
            hasCourse={!!data?.currentCourse}
          />

          {/* Module grid */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="size-4 text-primary" />
                Your Modules
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-0">
              {modules.map(({ label, desc, href, icon: Icon }) => (
                <Link
                  key={label}
                  href={href}
                  className="flex flex-col items-center gap-2 rounded-xl border p-3 sm:p-5 text-center transition-all hover:border-primary hover:bg-primary/5"
                >
                  <div className="rounded-full bg-primary/10 p-3">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{label}</p>
                    <p className="text-xs mt-0.5 text-muted-foreground">{desc}</p>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right — sessions */}
        <div className="flex flex-col gap-4">

          {/* Upcoming Sessions */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="size-4 text-primary" />
                Upcoming Sessions
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-primary h-7 max-sm:h-9 px-2">
                <Link href="/student/classroom">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="flex gap-3">
                      <div className="size-12 rounded-xl bg-muted animate-pulse shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 bg-muted rounded animate-pulse w-3/4" />
                        <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : scheduledSessions.length ? (
                <div className="flex flex-col gap-4">
                  {scheduledSessions.map((session, i) => {
                    const { month, day, time } = formatSessionDate(session.scheduledAt)
                    return (
                      <div key={session.id}>
                        {i > 0 && <Separator className="mb-4" />}
                        <div className="flex gap-3 items-start">
                          <div className="bg-muted flex flex-col items-center justify-center rounded-xl px-3 py-2 shrink-0 min-w-12">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">{month}</span>
                            <span className="text-lg font-black leading-tight">{day}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold leading-snug">{session.title}</p>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <Clock className="size-3" />
                              {time} · {session.tutorName}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No upcoming sessions scheduled.
                </p>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  )
}
