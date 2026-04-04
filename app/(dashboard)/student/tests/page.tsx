"use client"

import { useState } from "react"
import Link from "next/link"
import {
  FlaskConical, CheckCircle2, Clock, BookOpen,
  Loader2, ChevronRight, Trophy,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useFetch } from "@/hooks/use-fetch"
import { Pagination } from "@/components/ui/pagination"

// ─── Types ────────────────────────────────────────────────────────────────────

type TestItem = {
  id: string
  title: string
  description: string | null
  courseTitle: string
  tutorName: string
  isCompleted: boolean
  enrollmentId: string
}

type TestsData = {
  tests: TestItem[]
  stats: { totalTests: number; passedTests: number }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10

export default function TestsPage() {
  const [page, setPage] = useState(1)

  const { data, loading } = useFetch<TestsData>("/api/student/tests", {
    errorMessage: "Could not load tests",
  })

  const passRate = data
    ? data.stats.totalTests > 0
      ? Math.round((data.stats.passedTests / data.stats.totalTests) * 100)
      : 0
    : 0

  const allTests = data?.tests ?? []
  const totalPages = Math.ceil(allTests.length / PAGE_SIZE)
  const pagedTests = allTests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <FlaskConical className="size-6 text-primary" />
          Practice Tests
        </h1>
        <p className="text-muted-foreground mt-1">Test your BSL knowledge with practice exams.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Stats */}
          {data && data.stats.totalTests > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Total Tests", value: data.stats.totalTests, icon: FlaskConical },
                { label: "Passed", value: data.stats.passedTests, icon: CheckCircle2 },
                { label: "Pass Rate", value: `${passRate}%`, icon: Trophy },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label} className="shadow-sm">
                  <CardContent className="p-5 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-primary" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    </div>
                    <p className="text-3xl font-black">{value}</p>
                    {label === "Pass Rate" && (
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
              {pagedTests.map((test) => (
                <Card key={test.id} className={`shadow-sm overflow-hidden ${test.isCompleted ? "opacity-80" : ""}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`rounded-xl p-3 shrink-0 ${test.isCompleted ? "bg-emerald-50" : "bg-primary/10"}`}>
                          {test.isCompleted ? (
                            <CheckCircle2 className="size-5 text-emerald-600" />
                          ) : (
                            <FlaskConical className="size-5 text-primary" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base leading-snug">{test.title}</CardTitle>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <BookOpen className="size-3" />
                            <span>{test.courseTitle}</span>
                            <span>·</span>
                            <span>by {test.tutorName}</span>
                          </div>
                          {test.description && (
                            <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{test.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {test.isCompleted ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" variant="outline">
                            Passed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-700 bg-amber-50 border-amber-200">
                            Pending
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        <span>Practice test</span>
                      </div>
                      <Button asChild size="sm" variant={test.isCompleted ? "outline" : "default"}>
                        <Link href={`/student/lessons/${test.id}`}>
                          {test.isCompleted ? "Review" : "Start Test"}
                          <ChevronRight className="size-4 ml-1" />
                        </Link>
                      </Button>
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
                    Tests will appear here when your tutor adds quiz lessons to your course.
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
