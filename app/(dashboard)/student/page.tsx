"use client"

import Link from "next/link"
import {
  BookOpen, Library, FlaskConical, Video, Settings,
  FolderOpen, Calendar, ArrowRight, Clock, Loader2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { useFetch } from "@/hooks/use-fetch"

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardData = {
  student: { name: string; bslLevel: string | null }
  stats: {
    currentDay: number
    completion: number
    testsPassed: number
    totalTests: number
  }
  upcomingSessions: Array<{
    id: string
    title: string
    scheduledAt: string
    tutorName: string
    status: string
  }>
}

// ─── Module grid config ───────────────────────────────────────────────────────

const modules = [
  { label: "Lessons", desc: "Continue learning", href: "/student/lessons", icon: BookOpen, vip: false },
  { label: "Resources", desc: "Course materials", href: "/student/resources", icon: FolderOpen, vip: false },
  { label: "Dictionary", desc: "Search signs", href: "/student/dictionary", icon: Library, vip: false },
  { label: "Tests", desc: "Practice exams", href: "/student/tests", icon: FlaskConical, vip: false },
  { label: "Classroom", desc: "Live sessions", href: "/student/classroom", icon: Video, vip: false },
  { label: "Settings", desc: "Preferences", href: "/student/settings", icon: Settings, vip: false },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSessionDate(iso: string) {
  const date = new Date(iso)
  return {
    month: date.toLocaleString("en-GB", { month: "short" }).toUpperCase(),
    day: date.getDate(),
    time: date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StudentDashboardPage() {
  const { data, loading } = useFetch<DashboardData>("/api/student/dashboard", {
    errorMessage: "Could not load dashboard data",
  })

  const name = data?.student.name?.split(" ")[0] ?? "there"
  const stats = data?.stats ?? { currentDay: 1, completion: 0, testsPassed: 0, totalTests: 0 }

  return (
    <div className="flex flex-col gap-8">

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
              <p className="text-primary-foreground/80 mb-6">
                {stats.completion > 0
                  ? `You're making great progress. Keep going — you're on Day ${stats.currentDay}!`
                  : "You're just getting started. Pick a lesson below to begin your BSL journey!"}
              </p>
              <Button asChild variant="secondary" size="sm">
                <Link href="/student/lessons">
                  Resume Learning <ArrowRight className="size-4 ml-1.5" />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — stats + modules (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Current Day", value: `Day ${stats.currentDay}`, pct: Math.min((stats.currentDay / 30) * 100, 100) },
              { label: "Completion", value: `${stats.completion}%`, pct: stats.completion },
              {
                label: "Tests Passed",
                value: stats.totalTests > 0 ? `${stats.testsPassed}/${stats.totalTests}` : "—",
                pct: stats.totalTests > 0 ? (stats.testsPassed / stats.totalTests) * 100 : 0,
              },
            ].map(({ label, value, pct }) => (
              <Card key={label} className="shadow-sm">
                <CardContent className="p-5 flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                  {loading ? (
                    <div className="h-8 w-16 rounded bg-muted animate-pulse" />
                  ) : (
                    <p className="text-3xl font-black">{value}</p>
                  )}
                  <Progress value={loading ? 0 : pct} className="h-1.5" />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Module grid */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="size-4 text-primary" />
                Your Modules
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 pt-0">
              {modules.map(({ label, desc, href, icon: Icon, vip }) => (
                <Link
                  key={label}
                  href={href}
                  className="relative flex flex-col items-center gap-2 rounded-xl border p-5 text-center transition-all hover:border-primary hover:bg-primary/5 group"
                >
                  <div className={`rounded-full p-3 ${vip ? "bg-muted" : "bg-primary/10"}`}>
                    <Icon className={`size-5 ${vip ? "text-muted-foreground" : "text-primary"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{label}</p>
                    <p className={`text-xs mt-0.5 ${vip ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                      {desc}
                    </p>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right — upcoming sessions + upgrade (1/3) */}
        <div className="flex flex-col gap-4">

          {/* Upcoming Sessions */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="size-4 text-primary" />
                Upcoming Sessions
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-primary h-7 px-2">
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
              ) : data?.upcomingSessions.length ? (
                <div className="flex flex-col gap-4">
                  {data.upcomingSessions.map((session, i) => {
                    const { month, day, time } = formatSessionDate(session.scheduledAt)
                    return (
                      <div key={session.id}>
                        {i > 0 && <Separator className="mb-4" />}
                        <div className="flex gap-3 items-start">
                          <div className="bg-muted flex flex-col items-center justify-center rounded-xl px-3 py-2 shrink-0 min-w-[48px]">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">{month}</span>
                            <span className="text-lg font-black leading-tight">{day}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold leading-snug">{session.title}</p>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <Clock className="size-3" />
                              {time} · {session.tutorName}
                            </div>
                            {session.status === "LIVE" && (
                              <Badge className="mt-1 text-[10px] h-4 px-1.5 bg-emerald-500">Live now</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No upcoming sessions.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Upgrade to Pro */}
          <div className="rounded-2xl bg-foreground text-background p-6 flex flex-col items-center text-center gap-3">
            <div className="bg-primary rounded-full p-2.5">
              <Video className="size-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-sm">Upgrade to Pro</p>
              <p className="text-xs text-background/60 mt-1 leading-snug">
                Unlock the dictionary, offline lessons, and private tutoring.
              </p>
            </div>
            <Button size="sm" className="w-full mt-1">
              Go Premium
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
