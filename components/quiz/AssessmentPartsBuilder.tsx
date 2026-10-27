"use client"

import { Clapperboard, Loader2, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DEFAULT_PART_MARKS, MAX_PART_MARKS, marksLabel } from "@/lib/quiz"
import { cn } from "@/lib/utils"
import { isBlankQuestion, type QuestionDraft } from "./QuizBuilder"
import { StoryVideoField } from "./TestKindFields"

// The parts of an assessment, in the order students sit them. Each part is
// three things, filled in from top to bottom as students meet them: the
// questions (signed), the part of the story, and the answer sheet they are
// marked against. Saved with the test's "Save changes", like questions are.

function blankPart(): QuestionDraft {
  return {
    uid: crypto.randomUUID(), question: "", type: "WRITTEN", options: [], maxMarks: DEFAULT_PART_MARKS,
    isOpen: true, isSaving: false, error: null,
  }
}

export function AssessmentPartsBuilder({ testId, parts, onChange }: {
  testId: string
  parts: QuestionDraft[]
  onChange: (update: (current: QuestionDraft[]) => QuestionDraft[]) => void
}) {
  const patch = (uid: string, change: Partial<QuestionDraft>) =>
    onChange((current) => current.map((p) => (p.uid === uid ? { ...p, ...change, dirty: true, error: null } : p)))

  async function remove(part: QuestionDraft, n: number) {
    if (!part.id) {
      if (!isBlankQuestion(part) && !window.confirm(`Delete part ${n}?`)) return
      onChange((current) => current.filter((p) => p.uid !== part.uid))
      return
    }
    if (!window.confirm(`Delete part ${n}? Answers students have already filmed for it are removed too.`)) return
    onChange((current) => current.map((p) => (p.uid === part.uid ? { ...p, isSaving: true } : p)))
    const res = await fetch(`/api/tests/${testId}/questions/${part.id}`, { method: "DELETE" }).catch(() => null)
    if (res?.ok) onChange((current) => current.filter((p) => p.uid !== part.uid))
    else onChange((current) => current.map((p) => (p.uid === part.uid ? { ...p, isSaving: false, error: "Could not delete this part" } : p)))
  }

  const total = parts.reduce((sum, p) => sum + (p.maxMarks ?? DEFAULT_PART_MARKS), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Clapperboard className="size-4 text-primary" />
        <h3 className="font-semibold text-sm">Parts</h3>
        <Badge variant="outline" className="text-[10px]">
          {parts.length} part{parts.length !== 1 ? "s" : ""}{parts.length > 0 && ` · ${marksLabel(total)}`}
        </Badge>
      </div>

      {parts.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 flex flex-col items-center gap-2 text-center px-4">
          <Clapperboard className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-md">
            Add the first part. For each part, students watch its questions, then the part, then film their answers.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          In each part, students watch <b>1</b> the questions, then <b>2</b> the part of the story, then film their answers.
          The <b>3</b> answer sheet is for marking — it is only shown once the answers are filmed.
        </p>
      )}

      {parts.map((part, i) => (
        <div key={part.uid} className={cn("rounded-xl border bg-background p-4 flex flex-col gap-5", part.error && "border-destructive")}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Part {i + 1}</p>
            <div className="flex items-center gap-2">
              {part.id && !part.dirty
                ? <Badge variant="outline" className="text-[10px]">Saved</Badge>
                : <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">Not saved</Badge>}
              <Button
                type="button" size="icon" variant="ghost" className="size-8 text-muted-foreground"
                aria-label={`Delete part ${i + 1}`} title="Delete this part"
                disabled={part.isSaving}
                onClick={() => void remove(part, i + 1)}
              >
                {part.isSaving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <StoryVideoField
              label="1. The questions, signed"
              signed
              hint="Students watch this first, so they know what to look for in the part."
              value={part.questionsVideoUrl ?? null}
              onChange={(url) => patch(part.uid, { questionsVideoUrl: url ?? undefined })}
            />
            <Label htmlFor={`part-questions-${part.uid}`} className="text-xs font-normal text-muted-foreground mt-1">
              The questions written out (optional) — students can read them while they answer
            </Label>
            <Textarea
              id={`part-questions-${part.uid}`}
              rows={3}
              placeholder={"For example:\n1. Where did they go?\n2. Why was she upset?"}
              value={part.question}
              onChange={(e) => patch(part.uid, { question: e.target.value })}
            />
          </div>

          <StoryVideoField
            label="2. The part"
            hint="Then they watch this part of the story, and film their answers to its questions."
            value={part.imageUrl ?? null}
            onChange={(url) => patch(part.uid, { imageUrl: url ?? undefined, mediaType: url ? "video" : undefined })}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`part-answers-${part.uid}`}>3. Answer sheet</Label>
            <Textarea
              id={`part-answers-${part.uid}`}
              rows={4}
              placeholder={"For example:\n1. To the beach (1 mark)\n2. She lost her bag (2 marks)"}
              value={part.modelAnswer ?? ""}
              onChange={(e) => patch(part.uid, { modelAnswer: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Shown once the answers are in, to mark them against.</p>
            <div className="flex items-center gap-2 mt-1">
              <Label htmlFor={`part-marks-${part.uid}`} className="text-sm font-normal">This part is worth</Label>
              <select
                id={`part-marks-${part.uid}`}
                value={part.maxMarks ?? DEFAULT_PART_MARKS}
                onChange={(e) => patch(part.uid, { maxMarks: Number(e.target.value) })}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {Array.from({ length: MAX_PART_MARKS }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{marksLabel(n)}</option>)}
              </select>
            </div>
          </div>

          {part.error && <p role="alert" className="text-sm text-destructive">{part.error}</p>}
        </div>
      ))}

      <Button type="button" variant="outline" className="self-start" onClick={() => onChange((current) => [...current, blankPart()])}>
        <Plus className="size-4 mr-1.5" /> Add a part
      </Button>
    </div>
  )
}
