"use client"

import { useState } from "react"
import {
  CheckCircle2, ChevronDown, ChevronUp, Loader2, RotateCcw, XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFetch } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "PASSED" | "FAILED" | "IN_PROGRESS" | "NOT_STARTED"

type StudentResult = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  attempts: number
  attemptsLeft: number | null
  bestScore: number | null
  latestScore: number | null
  lastAttemptAt: string | null
  status: Status
}

type ResultsData = {
  test: { id: string; title: string; passMark: number; maxAttempts: number | null; questionCount: number }
  summary: { students: number; taken: number; passed: number; averageScore: number | null; attempts: number }
  students: StudentResult[]
  questions: Array<{ id: string; order: number; question: string; answered: number; correct: number }>
  /** False for support staff: scores only, not what was answered. */
  seesAnswers: boolean
}

type Attempt = {
  id: string
  score: number
  passed: boolean
  createdAt: string
  answers: Array<{ questionId: string; optionId: string | null; isCorrect: boolean }>
}

/** The test's questions, as the lesson page already has them — to name what a student chose. */
export type ResultsQuestion = { id: string; question: string; options: Array<{ id: string; text: string }> }

const STATUS: Record<Status, { label: string; className: string }> = {
  PASSED: { label: "Passed", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  FAILED: { label: "Not passed", className: "bg-rose-100 text-rose-700 border-rose-200" },
  IN_PROGRESS: { label: "Not passed yet", className: "bg-amber-100 text-amber-700 border-amber-200" },
  NOT_STARTED: { label: "Not taken", className: "text-muted-foreground" },
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

// Fixed widths (not `auto`) so the headings sit exactly over their columns.
const COLUMNS = "grid-cols-[minmax(0,1fr)_6.5rem_2rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5.5rem_7.5rem_6.5rem_2rem]"

// ─── One student's attempts and what they answered ────────────────────────────

function StudentAttempts({ lessonId, student, questions, onReset }: {
  lessonId: string
  student: StudentResult
  questions: ResultsQuestion[]
  onReset: () => void
}) {
  const { data, loading } = useFetch<{ attempts: Attempt[] }>(
    `/api/tutor/lessons/${lessonId}/results?studentId=${student.id}`,
    { errorMessage: "Could not load this student's attempts" },
  )
  const [openId, setOpenId] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  async function reset() {
    if (!window.confirm(
      `Reset ${student.name}'s attempts on this test? Their scores for it are deleted and they can sit it again from the start.`
    )) return
    setResetting(true)
    try {
      const res = await fetch(`/api/tutor/lessons/${lessonId}/results?studentId=${student.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success(`${student.name} can sit this test again`)
      onReset()
    } catch {
      toast.error("Could not reset the attempts")
    } finally {
      setResetting(false)
    }
  }

  if (loading || !data) {
    return <div className="flex justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
  }

  // The newest attempt is open to start with.
  const open = openId ?? data.attempts[0]?.id

  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      {data.attempts.map((attempt, i) => (
        <div key={attempt.id} className="rounded-lg border bg-background">
          <button
            type="button"
            onClick={() => setOpenId(open === attempt.id ? "" : attempt.id)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-xs"
          >
            <span className="text-muted-foreground">
              Attempt {data.attempts.length - i} · {shortDate(attempt.createdAt)}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">{attempt.score}%</span>
              {attempt.passed
                ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                : <XCircle className="size-3.5 text-rose-500" />}
              {open === attempt.id ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </span>
          </button>

          {open === attempt.id && (
            <ol className="border-t divide-y">
              {questions.map((q, n) => {
                const answer = attempt.answers.find((a) => a.questionId === q.id)
                // A question added after this attempt was never put to the student.
                if (!answer) return null
                const chosen = q.options.find((o) => o.id === answer.optionId)
                return (
                  <li key={q.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                    {answer.isCorrect
                      ? <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      : <XCircle className="size-3.5 text-rose-500 shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <p className="font-medium">{n + 1}. {q.question}</p>
                      <p className="text-muted-foreground">
                        {!answer.optionId
                          ? "Not answered"
                          : chosen
                            ? `Answered: ${chosen.text || `option ${q.options.indexOf(chosen) + 1}`}`
                            : "Answered with an option that has since been removed"}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      ))}

      <Button
        variant="outline" size="sm"
        className="self-start h-7 text-xs gap-1.5"
        disabled={resetting}
        onClick={reset}
        title="Delete this student's attempts so they can sit the test again"
      >
        {resetting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        Reset attempts
      </Button>
    </div>
  )
}

// ─── QuizResults ──────────────────────────────────────────────────────────────

/**
 * How the course's students did on one test: the headline numbers, every
 * student's best score, and which questions the class got wrong most.
 */
export function QuizResults({ lessonId, questions }: { lessonId: string; questions: ResultsQuestion[] }) {
  const { data, loading, refetch } = useFetch<ResultsData>(`/api/tutor/lessons/${lessonId}/results`, {
    errorMessage: "Could not load the results",
  })
  const [openStudent, setOpenStudent] = useState<string | null>(null)

  if (!data) {
    return loading
      ? <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
      : <p className="text-sm text-muted-foreground">The results could not be loaded.</p>
  }

  const { summary, students, test } = data

  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground">There are no students on this course yet.</p>
  }

  const hardestFirst = data.questions
    // Numbered as on the Questions tab, whatever order they are listed in here.
    .map((q, i) => ({ ...q, number: i + 1 }))
    .filter((q) => q.answered > 0)
    .sort((a, b) => a.correct / a.answered - b.correct / b.answered)

  return (
    <div className="flex flex-col gap-6">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Taken", value: `${summary.taken} of ${summary.students}` },
          { label: "Passed", value: `${summary.passed} of ${summary.students}` },
          { label: "Average score", value: summary.averageScore === null ? "—" : `${summary.averageScore}%` },
          { label: "Pass mark", value: `${test.passMark}%` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border bg-muted/20 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-lg font-black mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Students */}
      <div className="rounded-xl border overflow-hidden">
        <div className={`hidden sm:grid ${COLUMNS} items-center gap-3 px-4 py-2 border-b bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground`}>
          <span>Student</span>
          <span>Best</span>
          <span>Latest</span>
          <span>Attempts</span>
          <span>Last attempt</span>
          <span>Result</span>
          <span className="sr-only">Details</span>
        </div>

        <div className="divide-y">
          {students.map((student) => {
            const expandable = data.seesAnswers && student.attempts > 0
            const isOpen = expandable && openStudent === student.id
            return (
              <div key={student.id}>
                <div
                  className={cn(`grid ${COLUMNS} items-center gap-3 px-4 py-2.5`, expandable && "cursor-pointer hover:bg-muted/20")}
                  onClick={expandable ? () => setOpenStudent(isOpen ? null : student.id) : undefined}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="size-7 shrink-0">
                      {student.avatarUrl && <AvatarImage src={student.avatarUrl} alt={student.name} />}
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold text-[10px]">
                        {initials(student.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{student.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                    </div>
                  </div>

                  <span className="hidden sm:block text-sm font-semibold">
                    {student.bestScore === null ? "—" : `${student.bestScore}%`}
                  </span>
                  <span className="hidden sm:block text-xs">
                    {student.latestScore === null ? "—" : `${student.latestScore}%`}
                  </span>
                  <span className="hidden sm:block text-xs">
                    {test.maxAttempts === null ? student.attempts : `${student.attempts} of ${test.maxAttempts}`}
                  </span>
                  <span className="hidden sm:block text-xs text-muted-foreground">
                    {student.lastAttemptAt ? shortDate(student.lastAttemptAt) : "—"}
                  </span>

                  <Badge variant="outline" className={cn("text-[10px] justify-self-start", STATUS[student.status].className)}>
                    {STATUS[student.status].label}
                    {/* On a phone the score columns are hidden, so it rides along here. */}
                    {student.bestScore !== null && <span className="sm:hidden ml-1">· {student.bestScore}%</span>}
                  </Badge>

                  {expandable ? (
                    <Button
                      variant="ghost" size="icon" className="size-7"
                      aria-label={`${isOpen ? "Hide" : "Show"} ${student.name}'s attempts`}
                      aria-expanded={isOpen}
                      onClick={(e) => { e.stopPropagation(); setOpenStudent(isOpen ? null : student.id) }}
                    >
                      {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </Button>
                  ) : <span />}
                </div>

                {isOpen && (
                  <div className="bg-muted/20 pt-2">
                    <StudentAttempts
                      lessonId={lessonId}
                      student={student}
                      questions={questions}
                      onReset={() => { setOpenStudent(null); void refetch() }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Question by question */}
      {hardestFirst.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Question by question</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              How often each question was answered correctly, over all {summary.attempts} attempt{summary.attempts !== 1 ? "s" : ""} — hardest first.
            </p>
          </div>
          <div className="rounded-xl border divide-y">
            {hardestFirst.map((q) => {
              const pct = Math.round((q.correct / q.answered) * 100)
              return (
                <div key={q.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-4 px-4 py-2.5">
                  <p className="text-sm truncate" title={q.question}>{q.number}. {q.question}</p>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs">{pct}% correct <span className="text-muted-foreground">({q.correct}/{q.answered})</span></span>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
