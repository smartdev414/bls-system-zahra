"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BarChart3, BookOpen, ChevronLeft, Copy, Info, Loader2, MoreHorizontal, Plus, Save, Trash2, X,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ReleaseBadge } from "@/components/courses/ReleaseField"
import {
  QuizBuilder, isBlankQuestion, questionProblem, saveQuestionDraft, withSaved, type QuestionDraft, type QuestionKind,
} from "@/components/quiz/QuizBuilder"
import { SignListBuilder } from "@/components/quiz/SignListBuilder"
import {
  AnswerMinutesField, AnswerSecondsField, SignPlaysField, StoryVideoField, TestKindPicker, TutorMarksField, VocabularyModeField,
} from "@/components/quiz/TestKindFields"
import { AssessmentPartsBuilder } from "@/components/quiz/AssessmentPartsBuilder"
import { TestSettingsFields, testSettingsBody, type TestSettingsDraft } from "@/components/quiz/TestSettingsFields"
import { AddToCourseDialog } from "@/components/tests/AddToCourseDialog"
import { DictionaryPicker, type DictionarySign } from "@/components/tests/DictionaryPicker"
import { TestQuestionsView } from "@/components/tests/TestQuestionsView"
import { useTestsBase } from "@/hooks/use-tests-base"
import { COURSE_LEVELS, levelColor, levelLabel, type CourseLevel } from "@/lib/levels"
import { DEFAULT_ANSWER_MINUTES, DEFAULT_ANSWER_SECONDS, TEST_KIND_INFO, isAssessment, isSignTest, picksWords, type TestKind, type VocabularyMode } from "@/lib/quiz"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type ApiQuestion = {
  id: string
  question: string
  imageUrl: string | null
  mediaType: string | null
  videoControls: boolean
  questionAfterVideo: boolean
  type: QuestionKind
  modelAnswer: string | null
  maxMarks: number | null
  answerVideoUrl: string | null
  questionsVideoUrl: string | null
  options: Array<{ id: string; text: string; imageUrl: string | null; mediaType: string | null; isCorrect: boolean }>
}

type Placement = {
  lessonId: string
  releaseAt: string | null
  sectionTitle: string
  course: { id: string; title: string; level: CourseLevel; status: string }
  studentsTaken: number
  studentsPassed: number
  canManage: boolean
}

type TestFull = {
  id: string
  title: string
  description: string | null
  level: CourseLevel | null
  testKind: TestKind
  storyUrl: string | null
  storyControls: boolean
  answerSeconds: number | null
  signPlays: number | null
  vocabularyMode: VocabularyMode
  answerMinutes: number | null
  tutorMarks: boolean
  passMark: number
  maxAttempts: number | null
  createdByName: string | null
  questions: ApiQuestion[]
  placements: Placement[]
}

type Details = {
  title: string
  description: string
  level: CourseLevel | ""
  kind: TestKind
  settings: TestSettingsDraft
  answerSeconds: number
  signPlays: number | null
  vocabularyMode: VocabularyMode
  storyUrl: string | null
  storyControls: boolean
  answerMinutes: number
  tutorMarks: boolean
}

function toDraft(q: ApiQuestion): QuestionDraft {
  return {
    uid: q.id,
    id: q.id,
    question: q.question,
    imageUrl: q.imageUrl ?? undefined,
    mediaType: (q.mediaType ?? undefined) as "image" | "video" | undefined,
    videoControls: q.videoControls,
    questionAfterVideo: q.questionAfterVideo,
    type: q.type,
    modelAnswer: q.modelAnswer ?? undefined,
    maxMarks: q.maxMarks ?? undefined,
    answerVideoUrl: q.answerVideoUrl ?? undefined,
    questionsVideoUrl: q.questionsVideoUrl ?? undefined,
    options: q.options.map((o) => ({
      id: o.id,
      text: o.text,
      imageUrl: o.imageUrl ?? undefined,
      mediaType: (o.mediaType ?? undefined) as "image" | "video" | undefined,
      isCorrect: o.isCorrect,
    })),
    isOpen: false,
    isSaving: false,
    error: null,
  }
}

function detailsOf(test: TestFull): Details {
  return {
    title: test.title,
    description: test.description ?? "",
    level: test.level ?? "",
    kind: test.testKind,
    settings: { passMark: String(test.passMark), maxAttempts: test.maxAttempts ? String(test.maxAttempts) : null },
    answerSeconds: test.answerSeconds ?? DEFAULT_ANSWER_SECONDS,
    signPlays: test.signPlays ?? null,
    vocabularyMode: test.vocabularyMode,
    storyUrl: test.storyUrl,
    storyControls: test.storyControls,
    answerMinutes: test.answerMinutes ?? DEFAULT_ANSWER_MINUTES,
    tutorMarks: test.tutorMarks,
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// One test in the bank. Whoever may change it builds it here — questions,
// settings, and the courses it is in; anyone else sees it and can copy it or
// add it to their own courses. Shared by the tutor and admin portals.
export default function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const testsBase = useTestsBase()

  const [test, setTest] = useState<TestFull | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [details, setDetails] = useState<Details | null>(null)
  const [saved, setSaved] = useState<Details | null>(null)
  const [questions, setQuestions] = useState<QuestionDraft[]>([])
  const [tab, setTab] = useState("questions")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const [pickingSigns, setPickingSigns] = useState(false)
  const [addingSigns, setAddingSigns] = useState(false)

  async function load() {
    try {
      const res = await fetch(`/api/tests/${id}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { test: TestFull; canEdit: boolean }
      setTest(d.test)
      setCanEdit(d.canEdit)
      return d.test
    } catch {
      setTest(null)
      return null
    } finally {
      setLoading(false)
    }
  }

  // First load: the form starts from what is stored.
  useEffect(() => {
    void load().then((t) => {
      if (!t) return
      setDetails(detailsOf(t))
      setSaved(detailsOf(t))
      setQuestions(t.questions.map(toDraft))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const detailsChanged = !!details && !!saved && JSON.stringify(details) !== JSON.stringify(saved)
  const pendingQuestions = questions.filter((q) => !isBlankQuestion(q) && (!q.id || q.dirty))
  const unsaved = detailsChanged || pendingQuestions.length > 0

  // Leaving with changes not saved asks first.
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unsaved])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-75">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!test || !details) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
        Test not found.
        <Button asChild variant="outline"><Link href={testsBase}>Back to Tests</Link></Button>
      </div>
    )
  }

  const kind = details.kind
  const signTest = isSignTest(kind)
  const assessment = isAssessment(kind)
  const itemName = signTest ? "Sign" : assessment ? "Part" : "Question"
  const savedCount = questions.filter((q) => q.id).length
  const takenSomewhere = test.placements.some((p) => p.studentsTaken > 0)
  const patch = (change: Partial<Details>) => { setDetails((d) => (d ? { ...d, ...change } : d)); setError(null) }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function save() {
    if (!details) return
    if (!details.title.trim()) {
      setTab("settings")
      setError("Give the test a title.")
      return
    }
    const unfinished = pendingQuestions.filter((q) => questionProblem(q, kind))
    if (unfinished.length > 0) {
      const ids = new Set(unfinished.map((q) => q.uid))
      setQuestions((current) => current.map((q) => (
        ids.has(q.uid) ? { ...q, isOpen: true, error: questionProblem(q, kind) } : q
      )))
      const numbers = questions.flatMap((q, i) => (ids.has(q.uid) ? [i + 1] : []))
      setTab("questions")
      setError(
        `${itemName}${numbers.length > 1 ? "s" : ""} ${numbers.join(", ")} ${numbers.length > 1 ? "are" : "is"} not finished. Complete or delete ${numbers.length > 1 ? "them" : "it"}, then save.`
      )
      return
    }
    if (kind === "STORY" && !details.storyUrl) {
      setTab("questions")
      setError("Add the story video, then save.")
      return
    }

    setSaving(true)
    setError(null)
    try {
      // The kind first: questions are checked against it.
      const res = await fetch(`/api/tests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: details.title.trim(),
          description: details.description,
          level: details.level || null,
          testKind: kind,
          ...testSettingsBody(details.settings),
          ...(signTest && { answerSeconds: details.answerSeconds, signPlays: details.signPlays }),
          ...(kind === "VOCABULARY" && { vocabularyMode: details.vocabularyMode }),
          ...(kind === "STORY" && { storyUrl: details.storyUrl, storyControls: details.storyControls }),
          ...(assessment && {
            storyUrl: details.storyUrl, storyControls: details.storyControls,
            answerMinutes: details.answerMinutes, tutorMarks: details.tutorMarks,
          }),
        }),
      })
      const d = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(d.message ?? "Could not save the test")
      setSaved(details)

      for (const q of pendingQuestions) {
        try {
          const result = await saveQuestionDraft(id, q)
          setQuestions((current) => current.map((old) => (old.uid === q.uid ? withSaved(old, result) : old)))
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not save this question"
          setQuestions((current) => current.map((old) => (old.uid === q.uid ? { ...old, isOpen: true, error: message } : old)))
          setTab("questions")
          throw new Error(`${itemName} ${questions.indexOf(q) + 1} could not be saved: ${message}`)
        }
      }
      // Blank questions nobody typed into are left out rather than kept as "unsaved".
      setQuestions((current) => current.filter((q) => q.id || !isBlankQuestion(q)))
      toast.success("Test saved")
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function addSigns(signs: DictionarySign[]) {
    if (signs.length === 0) return
    // A kind not saved yet would make the wrong sort of question.
    if (saved && kind !== saved.kind) {
      toast.error("Save the test first, so the signs are added for its new kind.")
      return
    }
    setAddingSigns(true)
    try {
      const res = await fetch(`/api/tests/${id}/questions/from-dictionary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signIds: signs.map((s) => s.id) }),
      })
      const d = await res.json().catch(() => ({})) as { questions?: ApiQuestion[]; added?: number; skipped?: number; message?: string }
      if (!res.ok || !d.questions) throw new Error(d.message ?? "Could not add the signs")
      setQuestions((current) => [...current, ...d.questions!.map(toDraft)])
      const noun = signTest ? "sign" : "question"
      toast.success(
        `${d.added} ${noun}${d.added === 1 ? "" : "s"} added` +
        (d.skipped ? ` · ${d.skipped} already in the test` : ""),
      )
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the signs")
    } finally {
      setAddingSigns(false)
    }
  }

  async function duplicate() {
    try {
      const res = await fetch(`/api/tests/${id}/duplicate`, { method: "POST" })
      const d = await res.json().catch(() => ({})) as { test?: { id: string }; message?: string }
      if (!res.ok || !d.test) throw new Error(d.message ?? "Could not copy the test")
      toast.success("Copied — this copy is yours to change")
      router.push(`${testsBase}/${d.test.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not copy the test")
    }
  }

  async function remove() {
    if (!test) return
    const where = test.placements.length > 0
      ? `\n\nIt is in ${test.placements.length} course${test.placements.length !== 1 ? "s" : ""}. It will be taken out of them, and the students' results there are deleted.`
      : ""
    if (!window.confirm(`Delete "${test.title}"?${where}`)) return
    const res = await fetch(`/api/tests/${id}`, { method: "DELETE" })
    if (!res.ok) { toast.error("Could not delete the test"); return }
    toast.success("Test deleted")
    router.push(testsBase)
  }

  async function takeOut(p: Placement) {
    const results = p.studentsTaken > 0
      ? ` ${p.studentsTaken} student${p.studentsTaken !== 1 ? "s have" : " has"} taken it there — their results are deleted.`
      : ""
    if (!window.confirm(`Take this test out of ${p.course.title}?${results}`)) return
    const res = await fetch(`/api/tests/${id}/courses/${p.lessonId}`, { method: "DELETE" })
    if (!res.ok) { toast.error("Could not take the test out of the course"); return }
    toast.success(`Taken out of ${p.course.title}`)
    void load()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const courseCount = test.placements.length

  const coursesTab = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {courseCount === 0
            ? "This test is not in any course yet, so students cannot take it."
            : `Students on ${courseCount === 1 ? "this course" : `these ${courseCount} courses`} take this test. Each course keeps its own results.`}
        </p>
        <Button size="sm" onClick={() => setPlacing(true)}><Plus className="size-4 mr-1.5" /> Add to a course</Button>
      </div>
      {test.placements.map((p) => {
        const coursesBase = testsBase.startsWith("/admin") ? "/admin/courses" : "/tutor/courses"
        return (
          <div key={p.lessonId} className="flex flex-wrap items-center gap-3 rounded-xl border bg-background p-3">
            <Badge variant="outline" className={cn("text-[10px] shrink-0", levelColor[p.course.level])}>{levelLabel[p.course.level]}</Badge>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">
                {p.course.title}
                {p.course.status === "DRAFT" && <span className="font-normal text-muted-foreground"> (draft)</span>}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {p.sectionTitle} · {p.studentsTaken === 0
                  ? "Nobody has taken it yet"
                  : `${p.studentsTaken} taken · ${p.studentsPassed} passed`}
              </p>
            </div>
            <ReleaseBadge releaseAt={p.releaseAt} />
            {p.canManage && (
              <div className="flex gap-1">
                <Button asChild size="sm" variant="outline">
                  <Link href={`${coursesBase}/${p.course.id}/lessons/${p.lessonId}`}><BarChart3 className="size-4 mr-1.5" /> Results</Link>
                </Button>
                <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" title="Take out of this course"
                  aria-label={`Take out of ${p.course.title}`} onClick={() => takeOut(p)}>
                  <X className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href={testsBase}><ChevronLeft className="size-4 mr-1" /> Back to Tests</Link>
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight break-words">{test.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant="outline">{TEST_KIND_INFO[test.testKind].label}</Badge>
            {test.level && <Badge variant="outline" className={levelColor[test.level]}>{levelLabel[test.level]}</Badge>}
            <span className="text-xs text-muted-foreground">
              {courseCount === 0 ? "Not in a course yet" : `In ${courseCount} course${courseCount !== 1 ? "s" : ""}`}
              {test.createdByName && ` · by ${test.createdByName}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <Button onClick={save} disabled={saving || !unsaved}>
              {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />}
              {saving ? "Saving…" : unsaved ? "Save changes" : "Saved"}
            </Button>
          ) : (
            <Button onClick={duplicate}><Copy className="size-4 mr-1.5" /> Make a copy to change</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More"><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setPlacing(true)}><BookOpen className="size-4" /> Add to a course</DropdownMenuItem>
              {canEdit && <DropdownMenuItem onSelect={duplicate}><Copy className="size-4" /> Make a copy</DropdownMenuItem>}
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={remove}>
                    <Trash2 className="size-4" /> Delete test
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!canEdit && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <Info className="size-4 shrink-0 mt-0.5" />
          {test.createdByName ?? "Someone else"} made this test, so you can use it but not change it. Make a copy to change it.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="questions">{itemName}s ({canEdit ? questions.filter((q) => !isBlankQuestion(q)).length : test.questions.length})</TabsTrigger>
          {canEdit && <TabsTrigger value="settings">Settings</TabsTrigger>}
          <TabsTrigger value="courses">Courses ({courseCount})</TabsTrigger>
        </TabsList>

        <TabsContent value="questions" className="flex flex-col gap-6">
          {!canEdit ? (
            <TestQuestionsView kind={test.testKind} storyUrl={test.storyUrl} questions={test.questions} />
          ) : (
            <>
              {takenSomewhere && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <Info className="size-4 shrink-0 mt-0.5" />
                  Students have already taken this test. A change applies to their next go, in every course it is in.
                </p>
              )}
              {kind === "VOCABULARY" && (
                <VocabularyModeField value={details.vocabularyMode} onChange={(vocabularyMode) => patch({ vocabularyMode })} />
              )}
              {(kind === "STORY" || assessment) && (
                <>
                  {kind === "STORY"
                    ? <StoryVideoField value={details.storyUrl} onChange={(url) => patch({ storyUrl: url })} />
                    : <StoryVideoField
                        label="Short synopsis (optional)"
                        hint="Students watch this before part 1."
                        value={details.storyUrl}
                        onChange={(url) => patch({ storyUrl: url })}
                      />}
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={details.storyControls}
                      onCheckedChange={(v) => patch({ storyControls: v === true })}
                    />
                    <span>
                      {assessment ? "Students can control the videos" : "Students can control the story video"}
                      <span className="block text-xs text-muted-foreground">
                        {assessment
                          ? "Pause, rewind and watch again. Untick to have each video play through once, like the real assessment."
                          : "Pause, rewind and skip. Untick to have it just play through, like an assessment."}
                      </span>
                    </span>
                  </label>
                </>
              )}
              {addingSigns && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Adding signs from the dictionary…
                </p>
              )}
              {assessment ? (
                <AssessmentPartsBuilder
                  testId={id}
                  parts={questions}
                  onChange={(next) => { setQuestions(next); setError(null) }}
                />
              ) : isSignTest(kind) ? (
                <SignListBuilder
                  kind={kind}
                  testId={id}
                  signs={questions}
                  onChange={(next) => { setQuestions(next); setError(null) }}
                  onAddFromDictionary={() => setPickingSigns(true)}
                  signOnly={kind === "VOCABULARY" && details.vocabularyMode === "SIGN_IT"}
                />
              ) : (
                <QuizBuilder
                  selfMarked
                  testId={id}
                  questions={questions}
                  onChange={(next) => { setQuestions(next); setError(null) }}
                  onAddFromDictionary={() => setPickingSigns(true)}
                />
              )}
              {pendingQuestions.length > 0 && (
                <Button className="self-start" onClick={save} disabled={saving}>
                  <Save className="size-4 mr-1.5" /> {saving ? "Saving…" : "Save changes"}
                </Button>
              )}
            </>
          )}
        </TabsContent>

        {canEdit && (
          <TabsContent value="settings" className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-title">Title</Label>
              <Input id="test-title" className="h-11" maxLength={150} value={details.title} onChange={(e) => patch({ title: e.target.value })} />
            </div>

            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label htmlFor="test-level">Level</Label>
              <select
                id="test-level"
                value={details.level}
                onChange={(e) => patch({ level: e.target.value as CourseLevel | "" })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Any level</option>
                {COURSE_LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-description">Instructions for students <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea
                id="test-description"
                rows={3}
                placeholder="e.g. Watch each sign and choose what it means."
                value={details.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>

            <TestSettingsFields
              value={details.settings}
              onChange={(settings) => patch({ settings })}
              questionCount={questions.filter((q) => !isBlankQuestion(q)).length}
              noun={itemName.toLowerCase()}
            />

            {/* The clock is for picking the word; signing a word is not timed. */}
            {signTest && (kind === "FINGERSPELLING" || picksWords({ testKind: kind, vocabularyMode: details.vocabularyMode })) && (
              <div className="flex flex-col sm:flex-row gap-4">
                <AnswerSecondsField value={details.answerSeconds} onChange={(answerSeconds) => patch({ answerSeconds })} />
                <SignPlaysField value={details.signPlays} onChange={(signPlays) => patch({ signPlays })} />
              </div>
            )}

            {assessment && (
              <div className="flex flex-col sm:flex-row gap-4">
                <AnswerMinutesField value={details.answerMinutes} onChange={(answerMinutes) => patch({ answerMinutes })} />
                <TutorMarksField value={details.tutorMarks} onChange={(tutorMarks) => patch({ tutorMarks })} />
              </div>
            )}

            {savedCount === 0 ? (
              <TestKindPicker
                value={kind}
                onChange={(k) => {
                  // Questions are made differently per kind, so unsaved ones do not carry over.
                  const started = questions.filter((q) => !isBlankQuestion(q)).length
                  if (k === kind || (started > 0 && !window.confirm("Change the kind of test? The questions you have started are removed."))) return
                  setQuestions([])
                  patch({ kind: k })
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Kind of test: <span className="font-medium text-foreground">{TEST_KIND_INFO[kind].label}</span>. It can be changed while the test has no {itemName.toLowerCase()}s.
              </p>
            )}
          </TabsContent>
        )}

        <TabsContent value="courses">{coursesTab}</TabsContent>
      </Tabs>

      <AddToCourseDialog
        test={{ id: test.id, title: test.title, level: test.level }}
        open={placing}
        onOpenChange={setPlacing}
        onAdded={() => { void load(); setTab("courses") }}
      />

      <DictionaryPicker
        open={pickingSigns}
        onOpenChange={setPickingSigns}
        initialLevel={test.level}
        description={signTest
          ? "Each sign you pick is added with its video and its word."
          : "Each sign you pick becomes a question: “What does this sign mean?”, with its word and three others to choose from."}
        onPick={(signs) => void addSigns(signs)}
      />
    </div>
  )
}
