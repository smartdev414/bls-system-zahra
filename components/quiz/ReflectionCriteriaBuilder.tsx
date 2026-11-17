"use client"

import { Fragment, useState } from "react"
import { ArrowDown, ArrowUp, FileText, ListChecks, Loader2, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { LEVEL_6_TEMPLATE } from "@/lib/reflection-templates"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { QuestionDraft } from "./QuizBuilder"

// A self-reflection's criteria: the whole template, typed (or pasted) once,
// with a tick on each one students write about in this assessment. Unticked
// ones are shown to students greyed out. Saved with the test's "Save
// changes", like questions are; deleting and moving a saved one is immediate.

function blankCriterion(question = "", section?: string): QuestionDraft {
  return {
    uid: crypto.randomUUID(), question, section, type: "WRITTEN", options: [], locked: false,
    isOpen: true, isSaving: false, error: null, dirty: true,
  }
}

export function ReflectionCriteriaBuilder({ testId, criteria, onChange }: {
  testId: string
  criteria: QuestionDraft[]
  onChange: (update: (current: QuestionDraft[]) => QuestionDraft[]) => void
}) {
  const [pasting, setPasting] = useState(criteria.length === 0)
  const [pasted, setPasted] = useState("")
  const [orderError, setOrderError] = useState<string | null>(null)

  const patch = (uid: string, change: Partial<QuestionDraft>) =>
    onChange((current) => current.map((c) => (c.uid === uid ? { ...c, ...change, dirty: true, error: null } : c)))

  const picked = criteria.filter((c) => !c.locked && c.question.trim()).length
  const total = criteria.filter((c) => c.question.trim()).length

  function addPasted() {
    // One criterion a line; blank lines and bullet marks are dropped. A line
    // starting with # is a heading for the criteria after it.
    const lines = pasted.split(/\r?\n/).map((l) => l.replace(/^\s*[-•*]\s+/, "").trim()).filter(Boolean)
    let section = criteria.at(-1)?.section
    const added: QuestionDraft[] = []
    for (const line of lines) {
      if (line.startsWith("#")) section = line.replace(/^#+\s*/, "") || undefined
      else added.push(blankCriterion(line, section))
    }
    if (added.length === 0) return
    onChange((current) => [...current.filter((c) => c.id || c.question.trim()), ...added])
    setPasted("")
    setPasting(false)
  }

  function useTemplate() {
    onChange((current) => [
      ...current.filter((c) => c.id || c.question.trim()),
      ...LEVEL_6_TEMPLATE.map((t) => blankCriterion(t.question, t.section)),
    ])
    setPasting(false)
  }

  /** Renames the heading of the run of criteria starting at `from`. */
  function renameSection(from: number, title: string) {
    const old = criteria[from].section
    const uids = new Set<string>()
    for (let i = from; i < criteria.length && criteria[i].section === old; i++) uids.add(criteria[i].uid)
    onChange((current) => current.map((c) => (uids.has(c.uid) ? { ...c, section: title, dirty: true } : c)))
  }

  function setAll(locked: boolean) {
    onChange((current) => current.map((c) => (!!c.locked === locked ? c : { ...c, locked, dirty: true })))
  }

  async function remove(c: QuestionDraft) {
    if (!c.id) {
      onChange((current) => current.filter((x) => x.uid !== c.uid))
      return
    }
    if (!window.confirm("Delete this criterion? Anything students have written for it is no longer shown.")) return
    patch(c.uid, { isSaving: true })
    try {
      const res = await fetch(`/api/tests/${testId}/questions/${c.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      onChange((current) => current.filter((x) => x.uid !== c.uid))
    } catch {
      onChange((current) => current.map((x) => (x.uid === c.uid ? { ...x, isSaving: false, error: "Could not delete this criterion" } : x)))
    }
  }

  async function move(from: number, to: number) {
    const next = [...criteria]
    ;[next[from], next[to]] = [next[to], next[from]]
    const swap = (list: QuestionDraft[]) => {
      const i = list.findIndex((c) => c.uid === criteria[from].uid)
      const j = list.findIndex((c) => c.uid === criteria[to].uid)
      if (i < 0 || j < 0) return list
      const copy = [...list]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    }
    onChange(swap)
    setOrderError(null)
    const orderedIds = next.flatMap((c) => (c.id ? [c.id] : []))
    if (orderedIds.length < 2) return
    try {
      const res = await fetch(`/api/tests/${testId}/questions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      })
      if (!res.ok) throw new Error()
    } catch {
      onChange(swap)
      setOrderError("Could not save the new order. Please try again.")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListChecks className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Criteria</h3>
        <Badge variant="outline" className="text-[0.625rem]">{picked} of {total} for this assessment</Badge>
        {total > 1 && (
          <div className="ml-auto flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll(false)}>Tick all</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)}>Untick all</Button>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Add every criterion from your self-reflection template, then <span className="font-medium text-foreground">tick the ones students must write about</span>{" "}
        in this assessment. Students see the others greyed out and can&apos;t write in them, and they can&apos;t send it to you until every ticked one is filled in.
        For the next assessment, make a copy of this test and change the ticks.
      </p>

      {criteria.length > 0 && (
        <ol className="flex flex-col gap-2">
          {criteria.map((c, i) => (
            <Fragment key={c.uid}>
            {c.section != null && (i === 0 || criteria[i - 1].section !== c.section) && (
              <li role="presentation" className="pt-3 first:pt-0">
                <Input
                  aria-label="Section heading"
                  value={c.section ?? ""}
                  onChange={(e) => renameSection(i, e.target.value)}
                  className="h-9 border-transparent bg-transparent px-1 text-sm font-bold shadow-none hover:border-input focus:border-input"
                />
              </li>
            )}
            <li className={cn(
              "flex items-start gap-3 rounded-xl border bg-background p-3",
              c.locked && "bg-muted/30",
              c.error && "border-destructive",
            )}>
              <Checkbox
                className="mt-2.5"
                checked={!c.locked}
                onCheckedChange={(v) => patch(c.uid, { locked: v !== true })}
                aria-label={c.locked ? "Not in this assessment — tick to include" : "In this assessment — untick to leave out"}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Textarea
                  aria-label={`Criterion ${i + 1}`}
                  rows={1}
                  value={c.question}
                  placeholder="e.g. 1.1 Describe how you prepared for the assessment"
                  onChange={(e) => patch(c.uid, { question: e.target.value })}
                  className={cn("min-h-10 resize-none text-sm field-sizing-content", c.locked && "text-muted-foreground")}
                />
                <p className="text-xs text-muted-foreground">
                  {c.locked ? "Not in this assessment — students can't write here" : "Students write about this"}
                  {(!c.id || c.dirty) && c.question.trim() && <span className="text-amber-700"> · not saved</span>}
                </p>
                {c.error && <p className="text-xs text-destructive">{c.error}</p>}
              </div>
              <div className="flex shrink-0 items-center">
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Move up" disabled={i === 0} onClick={() => void move(i, i - 1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Move down" disabled={i === criteria.length - 1} onClick={() => void move(i, i + 1)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label="Delete criterion"
                  disabled={c.isSaving} onClick={() => void remove(c)}>
                  {c.isSaving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                </Button>
              </div>
            </li>
            </Fragment>
          ))}
        </ol>
      )}
      {orderError && <p className="text-xs text-destructive">{orderError}</p>}

      {pasting ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
          {criteria.length === 0 && (
            <Button type="button" className="self-start" onClick={useTemplate}>
              <FileText className="mr-1.5 size-4" /> Use the Level 6 self-reflection template
            </Button>
          )}
          <p className="text-sm font-medium">{criteria.length === 0 ? "Or paste" : "Paste"} your own criteria — one per line</p>
          <p className="-mt-1 text-xs text-muted-foreground">Start a line with # to make it a section heading, e.g. # 1.1 Initiate and develop discourse</p>
          <Textarea
            rows={6}
            autoFocus={criteria.length > 0}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"1.1 Describe how you prepared for the assessment\n1.2 Explain what went well\n2.1 Identify what you would do differently"}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={addPasted} disabled={!pasted.trim()}>
              <Plus className="mr-1.5 size-4" /> Add {(() => { const n = pasted.split(/\r?\n/).filter((l) => l.trim()).length; return n > 1 ? `${n} criteria` : "criterion" })()}
            </Button>
            {criteria.length > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => { setPasting(false); setPasted("") }}>Cancel</Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onChange((current) => [...current, blankCriterion("", current.at(-1)?.section)])}>
            <Plus className="mr-1.5 size-4" /> Add a criterion
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPasting(true)}>Paste several</Button>
        </div>
      )}
    </div>
  )
}
