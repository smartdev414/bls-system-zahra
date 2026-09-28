"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Users, BookOpen, Video, TrendingUp,
  Plus, CalendarPlus, ArrowRight, Clock, Star,
  Loader2, UserPlus,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { useFetch } from "@/hooks/use-fetch"
import { InviteStudentsEmailModal } from "@/components/tutor/InviteStudentsEmailModal"

type DashboardData = {
  tutorName: string
  stats: {
    totalStudents: number
    publishedCourses: number
    draftCourses: number
    upcomingSessionCount: number
    avgCompletion: number
  }
  courses: Array<{
    id: string
    title: string
    status: string
    enrollmentCount: number
    rating: number | null
  }>
  upcomingSessions: Array<{
    id: string
    title: string
    scheduledAt: string
    durationMins: number
    status: string
    attendeeCount: number
    maxStudents: number | null
    courseTitle: string | null
  }>
  recentStudents: Array<{
    studentId: string
    studentName: string
    courseTitle: string
    courseId: string
    progress: number
    daysSinceEnrolled: number
  }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSessionDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const date = isToday
    ? "Today"
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return `${date} · ${time}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorDashboardPage() {
  const { data, loading } = useFetch<DashboardData>("/api/tutor/dashboard", {
    errorMessage: "Could not load dashboard",
  })
  const [showInviteModal, setShowInviteModal] = useState(false)

  const firstName = data?.tutorName?.split(" ")[0] ?? "there"
  const stats = data?.stats
  const isEmpty = !loading && stats && stats.publishedCourses === 0 && stats.draftCourses === 0 && stats.totalStudents === 0

  return (
    <div className="flex flex-col gap-8">

      {/* Quick-start strip — shown only when no courses and no students */}
      {isEmpty && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Create a course */}
          <div className="relative flex items-center gap-3 rounded-xl overflow-hidden border border-violet-200 bg-linear-to-r from-violet-50 to-purple-50 px-4 py-3">
            <div className="absolute right-0 top-0 size-20 rounded-full bg-violet-200/40 -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="rounded-xl bg-violet-500 p-2 shrink-0 shadow-sm">
              <BookOpen className="size-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-violet-900 leading-none">Create your first course</p>
              <p className="text-[11px] text-violet-600/80 mt-0.5 truncate">Students enrol and follow you automatically</p>
            </div>
            <Button asChild size="sm" className="shrink-0 relative gap-1.5 bg-violet-600 hover:bg-violet-700 text-white border-0 shadow-sm">
              <Link href="/tutor/courses?new=1">
                <span className="absolute -inset-1 rounded-lg animate-ping bg-violet-400/50 pointer-events-none" />
                <span className="absolute -inset-0.5 rounded-md animate-ping bg-violet-300/30 pointer-events-none [animation-delay:150ms]" />
                <Plus className="size-3.5" /> Create
              </Link>
            </Button>
          </div>

          {/* Invite students */}
          <div className="relative flex items-center gap-3 rounded-xl overflow-hidden border border-sky-200 bg-linear-to-r from-sky-50 to-blue-50 px-4 py-3">
            <div className="absolute right-0 top-0 size-20 rounded-full bg-sky-200/40 -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="rounded-xl bg-sky-500 p-2 shrink-0 shadow-sm">
              <UserPlus className="size-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-sky-900 leading-none">Invite your students</p>
              <p className="text-[11px] text-sky-600/80 mt-0.5 truncate">Your courses get highlighted in their feed</p>
            </div>
            <Button
              size="sm"
              className="shrink-0 relative gap-1.5 bg-sky-500 hover:bg-sky-600 text-white border-0 shadow-sm cursor-pointer"
              onClick={() => setShowInviteModal(true)}
            >
              <span className="absolute -inset-1 rounded-lg animate-ping bg-sky-400/50 pointer-events-none" />
              <span className="absolute -inset-0.5 rounded-md animate-ping bg-sky-300/30 pointer-events-none [animation-delay:150ms]" />
              <UserPlus className="size-3.5" /> Invite
            </Button>
          </div>

        </div>
      )}

      {/* Welcome banner */}
      <div className="rounded-2xl bg-primary p-8 text-primary-foreground relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="absolute -right-4 top-16 size-28 rounded-full bg-white/5" />

        <div className="relative max-w-lg">
          {loading ? (
            <Loader2 className="size-5 animate-spin opacity-60" />
          ) : (
            <>
              <p className="text-sm font-medium text-primary-foreground/70 mb-1">Tutor Dashboard</p>
              <h1 className="text-3xl font-black tracking-tight mb-2">Welcome back, {firstName}!</h1>
              <p className="text-primary-foreground/80 mb-6">
                {stats && stats.upcomingSessionCount > 0
                  ? `You have ${stats.upcomingSessionCount} session${stats.upcomingSessionCount !== 1 ? "s" : ""} coming up and ${stats.totalStudents} student${stats.totalStudents !== 1 ? "s" : ""} enrolled.`
                  : "Schedule a session or create a new course to get started."}
              </p>
              <div className="flex gap-3">
                <Button asChild variant="secondary" size="sm">
                  <Link href="/tutor/sessions">
                    <CalendarPlus className="size-4 mr-1.5" />
                    Schedule Session
                  </Link>
                </Button>
                <Button asChild size="sm" className="bg-white/15 hover:bg-white/25 text-primary-foreground border-0">
                  <Link href="/tutor/courses?new=1">
                    <Plus className="size-4 mr-1.5" />
                    New Course
                  </Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Students", icon: Users,
            value: loading ? null : stats?.totalStudents ?? 0,
            sub: loading ? null : "enrolled across all courses",
            color: "text-blue-600", bg: "bg-blue-50",
          },
          {
            label: "Published Courses", icon: BookOpen,
            value: loading ? null : stats?.publishedCourses ?? 0,
            sub: loading ? null : `${stats?.draftCourses ?? 0} in draft`,
            color: "text-violet-600", bg: "bg-violet-50",
          },
          {
            label: "Live Sessions", icon: Video,
            value: loading ? null : stats?.upcomingSessionCount ?? 0,
            sub: loading ? null : "upcoming",
            color: "text-emerald-600", bg: "bg-emerald-50",
          },
          {
            label: "Avg. Completion", icon: TrendingUp,
            value: loading ? null : `${stats?.avgCompletion ?? 0}%`,
            sub: loading ? null : "across all students",
            color: "text-primary", bg: "bg-primary/5",
          },
        ].map(({ label, icon: Icon, value, sub, color, bg }) => (
          <Card key={label} className="shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <div className={`${bg} rounded-lg p-2 shrink-0`}>
                  <Icon className={`size-4 ${color}`} />
                </div>
              </div>
              {loading ? (
                <div className="h-8 w-16 bg-muted rounded animate-pulse" />
              ) : (
                <p className="text-3xl font-black text-foreground">{value}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">{loading ? "\u00A0" : sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — courses + students */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* My Courses */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="size-4 text-primary" /> My Courses
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-primary h-7 px-2">
                <Link href="/tutor/courses">View all <ArrowRight className="size-3.5 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="divide-y">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4 px-6 py-3">
                      <div className="size-8 rounded-lg bg-muted animate-pulse" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 bg-muted rounded animate-pulse w-3/4" />
                        <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : data?.courses.length ? (
                <div className="divide-y">
                  {data.courses.map((course) => (
                    <Link
                      key={course.id}
                      href={`/tutor/courses/${course.id}`}
                      className="flex items-center gap-4 px-6 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="bg-primary/10 rounded-lg p-2 shrink-0">
                        <BookOpen className="size-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{course.title}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-muted-foreground">{course.enrollmentCount} students</span>
                          {course.rating && (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Star className="size-3 fill-amber-400 text-amber-400" />
                              {course.rating}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant={course.status === "PUBLISHED" ? "default" : "secondary"}
                        className="text-xs shrink-0"
                      >
                        {course.status.charAt(0) + course.status.slice(1).toLowerCase()}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No courses yet.{" "}
                  <Link href="/tutor/courses?new=1" className="text-primary underline underline-offset-2">
                    Create one
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Students */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="size-4 text-primary" /> Recent Students
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-primary h-7 px-2">
                <Link href="/tutor/students">View all <ArrowRight className="size-3.5 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="divide-y">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4 px-6 py-3">
                      <div className="size-8 rounded-full bg-muted animate-pulse" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 bg-muted rounded animate-pulse w-1/2" />
                        <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
                      </div>
                      <div className="w-24 space-y-1.5">
                        <div className="h-3 bg-muted rounded animate-pulse" />
                        <div className="h-1.5 bg-muted rounded animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : data?.recentStudents.length ? (
                <div className="divide-y">
                  {data.recentStudents.map((s) => {
                    const initials = s.studentName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
                    return (
                      <div key={s.studentId + s.courseId} className="flex items-center gap-4 px-6 py-3">
                        <Avatar className="size-8 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">{s.studentName}</p>
                          <p className="text-xs text-muted-foreground truncate">{s.courseTitle}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0 w-24">
                          <span className="text-xs font-semibold">{s.progress}%</span>
                          <Progress value={s.progress} className="h-1.5 w-full" />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
                          {s.daysSinceEnrolled}d ago
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No students enrolled yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right — upcoming sessions */}
        <div className="flex flex-col gap-6">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Video className="size-4 text-primary" /> Upcoming Sessions
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-primary h-7 px-2">
                <Link href="/tutor/sessions">View all <ArrowRight className="size-3.5 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="space-y-2">
                      <div className="h-3.5 bg-muted rounded animate-pulse w-4/5" />
                      <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                      <div className="h-1.5 bg-muted rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : data?.upcomingSessions.length ? (
                data.upcomingSessions.map((session, i) => (
                  <div key={session.id}>
                    {i > 0 && <Separator className="mb-3" />}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug">{session.title}</p>
                        {session.status === "LIVE" && (
                          <Badge className="bg-emerald-500 text-white text-[10px] shrink-0">Live</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {formatSessionDate(session.scheduledAt)}
                      </div>
                      {session.maxStudents && (
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">
                              {session.attendeeCount}/{session.maxStudents} enrolled
                            </span>
                            <span className="font-medium">
                              {Math.round((session.attendeeCount / session.maxStudents) * 100)}%
                            </span>
                          </div>
                          <Progress value={(session.attendeeCount / session.maxStudents) * 100} className="h-1.5" />
                        </div>
                      )}
                      <Button asChild size="sm" variant="outline" className="w-full h-7 text-xs mt-1">
                        <Link href={`/tutor/sessions/${session.id}`}>Manage</Link>
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No upcoming sessions.</p>
              )}

              <Separator />
              <Button asChild className="w-full" size="sm">
                <Link href="/tutor/sessions">
                  <CalendarPlus className="size-4 mr-1.5" /> Schedule Session
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {showInviteModal && <InviteStudentsEmailModal onClose={() => setShowInviteModal(false)} />}
    </div>
  )
}
