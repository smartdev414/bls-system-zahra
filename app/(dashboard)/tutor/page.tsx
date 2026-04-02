import {
  Users, BookOpen, Video, TrendingUp,
  Plus, CalendarPlus, ArrowRight, Clock, Star,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import Link from "next/link"

// ─── Mock data (replace with real API calls) ──────────────────────────────────

const stats = [
  { label: "Total Students", value: "142", change: "+12 this month", icon: Users, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30" },
  { label: "Published Courses", value: "8", change: "2 in draft", icon: BookOpen, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
  { label: "Live Sessions", value: "3", change: "This week", icon: Video, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
  { label: "Avg. Completion", value: "74%", change: "+5% vs last month", icon: TrendingUp, color: "text-primary", bg: "bg-primary/5" },
]

const upcomingSessions = [
  { id: "1", title: "BSL Fingerspelling Basics", date: "Today", time: "6:00 PM", enrolled: 14, capacity: 20, level: "Beginner" },
  { id: "2", title: "Everyday Conversation Practice", date: "Thu, Apr 4", time: "5:30 PM", enrolled: 9, capacity: 15, level: "Intermediate" },
  { id: "3", title: "Medical BSL Terminology", date: "Sat, Apr 6", time: "11:00 AM", enrolled: 7, capacity: 10, level: "Advanced" },
]

const recentStudents = [
  { id: "1", name: "Emma Wilson", course: "BSL Level 1", progress: 68, joinedDaysAgo: 2 },
  { id: "2", name: "James Patel", course: "Everyday Conversation", progress: 45, joinedDaysAgo: 5 },
  { id: "3", name: "Mia Thompson", course: "BSL Level 1", progress: 92, joinedDaysAgo: 7 },
  { id: "4", name: "Lucas Chen", course: "Medical BSL", progress: 23, joinedDaysAgo: 8 },
]

const courses = [
  { id: "1", title: "BSL Level 1 — Complete Beginner", students: 58, rating: 4.9, status: "Published" },
  { id: "2", title: "Everyday Conversation in BSL", students: 44, rating: 4.7, status: "Published" },
  { id: "3", title: "Medical BSL Terminology", students: 21, rating: 4.8, status: "Published" },
  { id: "4", title: "Regional Signs Across the UK", students: 0, rating: null, status: "Draft" },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorDashboardPage() {
  return (
    <div className="flex flex-col gap-8">

      {/* Welcome banner */}
      <div className="rounded-2xl bg-primary p-8 text-primary-foreground relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="absolute -right-4 top-16 size-28 rounded-full bg-white/5" />

        <div className="relative max-w-lg">
          <p className="text-sm font-medium text-primary-foreground/70 mb-1">Tutor Dashboard</p>
          <h1 className="text-3xl font-black tracking-tight mb-2">Welcome back, Sarah!</h1>
          <p className="text-primary-foreground/80 mb-6">
            You have <strong>3 live sessions</strong> scheduled this week and <strong>4 new enrollments</strong> since yesterday.
          </p>
          <div className="flex gap-3">
            <Button asChild variant="secondary" size="sm">
              <Link href="/tutor/sessions/new">
                <CalendarPlus className="size-4 mr-1.5" />
                Schedule Session
              </Link>
            </Button>
            <Button asChild size="sm" className="bg-white/15 hover:bg-white/25 text-primary-foreground border-0">
              <Link href="/tutor/courses/new">
                <Plus className="size-4 mr-1.5" />
                New Course
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, change, icon: Icon, color, bg }) => (
          <Card key={label} className="shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <div className={`${bg} rounded-lg p-2 shrink-0`}>
                  <Icon className={`size-4 ${color}`} />
                </div>
              </div>
              <p className="text-3xl font-black text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main content — two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left col — courses + students (2/3 width) */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* My Courses */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="size-4 text-primary" />
                My Courses
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-primary h-7 px-2">
                <Link href="/tutor/courses">
                  View all <ArrowRight className="size-3.5 ml-1" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {courses.map((course) => (
                  <div key={course.id} className="flex items-center gap-4 px-6 py-3">
                    <div className="bg-primary/10 rounded-lg p-2 shrink-0">
                      <BookOpen className="size-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{course.title}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {course.students} students
                        </span>
                        {course.rating && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Star className="size-3 fill-amber-400 text-amber-400" />
                            {course.rating}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={course.status === "Published" ? "default" : "secondary"}
                      className="text-xs shrink-0"
                    >
                      {course.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Students */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="size-4 text-primary" />
                Recent Students
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-primary h-7 px-2">
                <Link href="/tutor/students">
                  View all <ArrowRight className="size-3.5 ml-1" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {recentStudents.map((s) => {
                  const initials = s.name.split(" ").map((n) => n[0]).join("").toUpperCase()
                  return (
                    <div key={s.id} className="flex items-center gap-4 px-6 py-3">
                      <Avatar className="size-8 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{s.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{s.course}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0 w-24">
                        <span className="text-xs font-semibold">{s.progress}%</span>
                        <Progress value={s.progress} className="h-1.5 w-full" />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
                        {s.joinedDaysAgo}d ago
                      </span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right col — upcoming sessions (1/3 width) */}
        <div className="flex flex-col gap-6">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Video className="size-4 text-primary" />
                Upcoming Sessions
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-primary h-7 px-2">
                <Link href="/tutor/sessions">
                  View all <ArrowRight className="size-3.5 ml-1" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              {upcomingSessions.map((session, i) => (
                <div key={session.id}>
                  {i > 0 && <Separator className="mb-3" />}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug">{session.title}</p>
                      <Badge variant="outline" className="text-[10px] shrink-0 px-1.5">
                        {session.level}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      <span>{session.date} · {session.time}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-1 flex-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {session.enrolled}/{session.capacity} enrolled
                          </span>
                          <span className="font-medium">
                            {Math.round((session.enrolled / session.capacity) * 100)}%
                          </span>
                        </div>
                        <Progress
                          value={(session.enrolled / session.capacity) * 100}
                          className="h-1.5"
                        />
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline" className="w-full h-7 text-xs mt-1">
                      <Link href={`/tutor/sessions/${session.id}`}>
                        Manage Session
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}

              <Separator />
              <Button asChild className="w-full" size="sm">
                <Link href="/tutor/sessions/new">
                  <CalendarPlus className="size-4 mr-1.5" />
                  Schedule New Session
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
