"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BookOpen, Copy, FlaskConical, Loader2, MoreHorizontal, Plus, Search, Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Pagination } from "@/components/ui/pagination"
import { AddToCourseDialog } from "@/components/tests/AddToCourseDialog"
import { bankTestFacts, type BankTest } from "@/components/tests/TestBankPicker"
import { useTutorAccess } from "@/components/tutor-access-provider"
import { useFetch } from "@/hooks/use-fetch"
import { useTestsBase } from "@/hooks/use-tests-base"
import { COURSE_LEVELS, levelColor, levelLabel, type CourseLevel } from "@/lib/levels"
import { TEST_KINDS, TEST_KIND_INFO, type TestKind } from "@/lib/quiz"
import { cn } from "@/lib/utils"

type TestRow = BankTest & {
  description: string | null
  passMark: number
  updatedAt: string
  canEdit: boolean
}

const PAGE_SIZE = 12

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

// The test bank: every test the school has made, to build once and put in any
// course. Shared by the tutor and admin portals.
export default function TestsPage() {
  const router = useRouter()
  const testsBase = useTestsBase()
  // A teacher an admin keeps to view only browses the bank but changes nothing.
  const canChange = useTutorAccess().tests
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [level, setLevel] = useState<CourseLevel | "">("")
  const [kind, setKind] = useState<TestKind | "">("")
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const [placing, setPlacing] = useState<TestRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [query])

  const params = new URLSearchParams()
  if (search) params.set("q", search)
  if (level) params.set("level", level)
  if (kind) params.set("kind", kind)
  if (mine) params.set("mine", "1")
  const { data, loading, refetch } = useFetch<{ tests: TestRow[] }>(`/api/tests?${params}`, {
    errorMessage: "Could not load the tests",
  })

  const tests = data?.tests ?? []
  const totalPages = Math.ceil(tests.length / PAGE_SIZE)
  const shown = tests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtered = !!(search || level || kind || mine)

  async function duplicate(test: TestRow) {
    setBusy(test.id)
    try {
      const res = await fetch(`/api/tests/${test.id}/duplicate`, { method: "POST" })
      const d = await res.json().catch(() => ({})) as { test?: { id: string }; message?: string }
      if (!res.ok || !d.test) throw new Error(d.message ?? "Could not copy the test")
      toast.success("Copied — this copy is yours to change")
      router.push(`${testsBase}/${d.test.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not copy the test")
      setBusy(null)
    }
  }

  async function remove(test: TestRow) {
    const where = test.courses.length > 0
      ? `\n\nIt is in ${test.courses.length} course${test.courses.length !== 1 ? "s" : ""} (${test.courses.map((c) => c.title).join(", ")}). It will be taken out of them, and the students' results there are deleted.`
      : ""
    if (!window.confirm(`Delete "${test.title}"?${where}`)) return
    setBusy(test.id)
    try {
      const res = await fetch(`/api/tests/${test.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Test deleted")
      await refetch()
    } catch {
      toast.error("Could not delete the test")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <FlaskConical className="size-6 text-primary" />
            Tests
          </h1>
          <p className="text-muted-foreground mt-1">Make a test once, then add it to any course.</p>
          {!canChange && (
            <p className="text-xs text-muted-foreground mt-1">View only — ask an admin if you need to change tests.</p>
          )}
        </div>
        {canChange && (
          <Button asChild>
            <Link href={`${testsBase}/new`}><Plus className="size-4 mr-1.5" /> New test</Link>
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search tests" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <select value={level} onChange={(e) => { setLevel(e.target.value as CourseLevel | ""); setPage(1) }} className={cn(selectClass, "flex-1 sm:flex-none")} aria-label="Filter by level">
            <option value="">All levels</option>
            {COURSE_LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
          </select>
          <select value={kind} onChange={(e) => { setKind(e.target.value as TestKind | ""); setPage(1) }} className={cn(selectClass, "flex-1 sm:flex-none")} aria-label="Filter by kind">
            <option value="">All kinds</option>
            {TEST_KINDS.map((k) => <option key={k} value={k}>{TEST_KIND_INFO[k].label}</option>)}
          </select>
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Whose tests">
            {[{ v: false, label: "All" }, { v: true, label: "Mine" }].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={mine === o.v}
                onClick={() => { setMine(o.v); setPage(1) }}
                className={cn(
                  "px-3 text-sm rounded-[5px] transition-colors",
                  mine === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center min-h-60">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : tests.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-14 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-muted p-6">
              <FlaskConical className="size-10 text-muted-foreground" />
            </div>
            {filtered ? (
              <p className="font-semibold">No tests match your search.</p>
            ) : (
              <>
                <div>
                  <p className="font-semibold text-lg">No tests yet</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    Make a test, add questions or signs from the dictionary, then put it in as many courses as you like.
                  </p>
                </div>
                {canChange && (
                  <Button asChild>
                    <Link href={`${testsBase}/new`}><Plus className="size-4 mr-1.5" /> Make your first test</Link>
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {shown.map((test) => (
              <Card key={test.id} className={cn("shadow-sm transition-colors hover:border-primary/40", busy === test.id && "opacity-60")}>
                <CardContent className="p-4 flex flex-col gap-3 h-full">
                  <div className="flex items-start gap-3">
                    <Link href={`${testsBase}/${test.id}`} className="flex-1 min-w-0 group">
                      <p className="font-semibold leading-snug group-hover:text-primary break-words">{test.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {bankTestFacts(test)} · Pass {test.passMark}%
                      </p>
                      {test.description && (
                        <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{test.description}</p>
                      )}
                    </Link>
                    <div className="flex items-center gap-1 shrink-0">
                      {test.level && (
                        <Badge variant="outline" className={cn("text-[10px]", levelColor[test.level])}>{levelLabel[test.level]}</Badge>
                      )}
                      {canChange && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label={`More for ${test.title}`} disabled={busy === test.id}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setPlacing(test)}>
                              <BookOpen className="size-4" /> Add to a course
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => duplicate(test)}>
                              <Copy className="size-4" /> Make a copy
                            </DropdownMenuItem>
                            {test.canEdit && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => remove(test)}>
                                  <Trash2 className="size-4" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2">
                    <p className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
                      {test.courses.length > 0
                        ? test.courses.map((c) => c.title).join(", ")
                        : "Not in a course yet"}
                      {test.createdByName && ` · by ${test.createdByName}`}
                    </p>
                    <div className="flex shrink-0 gap-2">
                      {canChange && test.courses.length === 0 && (
                        <Button size="sm" variant="outline" onClick={() => setPlacing(test)}>Add to course</Button>
                      )}
                      <Button asChild size="sm" variant={canChange && test.canEdit ? "default" : "outline"}>
                        <Link href={`${testsBase}/${test.id}`}>{canChange && test.canEdit ? "Edit" : "View"}</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
        </>
      )}

      {placing && (
        <AddToCourseDialog
          test={placing}
          open
          onOpenChange={(open) => { if (!open) setPlacing(null) }}
          onAdded={() => void refetch()}
        />
      )}
    </div>
  )
}
