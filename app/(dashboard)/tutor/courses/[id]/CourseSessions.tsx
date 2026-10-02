"use client"

import Link from "next/link"
import { CalendarDays, CalendarPlus, Clock, Globe, Loader2, Lock, Radio } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { useFetch } from "@/hooks/use-fetch"
import { useCoursesBase } from "@/hooks/use-courses-base"

type CourseSession = {
  id: string
  title: string
  scheduledAt: string
  durationMins: number
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
  visibility: "PUBLIC" | "INVITE_ONLY"
  inviteCount: number
  // Only sent to staff, who schedule on a tutor's behalf.
  tutorName?: string | null
}

type SessionsData = { sessions: CourseSession[] }

// ─── Upcoming classes for this course — each group has its own day and time ──

export function CourseSessions({ courseId }: { courseId: string }) {
  const coursesBase = useCoursesBase()
  const sessionsBase = coursesBase === "/admin/courses" ? "/admin/sessions" : "/tutor/sessions"

  const { data, loading } = useFetch<SessionsData>(`/api/tutor/sessions?courseId=${courseId}`, {
    errorMessage: "Could not load sessions",
  })

  const upcoming = (data?.sessions ?? [])
    .filter((s) => s.status === "SCHEDULED" || s.status === "LIVE")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" /> Class Sessions
          {data && <Badge variant="outline" className="text-[10px]">{upcoming.length} upcoming</Badge>}
        </h2>
        <Button asChild size="sm" variant="outline">
          <Link href={`${sessionsBase}?new=1&courseId=${courseId}`}>
            <CalendarPlus className="size-4 mr-1.5" /> Schedule Session
          </Link>
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : upcoming.length === 0 ? (
        <Card className="shadow-sm border-dashed">
          <CardContent className="py-10 text-center">
            <CalendarDays className="size-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No classes scheduled. Schedule one for the whole course, or invite a single group to give it its own day and time.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm overflow-hidden py-0">
          <div className="divide-y max-h-80 overflow-y-auto">
            {upcoming.map((s) => {
              const when = new Date(s.scheduledAt)
              const isLive = s.status === "LIVE"
              return (
                <div key={s.id} className="flex items-center gap-2.5 px-3 sm:px-5 py-2.5 hover:bg-muted/20 transition-colors">
                  <div className="rounded-lg bg-primary/10 p-1.5 shrink-0">
                    {isLive ? <Radio className="size-4 text-emerald-600" /> : <Clock className="size-4 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      {" · "}
                      {when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      {" · "}
                      {s.durationMins} min
                      {s.tutorName ? ` · ${s.tutorName}` : ""}
                    </p>
                  </div>
                  {isLive && (
                    <Badge variant="outline" className="text-[10px] shrink-0 bg-emerald-100 text-emerald-700 border-emerald-200">
                      Live
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {s.visibility === "PUBLIC"
                      ? <><Globe className="size-3 mr-1" /> Whole course</>
                      : <><Lock className="size-3 mr-1" /> {s.inviteCount} invited</>}
                  </Badge>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {upcoming.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Edit, start or cancel a class from{" "}
          <Link href={sessionsBase} className="text-primary underline underline-offset-2">
            Live Sessions
          </Link>.
        </p>
      )}
    </div>
  )
}
