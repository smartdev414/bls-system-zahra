"use client"

import { use, useState } from "react"
import Link from "next/link"
import {
  ChevronLeft, Plus, Loader2, BookOpen, Video, Users,
  Award, CheckCircle2, XCircle, Clock, Trash2, GripVertical,
  Eye, Pencil, MessageSquare, GraduationCap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useFetch, usePostCallback } from "@/hooks/use-fetch"
import { mediaSrc } from "@/lib/protected-media"
import { toast } from "sonner"
import { QuizBuilder, QuestionDraft } from "@/components/quiz/QuizBuilder"

const stepTypeIcon: Record<string, React.ElementType> = { COURSE_COMPLETION: GraduationCap, QUIZ: BookOpen, VIDEO_SUBMISSION: Video, LIVE_ASSESSMENT: Users }
const stepTypeLabel: Record<string, string> = { COURSE_COMPLETION: "Course Completion", QUIZ: "Quiz", VIDEO_SUBMISSION: "Video Submission", LIVE_ASSESSMENT: "Live Assessment" }
const stepTypeColor: Record<string, string> = { COURSE_COMPLETION: "text-primary bg-primary/10", QUIZ: "text-violet-600 bg-violet-50", VIDEO_SUBMISSION: "text-sky-600 bg-sky-50", LIVE_ASSESSMENT: "text-emerald-600 bg-emerald-50" }

const submissionStatusColor: Record<string, string> = {
  NOT_STARTED: "bg-muted text-muted-foreground",
  PENDING: "bg-amber-100 text-amber-700",
  UNDER_REVIEW: "bg-blue-100 text-blue-700",
  PASSED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-rose-100 text-rose-700",
}

export default function AdminCertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, loading, refetch } = useFetch<{ program: any }>(`/api/admin/certifications/${id}`, {
    errorMessage: "Could not load program",
  })
  const { data: coursesData } = useFetch<{ courses: { id: string; title: string }[] }>("/api/admin/courses", {
    errorMessage: false,
  })
  const allCourses = (coursesData as any)?.courses ?? coursesData ?? []

  const [addStepOpen, setAddStepOpen] = useState(false)
  const [stepTitle, setStepTitle] = useState("")
  const [stepDesc, setStepDesc] = useState("")
  const [stepType, setStepType] = useState<string>("COURSE_COMPLETION")
  const [passScore, setPassScore] = useState("80")
  const [videoPrompt, setVideoPrompt] = useState("")
  const [liveInstructions, setLiveInstructions] = useState("")
  const [selectedCourses, setSelectedCourses] = useState<{ id: string; title: string }[]>([])
  const [coursePickerOpen, setCoursePickerOpen] = useState(false)
  const [courseSearch, setCourseSearch] = useState("")
  const [quizQuestions, setQuizQuestions] = useState<QuestionDraft[]>([])

  const [reviewOpen, setReviewOpen] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState("")

  async function addStep() {
    let config: Record<string, unknown> = {}
    if (stepType === "COURSE_COMPLETION") {
      if (selectedCourses.length === 0) { toast.error("Select at least one course"); return }
      config = {
        courses: selectedCourses.map((c) => ({ courseId: c.id, courseTitle: c.title })),
      }
    }
    if (stepType === "QUIZ") config = {
      passScore: parseInt(passScore) || 80,
      questions: quizQuestions.map((q) => ({
        id: q.id ?? Math.random().toString(36).slice(2, 10),
        text: q.question,
        type: q.type,
        imageUrl: q.imageUrl ?? null,
        options: q.options.map((o) => ({
          id: Math.random().toString(36).slice(2, 10),
          text: o.text,
          imageUrl: o.imageUrl ?? null,
          isCorrect: o.isCorrect,
        })),
      })),
    }
    if (stepType === "VIDEO_SUBMISSION") config = { prompt: videoPrompt }
    if (stepType === "LIVE_ASSESSMENT") config = { instructions: liveInstructions, durationMins: 30 }

    const res = await fetch(`/api/admin/certifications/${id}/steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: stepTitle, description: stepDesc, type: stepType, config }),
    })
    if (res.ok) {
      setAddStepOpen(false); setStepTitle(""); setStepDesc(""); refetch()
      toast.success("Step added")
    } else toast.error("Could not add step")
  }

  async function deleteStep(stepId: string) {
    const res = await fetch(`/api/admin/certifications/${id}/steps`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId }),
    })
    if (res.ok) { refetch(); toast.success("Step removed") }
    else toast.error("Could not remove step")
  }

  async function reviewSubmission(submissionId: string, status: "PASSED" | "FAILED") {
    const res = await fetch(`/api/admin/certifications/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId, status, reviewNote }),
    })
    if (res.ok) { setReviewOpen(null); setReviewNote(""); refetch(); toast.success(`Marked as ${status.toLowerCase()}`) }
    else toast.error("Could not review submission")
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
  if (!data) return null

  const program = data.program
  const steps = program.steps ?? []
  const enrollments = program.enrollments ?? []

  // Find submissions needing review
  const pendingReviews = enrollments.flatMap((e: any) =>
    (e.submissions ?? [])
      .filter((s: any) => s.status === "PENDING")
      .map((s: any) => ({ ...s, student: e.student, enrollmentId: e.id }))
  )

  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href="/admin/certifications"><ChevronLeft className="size-4 mr-1" /> Certifications</Link>
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className={submissionStatusColor[program.status] ?? ""}>
              {program.status}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {program.level?.charAt(0) + program.level?.slice(1).toLowerCase()}
            </Badge>
          </div>
          <h1 className="text-2xl font-black tracking-tight">{program.title}</h1>
          {program.description && <p className="text-sm text-muted-foreground mt-1">{program.description}</p>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{enrollments.length} enrolled</span>
        </div>
      </div>

      {/* Pending Reviews */}
      {pendingReviews.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="size-4 text-amber-500" /> Pending Reviews
              <Badge className="bg-amber-100 text-amber-700 ml-1">{pendingReviews.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y">
            {pendingReviews.map((sub: any) => {
              const Icon = stepTypeIcon[sub.step?.type] ?? BookOpen
              const initials = sub.student.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
              const subData = (sub.data ?? {}) as Record<string, any>  // eslint-disable-line @typescript-eslint/no-explicit-any
              return (
                <div key={sub.id} className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    <Avatar className="size-8 shrink-0">
                      {sub.student.avatarUrl && <AvatarImage src={sub.student.avatarUrl} />}
                      <AvatarFallback className="text-[0.625rem] bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{sub.student.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Icon className="size-3" /> {sub.step?.title}
                      </p>
                      {subData.videoUrl && (
                        <a href={mediaSrc(subData.videoUrl as string)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline mt-1 block">
                          View video submission
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {reviewOpen === sub.id ? (
                        <div className="flex flex-col gap-2">
                          <Input placeholder="Feedback (optional)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} className="h-7 text-xs w-48" />
                          <div className="flex gap-1.5">
                            <Button size="sm" className="h-6 text-[0.6875rem] bg-emerald-600 hover:bg-emerald-700" onClick={() => reviewSubmission(sub.id, "PASSED")}>
                              <CheckCircle2 className="size-3 mr-1" /> Pass
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 text-[0.6875rem] text-destructive" onClick={() => reviewSubmission(sub.id, "FAILED")}>
                              <XCircle className="size-3 mr-1" /> Fail
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[0.6875rem]" onClick={() => setReviewOpen(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setReviewOpen(sub.id); setReviewNote("") }}>
                          Review
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Steps */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="size-4 text-primary" /> Steps ({steps.length})
            </CardTitle>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAddStepOpen(true)}>
              <Plus className="size-3" /> Add Step
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {steps.length > 0 ? (
            <div className="divide-y">
              {steps.map((step: any, i: number) => {
                const Icon = stepTypeIcon[step.type] ?? BookOpen
                return (
                  <div key={step.id} className="flex items-center gap-3 px-5 py-3 group">
                    <span className="text-xs text-muted-foreground font-bold w-5 text-center">{i + 1}</span>
                    <div className={`rounded-lg p-1.5 shrink-0 ${stepTypeColor[step.type]}`}>
                      <Icon className="size-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{step.title}</p>
                      <p className="text-xs text-muted-foreground">{stepTypeLabel[step.type]}</p>
                    </div>
                    <Button
                      size="icon" variant="ghost"
                      className="size-7 opacity-0 group-hover:opacity-100 text-destructive"
                      onClick={() => deleteStep(step.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No steps yet. Add your first step to define the certification path.</p>
          )}
        </CardContent>
      </Card>

      {/* Enrollments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4 text-primary" /> Enrollments ({enrollments.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {enrollments.length > 0 ? (
            <div className="divide-y">
              {enrollments.map((e: any) => {
                const passedCount = (e.submissions ?? []).filter((s: any) => s.status === "PASSED").length
                const totalSteps = steps.length
                const progress = totalSteps > 0 ? Math.round((passedCount / totalSteps) * 100) : 0
                const initials = e.student.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
                return (
                  <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar className="size-8 shrink-0">
                      {e.student.avatarUrl && <AvatarImage src={e.student.avatarUrl} />}
                      <AvatarFallback className="text-[0.625rem] bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{e.student.name}</p>
                      <p className="text-xs text-muted-foreground">{e.student.email}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-20">
                        <Progress value={progress} className={`h-1.5 ${e.status === "COMPLETED" ? "[&>div]:bg-emerald-500" : ""}`} />
                        <p className="text-[0.625rem] text-muted-foreground text-right mt-0.5">{passedCount}/{totalSteps}</p>
                      </div>
                      <Badge variant="outline" className={`text-[0.625rem] ${e.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : e.status === "ACTIVE" ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>
                        {e.certificate ? "Certified" : e.status}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No enrollments yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Add Step Dialog */}
      <Dialog open={addStepOpen} onOpenChange={setAddStepOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Certification Step</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Step Title</Label>
              <Input value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} placeholder="e.g. BSL Vocabulary Quiz" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description (optional)</Label>
              <Textarea value={stepDesc} onChange={(e) => setStepDesc(e.target.value)} rows={2} className="resize-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Step Type</Label>
              <Select value={stepType} onValueChange={setStepType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COURSE_COMPLETION">Course Completion — Student must complete a course</SelectItem>
                  <SelectItem value="QUIZ">Quiz — Auto-graded</SelectItem>
                  <SelectItem value="VIDEO_SUBMISSION">Video Submission — Manual review</SelectItem>
                  <SelectItem value="LIVE_ASSESSMENT">Live Assessment — Tutor evaluates</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {stepType === "COURSE_COMPLETION" && (
              <div className="flex flex-col gap-2">
                <Label>Required Courses</Label>
                {selectedCourses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCourses.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary text-xs font-medium px-2 py-1">
                        {c.title}
                        <button
                          type="button"
                          onClick={() => setSelectedCourses((prev) => prev.filter((x) => x.id !== c.id))}
                          className="opacity-60 hover:opacity-100 cursor-pointer"
                        >
                          <XCircle className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <Button type="button" variant="outline" size="sm" className="gap-1.5 self-start" onClick={() => { setCoursePickerOpen(true); setCourseSearch("") }}>
                  <Plus className="size-3.5" /> Select Courses
                </Button>
                <p className="text-xs text-muted-foreground">Student must complete all selected courses to pass this step.</p>
              </div>
            )}
            {stepType === "QUIZ" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>Pass Score (%)</Label>
                  <Input type="number" min="1" max="100" value={passScore} onChange={(e) => setPassScore(e.target.value)} />
                </div>
                <Separator />
                <QuizBuilder testId={null} questions={quizQuestions} onChange={setQuizQuestions} />
              </>
            )}
            {stepType === "VIDEO_SUBMISSION" && (
              <div className="flex flex-col gap-1.5">
                <Label>Prompt for Student</Label>
                <Textarea value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)} placeholder="Record yourself signing the following phrases..." rows={3} className="resize-none" />
              </div>
            )}
            {stepType === "LIVE_ASSESSMENT" && (
              <div className="flex flex-col gap-1.5">
                <Label>Assessment Instructions</Label>
                <Textarea value={liveInstructions} onChange={(e) => setLiveInstructions(e.target.value)} placeholder="The assessor will ask you to..." rows={3} className="resize-none" />
              </div>
            )}

            <Button onClick={addStep} disabled={!stepTitle.trim()}>
              <Plus className="size-4 mr-1.5" /> Add Step
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Course picker dialog */}
      <Dialog open={coursePickerOpen} onOpenChange={setCoursePickerOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select Courses</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Search courses..."
            value={courseSearch}
            onChange={(e) => setCourseSearch(e.target.value)}
            className="h-9"
          />
          <div className="flex-1 overflow-y-auto -mx-1 px-1 flex flex-col gap-1 min-h-0">
            {(Array.isArray(allCourses) ? allCourses : [])
              .filter((c: any) => !courseSearch || c.title?.toLowerCase().includes(courseSearch.toLowerCase()))
              .map((c: any) => {
                const isSelected = selectedCourses.some((sc) => sc.id === c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setSelectedCourses((prev) => prev.filter((x) => x.id !== c.id))
                      } else {
                        setSelectedCourses((prev) => [...prev, { id: c.id, title: c.title }])
                      }
                    }}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                      isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className={`size-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                    }`}>
                      {isSelected && <CheckCircle2 className="size-3 text-white" />}
                    </div>
                    <span className="flex-1 truncate">{c.title}</span>
                    {c.level && (
                      <Badge variant="secondary" className="text-[0.5625rem] shrink-0">
                        {c.level.charAt(0) + c.level.slice(1).toLowerCase()}
                      </Badge>
                    )}
                  </button>
                )
              })}
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-muted-foreground">{selectedCourses.length} selected</p>
            <Button size="sm" onClick={() => setCoursePickerOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
