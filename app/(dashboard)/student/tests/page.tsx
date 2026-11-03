"use client"

import { useState } from "react"
import Link from "next/link"
import {
  FlaskConical, CheckCircle2, BookOpen, XCircle,
  Loader2, ChevronRight, Trophy,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useFetch } from "@/hooks/use-fetch"
import { Pagination } from "@/components/ui/pagination"
import { TEST_KIND_INFO, VOCABULARY_MODE_INFO, isSignTest, signsWords, type TestKind, type VocabularyMode } from "@/lib/quiz"

// ─── Types ────────────────────────────────────────────────────────────────────

type TestItem = {
  id: string
  title: string
  description: string | null
  courseTitle: string
  sectionTitle: string
  tutorName: string
  kind: TestKind
  vocabularyMode: VocabularyMode
  answerSeconds: number | null
  questionCount: number
  passMark: number
  maxAttempts: number | null
  attempts: number
  attemptsLeft: number | null
  bestScore: number | null
  lastAttemptAt: string | null
  isCompleted: boolean
  status: "PASSED" | "FAILED" | "IN_PROGRESS" | "NOT_STARTED"
  /** Self-reflections: where the document is; null = not started. */
  reflectionStatus?: "DRAFT" | "SUBMITTED" | "RETURNED" | "COMPLETE" | null
}

type TestsData = {
  tests: TestItem[]
  stats: { totalTests: number; passedTests: number; averageScore: number | null }
}

const STATUS: Record<TestItem["status"], { label: string; className: string }> = {
  PASSED: { label: "Passed", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  FAILED: { label: "Not passed", className: "bg-rose-100 text-rose-700 border-rose-200" },
  IN_PROGRESS: { label: "Not passed yet", className: "text-amber-700 bg-amber-50 border-amber-200" },
  NOT_STARTED: { label: "To do", className: "text-amber-700 bg-amber-50 border-amber-200" },
}

/** Self-reflections: where the student's document is, instead of a pass or fail. */
const REFLECTION_STATUS: Record<"NONE" | "DRAFT" | "SUBMITTED" | "RETURNED" | "COMPLETE", { label: string; className: string; action: string }> = {
  NONE: { label: "To do", className: STATUS.NOT_STARTED.className, action: "Start writing" },
  DRAFT: { label: "Not sent yet", className: STATUS.NOT_STARTED.className, action: "Continue" },
  SUBMITTED: { label: "With your teacher", className: "bg-sky-50 text-sky-800 border-sky-200", action: "Open" },
  RETURNED: { label: "Changes needed", className: "text-amber-700 bg-amber-50 border-amber-200", action: "See feedback" },
  COMPLETE: { label: "Complete", className: STATUS.PASSED.className, action: "Open" },
}
const reflectionInfo = (test: TestItem) => REFLECTION_STATUS[test.reflectionStatus ?? "NONE"]

/** "Vocabulary · 12 signs · 10 seconds each · Pass mark 70% · 1 of 3 attempts used" */
function testFacts(test: TestItem) {
  if (test.kind === "REFLECTION") {
    return `${TEST_KIND_INFO.REFLECTION.label} · ${test.questionCount} criteri${test.questionCount !== 1 ? "a" : "on"}`
  }
  const noun = isSignTest(test.kind) ? "sign" : "question"
  // Signing the words is not against the clock.
  const signOnly = test.vocabularyMode === "SIGN_IT"
  return [
    test.kind !== "STANDARD" ? TEST_KIND_INFO[test.kind].label : null,
    signsWords({ testKind: test.kind, vocabularyMode: test.vocabularyMode }) ? VOCABULARY_MODE_INFO[test.vocabularyMode].label : null,
    `${test.questionCount} ${noun}${test.questionCount !== 1 ? "s" : ""}`,
    isSignTest(test.kind) && !(test.kind === "VOCABULARY" && signOnly) && test.answerSeconds ? `${test.answerSeconds} seconds each` : null,
    `Pass mark ${test.passMark}%`,
    test.maxAttempts === null
      ? test.attempts > 0 ? `${test.attempts} attempt${test.attempts !== 1 ? "s" : ""}` : null
      : `${test.attempts} of ${test.maxAttempts} attempts used`,
  ].filter(Boolean).join(" · ")
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10

type Filter = "ALL" | "TODO" | "PASSED" | "FAILED"

const FILTERS: Array<{ value: Filter; label: string; matches: (test: TestItem) => boolean }> = [
  { value: "ALL", label: "All", matches: () => true },
  { value: "TODO", label: "To do", matches: (t) => t.status === "NOT_STARTED" || t.status === "IN_PROGRESS" },
  { value: "PASSED", label: "Passed", matches: (t) => t.status === "PASSED" },
  { value: "FAILED", label: "Not passed", matches: (t) => t.status === "FAILED" },
]

export default function TestsPage() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<Filter>("ALL")

  const { data, loading, refetch } = useFetch<TestsData>("/api/student/tests", {
    errorMessage: "Could not load tests",
  })

  const passRate = data
    ? data.stats.totalTests > 0
      ? Math.round((data.stats.passedTests / data.stats.totalTests) * 100)
      : 0
    : 0

  const allTests = data?.tests ?? []
  // "All" is always offered; the others only when there is something behind them.
  const filters = FILTERS
    .map((f) => ({ ...f, count: allTests.filter(f.matches).length }))
    .filter((f) => f.value === "ALL" || f.count > 0)
  const shownTests = allTests.filter((filters.find((f) => f.value === filter) ?? FILTERS[0]).matches)
  const totalPages = Math.ceil(shownTests.length / PAGE_SIZE)
  const pagedTests = shownTests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <FlaskConical className="size-6 text-primary" />
          Tests
        </h1>
        <p className="text-muted-foreground mt-1">The tests on your courses, and how you did.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : !data ? (
        // Not the same as having no tests — say so, and offer another go.
        <Card className="shadow-sm">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <p className="font-semibold">Your tests could not be loaded</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats */}
          {data && data.stats.totalTests > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {[
                { label: "Total Tests", value: data.stats.totalTests, icon: FlaskConical },
                { label: "Passed", value: data.stats.passedTests, icon: CheckCircle2 },
                {
                  label: "Average Score",
                  value: data.stats.averageScore === null ? "—" : `${data.stats.averageScore}%`,
                  icon: Trophy,
                },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label} className="shadow-sm">
                  <CardContent className="p-3 sm:p-5 flex flex-col gap-1.5 sm:gap-2">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <Icon className="size-4 text-primary shrink-0 hidden sm:block" />
                      <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    </div>
                    <p className="text-2xl sm:text-3xl font-black">{value}</p>
                    {label === "Passed" && (
                      <Progress value={passRate} className="h-1.5" />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Test list */}
          {allTests.length > 0 ? (
            <div className="flex flex-col gap-4">
              {filters.length > 2 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Show tests">
                  {filters.map((f) => (
                    <Button
                      key={f.value}
                      size="sm"
                      variant={filter === f.value ? "default" : "outline"}
                      aria-pressed={filter === f.value}
                      onClick={() => { setFilter(f.value); setPage(1) }}
                    >
                      {f.label} ({f.count})
                    </Button>
                  ))}
                </div>
              )}
              {pagedTests.map((test) => (
                <Card key={test.id} className="shadow-sm overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`rounded-xl p-3 shrink-0 ${test.isCompleted ? "bg-emerald-50" : test.status === "FAILED" ? "bg-rose-50" : "bg-primary/10"}`}>
                          {test.isCompleted ? (
                            <CheckCircle2 className="size-5 text-emerald-600" />
                          ) : test.status === "FAILED" ? (
                            <XCircle className="size-5 text-rose-500" />
                          ) : (
                            <FlaskConical className="size-5 text-primary" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base leading-snug">{test.title}</CardTitle>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <BookOpen className="size-3" />
                            <span>{test.courseTitle} · {test.sectionTitle}</span>
                            <span>·</span>
                            <span>by {test.tutorName}</span>
                          </div>
                          {test.description && (
                            <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{test.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <Badge variant="outline" className={test.kind === "REFLECTION" ? reflectionInfo(test).className : STATUS[test.status].className}>
                          {test.kind === "REFLECTION" ? reflectionInfo(test).label : STATUS[test.status].label}
                        </Badge>
                        {test.bestScore !== null && (
                          <p className="text-sm font-black" title="Your best score">{test.bestScore}%</p>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <p className="text-xs text-muted-foreground">{testFacts(test)}</p>
                      {test.questionCount === 0 ? (
                        <span className="text-xs text-muted-foreground">Questions coming soon</span>
                      ) : (
                        <Button asChild size="sm" variant={test.isCompleted || test.status === "FAILED" ? "outline" : "default"}>
                          <Link href={`/student/lessons/${test.id}`}>
                            {test.kind === "REFLECTION"
                              ? reflectionInfo(test).action
                              : test.isCompleted || test.status === "FAILED"
                              ? "Review"
                              : test.attempts > 0 ? "Try Again" : "Start Test"}
                            <span className="sr-only">: {test.title}</span>
                            <ChevronRight className="size-4 ml-1" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {totalPages > 1 && (
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="mt-2" />
              )}
            </div>
          ) : (
            <Card className="shadow-sm">
              <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
                <div className="rounded-full bg-muted p-6">
                  <FlaskConical className="size-10 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-lg">No tests available yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Tests will appear here when they are added to your course.
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link href="/student/lessons">Browse Lessons</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
