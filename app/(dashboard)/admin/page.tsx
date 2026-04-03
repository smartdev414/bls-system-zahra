"use client"

import Link from "next/link"
import {
  Users, BookOpen, Video, TrendingUp,
  ArrowRight, Loader2, ShieldCheck, UserCheck, Radio,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
  recentUsers: Array<{
    id: string
    name: string
    email: string
    role: "STUDENT" | "TUTOR" | "ADMIN"
    createdAt: string
  }>
}

const roleColor: Record<string, string> = {
  STUDENT: "bg-blue-100 text-blue-700 border-blue-200",
  TUTOR: "bg-violet-100 text-violet-700 border-violet-200",
  ADMIN: "bg-rose-100 text-rose-700 border-rose-200",
}

export default function AdminDashboard() {
  const { data, loading } = useFetch<StatsData>("/api/admin/stats", {
    errorMessage: "Could not load stats",
  })

  const s = data?.stats

  const statCards = [
    { label: "Total Users", value: s?.totalUsers, sub: `${s?.totalStudents ?? 0} students · ${s?.totalTutors ?? 0} tutors`, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Published Courses", value: s?.publishedCourses, sub: `${(s?.totalCourses ?? 0) - (s?.publishedCourses ?? 0)} drafts`, icon: BookOpen, color: "text-violet-600", bg: "bg-violet-50" },
    { label: "Total Enrolments", value: s?.totalEnrollments, sub: `+${s?.recentEnrollments ?? 0} last 30 days`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Live Sessions", value: s?.liveSessions, sub: `${s?.totalSessions ?? 0} total sessions`, icon: Video, color: "text-primary", bg: "bg-primary/5" },
  ]

  return (
    <div className="flex flex-col gap-8">
      {/* Banner */}
      <div className="rounded-2xl bg-primary p-8 text-primary-foreground relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="absolute -right-4 top-16 size-28 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="size-5 text-primary-foreground/70" />
            <p className="text-sm font-medium text-primary-foreground/70">Admin Panel</p>
          </div>
          <h1 className="text-3xl font-black tracking-tight mb-2">Platform Overview</h1>
          <p className="text-primary-foreground/80 mb-6">
            Manage users, courses, and platform settings from one place.
          </p>
          <div className="flex gap-3">
            <Button asChild variant="secondary" size="sm">
              <Link href="/admin/users"><Users className="size-4 mr-1.5" /> Manage Users</Link>
            </Button>
            <Button asChild size="sm" className="bg-white/15 hover:bg-white/25 text-primary-foreground border-0">
              <Link href="/admin/courses"><BookOpen className="size-4 mr-1.5" /> Manage Courses</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, sub, icon: Icon, color, bg }) => (
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
                <p className="text-3xl font-black">{value ?? 0}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">{loading ? "\u00A0" : sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent users */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserCheck className="size-4 text-primary" /> Recent Users
            </CardTitle>
            <Button asChild variant="ghost" size="sm" className="text-primary h-7 px-2">
              <Link href="/admin/users">View all <ArrowRight className="size-3.5 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="divide-y">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <div className="size-8 rounded-full bg-muted animate-pulse" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 bg-muted rounded animate-pulse w-1/2" />
                      <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : data?.recentUsers.length ? (
              <div className="divide-y">
                {data.recentUsers.map((u) => {
                  const initials = u.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
                  return (
                    <div key={u.id} className="flex items-center gap-3 px-5 py-3">
                      <Avatar className="size-8 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{u.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${roleColor[u.role]}`}>
                        {u.role.charAt(0) + u.role.slice(1).toLowerCase()}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No users yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {[
              { label: "All Users", desc: "View & manage accounts", href: "/admin/users", icon: Users },
              { label: "All Courses", desc: "Review & publish", href: "/admin/courses", icon: BookOpen },
              { label: "Tutors", desc: "Verify tutor profiles", href: "/admin/users?role=TUTOR", icon: UserCheck },
              { label: "Live Sessions", desc: "Monitor activity", href: "/admin/sessions", icon: Radio },
            ].map(({ label, desc, href, icon: Icon }) => (
              <Link
                key={label}
                href={href}
                className="flex flex-col gap-2 rounded-xl border p-4 hover:border-primary hover:bg-primary/5 transition-all group"
              >
                <div className="rounded-lg bg-primary/10 p-2 w-fit group-hover:bg-primary/20 transition-colors">
                  <Icon className="size-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
