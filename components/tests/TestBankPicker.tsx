"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Circle, FlaskConical, Loader2, Plus, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFetch } from "@/hooks/use-fetch"
import { useTestsBase } from "@/hooks/use-tests-base"
import { COURSE_LEVELS, levelColor, levelLabel, type CourseLevel } from "@/lib/levels"
import { TEST_KIND_INFO, isSignTest, type TestKind } from "@/lib/quiz"
import { cn } from "@/lib/utils"

export type BankTest = {
  id: string
  title: string
  level: CourseLevel | null
  testKind: TestKind
  questionCount: number
  courses: Array<{ id: string; title: string }>
  createdByName: string | null
}

/** "12 questions · in 2 courses" */
export function bankTestFacts(test: Pick<BankTest, "testKind" | "questionCount" | "courses">): string {
  const count = test.testKind === "REFLECTION"
    ? `${test.questionCount} ${test.questionCount === 1 ? "criterion" : "criteria"}`
    : `${test.questionCount} ${isSignTest(test.testKind) ? "sign" : "question"}${test.questionCount !== 1 ? "s" : ""}`
  return [
    TEST_KIND_INFO[test.testKind].label,
    count,
    test.courses.length > 0 ? `in ${test.courses.length} course${test.courses.length !== 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(" · ")
}

/**
 * Choose a test from the test bank — to put it in a course. The list is
 * searched as you type; a test can also be made from here.
 */
export function TestBankPicker({ value, onChange, createHref, kind }: {
  value: string | null
  onChange: (test: BankTest) => void
  /** Where "Create a new test" goes — with the course to put it in, when there is one. */
  createHref?: string
  /** Only tests of this kind — a league's words are a fingerspelling test. */
  kind?: TestKind
}) {
  const testsBase = useTestsBase()
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [level, setLevel] = useState<CourseLevel | "">("")

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const params = new URLSearchParams()
  if (search) params.set("q", search)
  if (level) params.set("level", level)
  if (kind) params.set("kind", kind)
  const { data, loading } = useFetch<{ tests: BankTest[] }>(`/api/tests?${params}`, {
    errorMessage: "Could not load the tests",
  })
  const tests = data?.tests ?? []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search tests" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as CourseLevel | "")}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter by level"
        >
          <option value="">All levels</option>
          {COURSE_LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
        </select>
      </div>

      <div role="radiogroup" aria-label="Tests" className="flex flex-col gap-2 max-h-[45vh] overflow-y-auto -mx-1 px-1">
        {loading && !data ? (
          <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : tests.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <FlaskConical className="size-8" />
            {search || level
              ? "No tests match your search."
              : kind ? `There are no ${TEST_KIND_INFO[kind].label.toLowerCase()} tests yet.` : "There are no tests yet."}
          </div>
        ) : (
          tests.map((test) => {
            const selected = test.id === value
            return (
              <button
                key={test.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(test)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
                )}
              >
                {selected
                  ? <CheckCircle2 className="size-5 shrink-0 text-primary" />
                  : <Circle className="size-5 shrink-0 text-muted-foreground" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{test.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {bankTestFacts(test)}{test.createdByName ? ` · by ${test.createdByName}` : ""}
                  </p>
                </div>
                {test.level && (
                  <Badge variant="outline" className={cn("shrink-0 text-[0.625rem]", levelColor[test.level])}>{levelLabel[test.level]}</Badge>
                )}
              </button>
            )
          })
        )}
      </div>

      <Button asChild variant="outline" size="sm" className="self-start">
        <Link href={createHref ?? `${testsBase}/new`}><Plus className="size-4 mr-1.5" /> Create a new test</Link>
      </Button>
    </div>
  )
}
