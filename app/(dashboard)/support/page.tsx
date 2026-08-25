"use client"

import Link from "next/link"
import {
  Users, BookOpen, Video, TrendingUp, ArrowRight, Loader2,
  UserPlus, CalendarPlus, Wifi, Ticket, Headset,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFetch } from "@/hooks/use-fetch"

type StatsData = {
  stats: {
    totalUsers: number
    totalStudents: number
    totalTutors: number
    totalCourses: number
    publishedCourses: number
    totalEnrollments: number
    recentEnrollments: number
    totalSessions: number
    liveSessions: number
  }
}

export default function SupportDashboard() {
  const { data, loading } = useFetch<StatsData>("/api/admin/stats", {
    errorMessage: "Could not load stats",
  })

  const s = data?.stats

  const statCards = [
    { label: "Students", value: s?.totalStudents, sub: `${s?.totalTutors ?? 0} tutors`, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Published Courses", value: s?.publishedCourses, sub: `${(s?.totalCourses ?? 0) - (s?.publishedCourses ?? 0)} drafts`, icon: BookOpen, color: "text-violet-600", bg: "bg-violet-50" },
    { label: "Total Enrolments", value: s?.totalEnrollments, sub: `+${s?.recentEnrollments ?? 0} last 30 days`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Live Now", value: s?.liveSessions, sub: `${s?.totalSessions ?? 0} sessions scheduled`, icon: Video, color: "text-primary", bg: "bg-primary/5" },
  ]

  const shortcuts = [
    { label: "Schedule a class", desc: "Add it to the timetable", href: "/support/timetable", icon: CalendarPlus },
    { label: "Enrol students", desc: "Put students onto a course", href: "/support/enrolments", icon: UserPlus },
    { label: "Connection check", desc: "Test a camera, mic and network", href: "/support/connection-check", icon: Wifi },
    { label: "Support tickets", desc: "Answer what's come in", href: "/support/tickets", icon: Ticket },
  ]

  return (
    <div className="flex flex-col gap-8">
      {/* Banner */}
      <div className="rounded-2xl bg-primary p-8 text-primary-foreground relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="absolute -right-4 top-16 size-28 rounded-full bg-white/5" />
        <div className="relative flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Headset className="size-5" />
            <span className="text-xs font-bold uppercase tracking-widest opacity-80">Support Team</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight">Support desk</h1>
          <p className="text-sm opacity-90 max-w-xl">
            Set classes up, get students onto them, and help people through the door.
            Teaching material stays with the tutors.
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Button asChild size="sm" variant="secondary">
              <Link href="/support/timetable"><CalendarPlus className="size-4 mr-1.5" /> Timetable</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/support/enrolments"><UserPlus className="size-4 mr-1.5" /> Enrolments</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map(({ label, value, sub, icon: Icon, color, bg }) => (
            <Card key={label} className="shadow-sm">
              <CardContent className="p-5 flex items-start gap-3">
                <div className={`rounded-xl p-2.5 shrink-0 ${bg}`}>
                  <Icon className={`size-5 ${color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-black leading-none">{value ?? 0}</p>
                  <p className="text-xs font-semibold mt-1">{label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Shortcuts */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Everyday jobs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {shortcuts.map(({ label, desc, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-xl border px-4 py-3 hover:bg-muted/40 transition-colors group"
            >
              <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                <Icon className="size-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-muted-foreground truncate">{desc}</p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
