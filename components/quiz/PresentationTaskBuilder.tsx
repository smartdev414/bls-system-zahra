"use client"

import { useEffect } from "react"
import { Presentation } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DEFAULT_PART_MARKS, MAX_PART_MARKS, marksLabel } from "@/lib/quiz"
import { cn } from "@/lib/utils"
import type { QuestionDraft } from "./QuizBuilder"
import { StoryVideoField } from "./TestKindFields"

// A presentation's one task: what students present, written out and/or signed
// on video, and what it is worth. Saved with the test's "Save changes", like
// questions are.

function blankTask(): QuestionDraft {
  return {
    uid: crypto.randomUUID(), question: "", type: "WRITTEN", options: [], maxMarks: DEFAULT_PART_MARKS,
    isOpen: true, isSaving: false, error: null,
  }
}

export function PresentationTaskBuilder({ tasks, onChange }: {
  tasks: QuestionDraft[]
  onChange: (update: (current: QuestionDraft[]) => QuestionDraft[]) => void
}) {
  // There is always the one task to fill in.
  useEffect(() => {
    if (tasks.length === 0) onChange((current) => (current.length === 0 ? [blankTask()] : current))
  }, [tasks.length, onChange])

  const task = tasks[0]
  if (!task) return null
  const patch = (change: Partial<QuestionDraft>) =>
    onChange((current) => current.map((t) => (t.uid === task.uid ? { ...t, ...change, dirty: true, error: null } : t)))

  return (
    <div className={cn("rounded-xl border bg-background p-4 flex flex-col gap-5", task.error && "border-destructive")}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold"><Presentation className="size-4 text-primary" /> The task</p>
        {task.id && !task.dirty
          ? <Badge variant="outline" className="text-[10px]">Saved</Badge>
          : <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">Not saved</Badge>}
      </div>

      <p className="text-sm text-muted-foreground">
        Students read (or watch) the task, film themselves presenting, and send it to you. You are told when it comes in,
        and mark it in Results, where you can also record your feedback over their video.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`task-${task.uid}`}>What should they present?</Label>
        <Textarea
          id={`task-${task.uid}`}
          rows={4}
          placeholder={"For example: Tell us about your family — who they are, where they live and what they like doing."}
          value={task.question}
          onChange={(e) => patch({ question: e.target.value })}
        />
      </div>

      <StoryVideoField
        label="The task, signed (optional)"
        signed
        hint="Students watch this before they start."
        value={task.imageUrl ?? null}
        onChange={(url) => patch({ imageUrl: url ?? undefined, mediaType: url ? "video" : undefined })}
      />

      <div className="flex items-center gap-2">
        <Label htmlFor={`task-marks-${task.uid}`} className="text-sm font-normal">It is worth</Label>
        <select
          id={`task-marks-${task.uid}`}
          value={task.maxMarks ?? DEFAULT_PART_MARKS}
          onChange={(e) => patch({ maxMarks: Number(e.target.value) })}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
        >
          {Array.from({ length: MAX_PART_MARKS }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{marksLabel(n)}</option>)}
        </select>
      </div>

      {task.error && <p role="alert" className="text-sm text-destructive">{task.error}</p>}
    </div>
  )
}
