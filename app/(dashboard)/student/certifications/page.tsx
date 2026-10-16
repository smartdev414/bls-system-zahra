"use client"

import Link from "next/link"
import {
  Award, BookOpen, Video, Users, Loader2,
  ArrowRight, CheckCircle2, Clock, Lock, GraduationCap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useFetch } from "@/hooks/use-fetch"
import { levelColor, type CourseLevel } from "@/lib/levels"

type CertProgram = {
  id: string
  title: string
  description: string | null
  level: CourseLevel
  price: number
  imageUrl: string | null
  stepCount: number
  enrollmentCount: number
  stepTypes: string[]
  isEnrolled: boolean
  enrollment: {
    id: string
    status: string
    passedCount: number
    totalSteps: number
    progress: number
    certificate: { token: string; issuedAt: string; expiresAt: string | null } | null
  } | null
}

const stepIcon: Record<string, React.ElementType> = {
  COURSE_COMPLETION: GraduationCap, QUIZ: BookOpen, VIDEO_SUBMISSION: Video, LIVE_ASSESSMENT: Users,
}

export default function StudentCertificationsPage() {
  const { data, loading } = useFetch<{ programs: CertProgram[] }>("/api/student/certifications", {
    errorMessage: "Could not load certifications",
  })

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
  }

  const programs = data?.programs ?? []
  const myActive = programs.filter((p) => p.isEnrolled && p.enrollment?.status === "ACTIVE")
  const myCompleted = programs.filter((p) => p.enrollment?.status === "COMPLETED")
  const available = programs.filter((p) => !p.isEnrolled)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Award className="size-6 text-primary" /> Certifications
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Earn verified certificates to prove your BSL skills to employers</p>
      </div>

      {/* Completed */}
      {myCompleted.length > 0 && (
        <Section title="Your Certificates" icon={CheckCircle2}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myCompleted.map((p) => (
              <CertCard key={p.id} program={p} />
            ))}
          </div>
        </Section>
      )}

      {/* In progress */}
      {myActive.length > 0 && (
        <Section title="In Progress" icon={Clock}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myActive.map((p) => (
              <CertCard key={p.id} program={p} />
            ))}
          </div>
        </Section>
      )}

      {/* Available */}
      {available.length > 0 && (
        <Section title="Available Certifications" icon={Award}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((p) => (
              <CertCard key={p.id} program={p} />
            ))}
          </div>
        </Section>
      )}

      {programs.length === 0 && (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="rounded-full bg-muted p-5 mb-4">
            <Award className="size-8 text-muted-foreground" />
          </div>
          <p className="font-semibold">No certifications available yet</p>
          <p className="text-sm text-muted-foreground mt-1">Check back soon — new programs are being created.</p>
        </div>
      )}
    </div>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-3">
        <Icon className="size-3.5" /> {title}
      </h2>
      {children}
    </div>
  )
}

function CertCard({ program: p }: { program: CertProgram }) {
  const isCompleted = p.enrollment?.status === "COMPLETED"
  const hasCert = !!p.enrollment?.certificate

  // Unique step type icons
  const uniqueTypes = [...new Set(p.stepTypes)]

  return (
    <Link
      href={`/student/certifications/${p.id}`}
      className={`block rounded-xl bg-card border-0 hover:bg-muted/30 transition-colors overflow-hidden ${isCompleted ? "ring-1 ring-emerald-200" : ""}`}
    >
      {/* Color strip */}
      <div className={`h-1.5 ${isCompleted ? "bg-emerald-500" : p.isEnrolled ? "bg-primary" : "bg-muted"}`} />

      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <Badge variant="outline" className={`text-[10px] mb-1.5 ${levelColor[p.level]}`}>
              {p.level}
            </Badge>
            <h3 className="font-bold text-sm leading-snug">{p.title}</h3>
          </div>
          {hasCert && (
            <div className="shrink-0 rounded-full bg-emerald-100 p-1.5">
              <Award className="size-4 text-emerald-600" />
            </div>
          )}
        </div>

        {p.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
        )}

        {/* Step types */}
        <div className="flex items-center gap-2">
          {uniqueTypes.map((t) => {
            const Icon = stepIcon[t] ?? BookOpen
            return <Icon key={t} className="size-3.5 text-muted-foreground" />
          })}
          <span className="text-[11px] text-muted-foreground">{p.stepCount} steps</span>
        </div>

        {/* Progress */}
        {p.enrollment && (
          <div className="space-y-1">
            <Progress value={p.enrollment.progress} className={`h-1.5 ${isCompleted ? "[&>div]:bg-emerald-500" : ""}`} />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{p.enrollment.passedCount}/{p.enrollment.totalSteps} steps passed</span>
              <span className={`font-bold ${isCompleted ? "text-emerald-600" : "text-foreground"}`}>{p.enrollment.progress}%</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t">
          <span />
          <span className="text-xs font-semibold text-primary flex items-center gap-1">
            {isCompleted ? "View Certificate" : p.isEnrolled ? "Continue" : "Learn More"}
            <ArrowRight className="size-3" />
          </span>
        </div>
      </div>
    </Link>
  )
}
