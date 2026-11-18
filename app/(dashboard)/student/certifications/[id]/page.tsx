"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  Award, BookOpen, Video, Users, Loader2, ArrowLeft,
  CheckCircle2, XCircle, Clock, Upload, Lock, Share2, Copy,
  ArrowRight, GraduationCap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useFetch, usePostCallback } from "@/hooks/use-fetch"
import { FileUpload, UploadedFile } from "@/components/ui/file-upload"
import { CertQuizTaker } from "@/components/certification/CertQuizTaker"
import { toast } from "sonner"
import { levelColorSolid, type CourseLevel } from "@/lib/levels"

const stepTypeIcon: Record<string, React.ElementType> = { COURSE_COMPLETION: GraduationCap, QUIZ: BookOpen, VIDEO_SUBMISSION: Video, LIVE_ASSESSMENT: Users }
const stepTypeLabel: Record<string, string> = { COURSE_COMPLETION: "Course Completion", QUIZ: "Quiz", VIDEO_SUBMISSION: "Video Submission", LIVE_ASSESSMENT: "Live Assessment" }
const stepTypeColor: Record<string, string> = { COURSE_COMPLETION: "bg-primary/10 text-primary", QUIZ: "bg-violet-100 text-violet-600", VIDEO_SUBMISSION: "bg-sky-100 text-sky-600", LIVE_ASSESSMENT: "bg-emerald-100 text-emerald-600" }

const statusConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  NOT_STARTED: { label: "Not Started", icon: Clock, color: "bg-muted text-muted-foreground" },
  PENDING: { label: "Under Review", icon: Clock, color: "bg-amber-100 text-amber-700" },
  UNDER_REVIEW: { label: "Under Review", icon: Clock, color: "bg-blue-100 text-blue-700" },
  PASSED: { label: "Passed", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-700" },
  FAILED: { label: "Needs Revision", icon: XCircle, color: "bg-rose-100 text-rose-700" },
}

type Step = {
  id: string
  title: string
  description: string | null
  type: string
  sortOrder: number
  config: Record<string, unknown>
  submission: {
    id: string
    status: string
    data: Record<string, unknown>
    reviewNote: string | null
    submittedAt: string | null
    reviewedAt: string | null
  } | null
}

export default function StudentCertDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, refetch } = useFetch<{ program: any; enrollment: any }>(`/api/student/certifications/${id}`, {
    errorMessage: "Could not load certification",
  })
  const [videoUpload, setVideoUpload] = useState<{ stepId: string } | null>(null)
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)

  const { execute: enroll, loading: enrolling } = usePostCallback<{ enrollment: object }, object>(
    `/api/student/certifications/${id}`,
    { successMessage: "Enrolled!", errorMessage: "Could not enrol", onSuccess: () => refetch() },
  )

  async function submitStep(stepId: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/student/certifications/${id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, data }),
    })
    const result = await res.json() as { message?: string; status?: string }
    if (res.ok) {
      toast.success(result.status === "PASSED" ? "Step passed!" : "Submitted for review")
      setVideoUpload(null); setUploadedFile(null)
      refetch()
    } else {
      toast.error(result.message ?? "Could not submit")
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
  if (!data) return null

  const { program, enrollment } = data
  const steps: Step[] = program.steps ?? []
  const isEnrolled = !!enrollment
  const isCompleted = enrollment?.status === "COMPLETED"
  const cert = enrollment?.certificate
  const passedCount = steps.filter((s) => s.submission?.status === "PASSED").length
  const progress = steps.length > 0 ? Math.round((passedCount / steps.length) * 100) : 0

  // Determine which step is "current" (first non-passed)
  const currentStepIdx = steps.findIndex((s) => s.submission?.status !== "PASSED")

  const appUrl = typeof window !== "undefined" ? window.location.origin : ""

  return (
    <div className="max-w-3xl flex flex-col gap-6">
      <Link href="/student/certifications" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft className="size-3.5" /> All Certifications
      </Link>

      {/* Hero */}
      <div className="rounded-2xl overflow-hidden">
        <div className="hero-banner relative bg-linear-to-br from-primary via-primary/90 to-violet-600 px-6 py-8 text-white">
          <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={`text-[0.625rem] ${levelColorSolid[program.level as CourseLevel]} border`}>{program.level}</Badge>
              {isCompleted && <Badge className="bg-white/20 text-white border-0 text-[0.625rem] gap-1"><CheckCircle2 className="size-2.5" /> Certified</Badge>}
            </div>
            <h1 className="text-2xl font-black tracking-tight">{program.title}</h1>
            {program.description && <p className="text-sm text-white/75 mt-2 max-w-lg leading-relaxed">{program.description}</p>}
          </div>
        </div>

        {/* Progress bar */}
        {isEnrolled && (
          <div className="bg-card border border-t-0 rounded-b-2xl px-6 py-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">{passedCount}/{steps.length} steps completed</span>
              <span className={`font-bold ${isCompleted ? "text-emerald-600" : "text-foreground"}`}>{progress}%</span>
            </div>
            <Progress value={progress} className={`h-2 ${isCompleted ? "[&>div]:bg-emerald-500" : ""}`} />
          </div>
        )}
      </div>

      {/* Certificate share */}
      {cert && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-5 flex items-center gap-4 flex-wrap">
            <div className="rounded-full bg-emerald-100 p-2.5 shrink-0">
              <Award className="size-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-emerald-900">Certificate Earned!</p>
              <p className="text-xs text-emerald-700 mt-0.5">Share this link with employers to verify your certification.</p>
            </div>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
              onClick={() => {
                navigator.clipboard.writeText(`${appUrl}/verify/${cert.token}`)
                toast.success("Certificate link copied!")
              }}
            >
              <Copy className="size-3.5" /> Copy Link
            </Button>
            <Button asChild size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              <Link href={`/verify/${cert.token}`} target="_blank">
                <Share2 className="size-3.5" /> View Certificate
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Enroll button */}
      {!isEnrolled && (
        <Button className="w-full" size="lg" onClick={() => enroll({})} disabled={enrolling}>
          {enrolling ? <Loader2 className="size-4 animate-spin mr-2" /> : <Award className="size-4 mr-2" />}
          {enrolling ? "Enrolling..." : "Enrol"}
        </Button>
      )}

      {/* Steps */}
      {isEnrolled && (
        <div className="flex flex-col gap-3">
          {steps.map((step, i) => {
            const Icon = stepTypeIcon[step.type] ?? BookOpen
            const sub = step.submission
            const sCfg = statusConfig[sub?.status ?? "NOT_STARTED"]
            const StatusIcon = sCfg.icon
            const isPassed = sub?.status === "PASSED"
            const isCurrent = i === currentStepIdx
            const isLocked = !isCompleted && i > currentStepIdx && currentStepIdx >= 0
            const canSubmit = isCurrent || (sub?.status === "FAILED")

            return (
              <Card key={step.id} className={`transition-all ${isCurrent ? "ring-1 ring-primary/30" : ""} ${isLocked ? "opacity-50" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Step number */}
                    <div className={`size-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${isPassed ? "bg-emerald-500 text-white" : isCurrent ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                      {isPassed ? <CheckCircle2 className="size-4" /> : i + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold">{step.title}</h3>
                        <Badge variant="outline" className={`text-[0.625rem] ${sCfg.color} gap-0.5`}>
                          <StatusIcon className="size-2.5" /> {sCfg.label}
                        </Badge>
                      </div>

                      {/* Type + description */}
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className={`rounded p-0.5 ${stepTypeColor[step.type]}`}>
                          <Icon className="size-3" />
                        </div>
                        <span className="text-[0.6875rem] text-muted-foreground">{stepTypeLabel[step.type]}</span>
                      </div>

                      {step.description && (
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{step.description}</p>
                      )}

                      {/* Review feedback */}
                      {sub?.reviewNote && (
                        <div className="mt-2 rounded-lg bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">Feedback:</span> {sub.reviewNote}
                        </div>
                      )}

                      {/* Course info */}
                      {step.type === "COURSE_COMPLETION" && (() => {
                        const cfg = step.config as any
                        const courses: { courseId: string; courseTitle: string }[] = cfg.courses ?? (cfg.courseId ? [{ courseId: cfg.courseId, courseTitle: cfg.courseTitle }] : [])
                        return courses.length > 0 ? (
                          <div className="mt-2 flex flex-col gap-1">
                            {courses.map((c) => (
                              <Link
                                key={c.courseId}
                                href={`/student/lessons?courseId=${c.courseId}`}
                                className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-primary flex items-center gap-1.5 hover:bg-primary/10 transition-colors"
                              >
                                <GraduationCap className="size-3.5 shrink-0" />
                                <span className="font-semibold">{c.courseTitle || "Course"}</span>
                                <ArrowRight className="size-3 ml-auto" />
                              </Link>
                            ))}
                          </div>
                        ) : null
                      })()}

                      {/* Video prompt */}
                      {step.type === "VIDEO_SUBMISSION" && canSubmit && (step.config as any).prompt && (
                        <div className="mt-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-700">
                          <span className="font-semibold">Task:</span> {(step.config as any).prompt}
                        </div>
                      )}

                      {/* Live assessment instructions */}
                      {step.type === "LIVE_ASSESSMENT" && canSubmit && (step.config as any).instructions && (
                        <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
                          <span className="font-semibold">Instructions:</span> {(step.config as any).instructions}
                        </div>
                      )}

                      {/* Action buttons */}
                      {canSubmit && !isLocked && (
                        <div className="mt-3">
                          {step.type === "COURSE_COMPLETION" && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button size="sm" className="gap-1.5 text-xs" onClick={() => submitStep(step.id, {})}>
                                <CheckCircle2 className="size-3.5" /> Verify Completion
                              </Button>
                              <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
                                <Link href={`/student/lessons?courseId=${(step.config as any).courseId}`}>
                                  <GraduationCap className="size-3.5" /> Go to Course
                                </Link>
                              </Button>
                            </div>
                          )}
                          {step.type === "QUIZ" && Array.isArray((step.config as any).questions) && (step.config as any).questions.length > 0 && (
                            <CertQuizTaker
                              questions={(step.config as any).questions}
                              passScore={(step.config as any).passScore ?? 80}
                              onSubmit={(score) => submitStep(step.id, { score })}
                            />
                          )}
                          {step.type === "VIDEO_SUBMISSION" && (
                            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setVideoUpload({ stepId: step.id })}>
                              <Upload className="size-3.5" /> Upload Video
                            </Button>
                          )}
                          {step.type === "LIVE_ASSESSMENT" && sub?.status !== "PENDING" && (
                            <Button size="sm" className="gap-1.5 text-xs" onClick={() => submitStep(step.id, { requestedAt: new Date().toISOString() })}>
                              <Users className="size-3.5" /> Request Assessment
                            </Button>
                          )}
                        </div>
                      )}

                      {isLocked && (
                        <p className="text-[0.6875rem] text-muted-foreground mt-2 flex items-center gap-1">
                          <Lock className="size-3" /> Complete previous steps to unlock
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Video upload dialog */}
      <Dialog open={!!videoUpload} onOpenChange={(v) => { if (!v) { setVideoUpload(null); setUploadedFile(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Video Submission</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <FileUpload
              accept="video/*,image/*"
              label="Upload your recording"
              onUploaded={(file) => setUploadedFile(file)}
              uploaded={uploadedFile}
              onRemove={() => setUploadedFile(null)}
            />
            <Button
              disabled={!uploadedFile}
              onClick={() => {
                if (videoUpload && uploadedFile) {
                  submitStep(videoUpload.stepId, {
                    videoUrl: uploadedFile.fileUrl,
                    fileName: uploadedFile.fileName,
                  })
                }
              }}
            >
              Submit for Review
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
