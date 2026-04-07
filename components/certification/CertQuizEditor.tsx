"use client"

import { useState } from "react"
import { Plus, Trash2, Check, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type CertQuizQuestion = {
  id: string
  text: string
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE"
  options: { id: string; text: string; isCorrect: boolean }[]
}

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

function emptyQuestion(): CertQuizQuestion {
  return {
    id: genId(),
    text: "",
    type: "MULTIPLE_CHOICE",
    options: [
      { id: genId(), text: "", isCorrect: true },
      { id: genId(), text: "", isCorrect: false },
    ],
  }
}

export function CertQuizEditor({
  questions,
  onChange,
}: {
  questions: CertQuizQuestion[]
  onChange: (q: CertQuizQuestion[]) => void
}) {
  function addQuestion() {
    onChange([...questions, emptyQuestion()])
  }

  function updateQuestion(idx: number, q: CertQuizQuestion) {
    const next = [...questions]
    next[idx] = q
    onChange(next)
  }

  function removeQuestion(idx: number) {
    onChange(questions.filter((_, i) => i !== idx))
  }

  return (
    <div className="flex flex-col gap-3">
      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Quiz Questions ({questions.length})
      </Label>

      {questions.map((q, qi) => (
        <div key={q.id} className="rounded-lg border bg-muted/20 p-3 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="text-xs font-bold text-muted-foreground mt-2 w-5 shrink-0">{qi + 1}.</span>
            <div className="flex-1 flex flex-col gap-2">
              <Input
                value={q.text}
                onChange={(e) => updateQuestion(qi, { ...q, text: e.target.value })}
                placeholder="Question text..."
                className="text-sm h-8"
              />
              <div className="flex items-center gap-2">
                <Select
                  value={q.type}
                  onValueChange={(v) => {
                    const type = v as "MULTIPLE_CHOICE" | "TRUE_FALSE"
                    const options = type === "TRUE_FALSE"
                      ? [{ id: genId(), text: "True", isCorrect: true }, { id: genId(), text: "False", isCorrect: false }]
                      : q.options.length < 2
                      ? [...q.options, { id: genId(), text: "", isCorrect: false }]
                      : q.options
                    updateQuestion(qi, { ...q, type, options })
                  }}
                >
                  <SelectTrigger className="h-7 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MULTIPLE_CHOICE">Multiple Choice</SelectItem>
                    <SelectItem value="TRUE_FALSE">True / False</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Options */}
              <div className="flex flex-col gap-1">
                {q.options.map((opt, oi) => (
                  <div key={opt.id} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const opts = q.options.map((o, i) => ({ ...o, isCorrect: i === oi }))
                        updateQuestion(qi, { ...q, options: opts })
                      }}
                      className={cn(
                        "size-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer",
                        opt.isCorrect
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-muted-foreground/30 hover:border-emerald-400"
                      )}
                    >
                      {opt.isCorrect && <Check className="size-3" />}
                    </button>
                    <Input
                      value={opt.text}
                      onChange={(e) => {
                        const opts = [...q.options]
                        opts[oi] = { ...opts[oi], text: e.target.value }
                        updateQuestion(qi, { ...q, options: opts })
                      }}
                      placeholder={`Option ${oi + 1}`}
                      className="h-7 text-xs flex-1"
                      disabled={q.type === "TRUE_FALSE"}
                    />
                    {q.type === "MULTIPLE_CHOICE" && q.options.length > 2 && (
                      <Button
                        type="button" size="icon" variant="ghost"
                        className="size-6 text-destructive shrink-0"
                        onClick={() => {
                          const opts = q.options.filter((_, i) => i !== oi)
                          if (opt.isCorrect && opts.length > 0) opts[0].isCorrect = true
                          updateQuestion(qi, { ...q, options: opts })
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                ))}
                {q.type === "MULTIPLE_CHOICE" && q.options.length < 6 && (
                  <Button
                    type="button" size="sm" variant="ghost"
                    className="h-6 text-xs text-muted-foreground self-start mt-0.5"
                    onClick={() => {
                      updateQuestion(qi, { ...q, options: [...q.options, { id: genId(), text: "", isCorrect: false }] })
                    }}
                  >
                    <Plus className="size-3 mr-1" /> Add option
                  </Button>
                )}
              </div>
            </div>
            <Button
              type="button" size="icon" variant="ghost"
              className="size-6 text-destructive shrink-0"
              onClick={() => removeQuestion(qi)}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" size="sm" variant="outline" onClick={addQuestion} className="gap-1.5 self-start">
        <Plus className="size-3.5" /> Add Question
      </Button>
    </div>
  )
}
