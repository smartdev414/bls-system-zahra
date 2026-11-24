"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, Layers, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { inSectionOrder, MAX_STORY_SECTIONS, type StorySection } from "@/lib/quiz"
import { QuizBuilder, type QuestionDraft } from "./QuizBuilder"
import { StoryVideoField } from "./TestKindFields"

type QuestionsChange = (next: QuestionDraft[] | ((current: QuestionDraft[]) => QuestionDraft[])) => void

/**
 * A story test's questions, split into sections as on the exam paper: each
 * section has its own clip and questions numbered from 1 again ("Section 2,
 * Question 1"). Without sections it is the one list of questions it always was,
 * with a way to split it.
 */
export function StorySectionsBuilder({ testId, sections, onSectionsChange, questions, onQuestionsChange, onAddFromDictionary }: {
  testId: string
  sections: StorySection[]
  onSectionsChange: (sections: StorySection[]) => void
  questions: QuestionDraft[]
  onQuestionsChange: QuestionsChange
  onAddFromDictionary?: () => void
}) {
  const [perSection, setPerSection] = useState("3")

  const newSection = (): StorySection => ({ id: crypto.randomUUID(), videoUrl: null })

  // Splits the questions already there into sections of a few each, in order.
  function split() {
    const size = Math.max(1, Math.min(50, Math.floor(Number(perSection)) || 3))
    const real = questions.filter((q) => q.question.trim() || q.id || q.imageUrl)
    const realIds = new Set(real.map((q) => q.uid))
    const count = Math.min(MAX_STORY_SECTIONS, Math.max(1, Math.ceil(real.length / size)))
    const made = Array.from({ length: count }, newSection)
    onSectionsChange(made)
    let n = 0
    onQuestionsChange((current) => current.map((q) => {
      const at = realIds.has(q.uid) ? Math.floor(n++ / size) : count - 1
      const section = made[Math.min(count - 1, at)].id
      return { ...q, section, dirty: q.id ? true : q.dirty }
    }))
  }

  // ── Not split yet: the questions as one list ────────────────────────────────
  if (sections.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-2">
            <Layers className="size-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Set it out like the exam paper</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Split the story into sections — Section 1, Questions 1–3; Section 2, Questions 1–3… Each section can have
                its own video. Students watch a section, answer its questions, then go on to the next.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {questions.length > 0 && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Questions in each section
                <Input type="number" min={1} max={50} value={perSection} onChange={(e) => setPerSection(e.target.value)} className="h-9 w-24" />
              </label>
            )}
            <Button type="button" size="sm" onClick={split}>
              <Layers className="size-3.5 mr-1.5" /> {questions.length > 0 ? "Split into sections" : "Use sections"}
            </Button>
          </div>
        </div>
        <QuizBuilder
          selfMarked
          testId={testId}
          questions={questions}
          onChange={onQuestionsChange}
          onAddFromDictionary={onAddFromDictionary}
        />
      </div>
    )
  }

  // ── In sections ─────────────────────────────────────────────────────────────
  const known = new Set(sections.map((s) => s.id))
  const loose = questions.filter((q) => !q.section || !known.has(q.section))

  // The questions of one section, changed: the rest of the test stays as it is,
  // and the whole list is kept section by section.
  const changeSection = (id: string): QuestionsChange => (next) => onQuestionsChange((current) => {
    const mine = current.filter((q) => q.section === id)
    const changed = (typeof next === "function" ? next(mine) : next)
      .map((q) => (q.section === id ? q : { ...q, section: id, dirty: q.id ? true : q.dirty }))
    return inSectionOrder([...current.filter((q) => q.section !== id), ...changed], sections)
  })

  const orderAll = (id: string) => (next: QuestionDraft[]) =>
    inSectionOrder([...questions.filter((q) => q.section !== id), ...next], sections)

  function moveSection(from: number, to: number) {
    const next = [...sections]
    ;[next[from], next[to]] = [next[to], next[from]]
    onSectionsChange(next)
    onQuestionsChange((current) => inSectionOrder(current, next))
  }

  // Questions in no section (e.g. from the dictionary) go into the last one.
  function adoptLoose() {
    const last = sections[sections.length - 1].id
    onQuestionsChange((current) => current.map((q) => (
      !q.section || !known.has(q.section) ? { ...q, section: last, dirty: q.id ? true : q.dirty } : q
    )))
  }

  return (
    <div className="flex flex-col gap-5">
      {sections.map((section, i) => {
        const count = questions.filter((q) => q.section === section.id).length
        return (
          <section key={section.id} className="flex flex-col gap-4 rounded-2xl border-2 p-4" aria-label={`Section ${i + 1}`}>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold">Section {i + 1}</h3>
              <div className="ml-auto flex items-center gap-1">
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={i === 0}
                  title="Move section up" aria-label={`Move section ${i + 1} up`} onClick={() => moveSection(i, i - 1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={i === sections.length - 1}
                  title="Move section down" aria-label={`Move section ${i + 1} down`} onClick={() => moveSection(i, i + 1)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                  disabled={count > 0}
                  title={count > 0 ? "Delete its questions first" : "Delete section"}
                  aria-label={`Delete section ${i + 1}`}
                  onClick={() => onSectionsChange(sections.filter((s) => s.id !== section.id))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <StoryVideoField
              label={`Section ${i + 1} video`}
              hint="Students watch this, then answer the questions below. Leave it empty and they use the whole story video instead."
              value={section.videoUrl}
              onChange={(url) => onSectionsChange(sections.map((s) => (s.id === section.id ? { ...s, videoUrl: url } : s)))}
            />
            <QuizBuilder
              selfMarked
              testId={testId}
              heading={`Section ${i + 1} questions`}
              questions={questions.filter((q) => q.section === section.id)}
              onChange={changeSection(section.id)}
              orderAll={orderAll(section.id)}
            />
          </section>
        )
      })}

      {loose.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>{loose.length === 1 ? "1 question is" : `${loose.length} questions are`} not in a section yet. Students get {loose.length === 1 ? "it" : "them"} at the end.</span>
          <Button type="button" size="sm" variant="outline" className="bg-background" onClick={adoptLoose}>
            Put in Section {sections.length}
          </Button>
        </div>
      )}

      {sections.length < MAX_STORY_SECTIONS && (
        <Button type="button" variant="outline" className="self-start" onClick={() => onSectionsChange([...sections, newSection()])}>
          <Plus className="size-4 mr-1.5" /> Add section {sections.length + 1}
        </Button>
      )}
    </div>
  )
}
