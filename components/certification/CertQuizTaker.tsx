"use client"

import { useState } from "react"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Question = {
  id: string
  text: string
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE"
  options: { id: string; text: string; isCorrect: boolean }[]
}

export function CertQuizTaker({
  questions,
  passScore,
  onSubmit,
}: {
  questions: Question[]
  passScore: number
  onSubmit: (score: number) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null)

  function selectAnswer(questionId: string, optionId: string) {
    if (submitted) return
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }))
  }

  function handleSubmit() {
    let correct = 0
    for (const q of questions) {
      const selectedId = answers[q.id]
      const correctOpt = q.options.find((o) => o.isCorrect)
      if (selectedId === correctOpt?.id) correct++
    }
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0
    setResult({ score, passed: score >= passScore })
    setSubmitted(true)
    onSubmit(score)
  }

  const allAnswered = questions.every((q) => answers[q.id])

  return (
    <div className="flex flex-col gap-4">
      {/* Result banner */}
      {result && (
        <div className={cn(
          "rounded-lg px-4 py-3 flex items-center gap-2 text-sm font-semibold",
          result.passed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
        )}>
          {result.passed ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {result.passed
            ? `Passed! Score: ${result.score}% (required: ${passScore}%)`
            : `Score: ${result.score}% — ${passScore}% required to pass. You can try again.`}
        </div>
      )}

      {/* Questions */}
      {questions.map((q, qi) => {
        const selectedId = answers[q.id]
        const correctOptId = q.options.find((o) => o.isCorrect)?.id

        return (
          <div key={q.id} className="rounded-lg border p-4">
            <p className="text-sm font-semibold mb-3">
              <span className="text-muted-foreground mr-1.5">{qi + 1}.</span>
              {q.text}
            </p>
            <div className="flex flex-col gap-1.5">
              {q.options.map((opt) => {
                const isSelected = selectedId === opt.id
                const showCorrect = submitted && opt.id === correctOptId
                const showWrong = submitted && isSelected && opt.id !== correctOptId
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectAnswer(q.id, opt.id)}
                    disabled={submitted}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm text-left transition-colors cursor-pointer",
                      !submitted && isSelected && "border-primary bg-primary/5",
                      !submitted && !isSelected && "hover:bg-muted/50",
                      showCorrect && "border-emerald-400 bg-emerald-50 text-emerald-700",
                      showWrong && "border-rose-400 bg-rose-50 text-rose-700",
                      submitted && !showCorrect && !showWrong && "opacity-50",
                    )}
                  >
                    <div className={cn(
                      "size-4 rounded-full border-2 flex items-center justify-center shrink-0",
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/30",
                      showCorrect && "border-emerald-500 bg-emerald-500",
                      showWrong && "border-rose-500 bg-rose-500",
                    )}>
                      {isSelected && <div className="size-1.5 rounded-full bg-white" />}
                    </div>
                    {opt.text}
                    {showCorrect && <CheckCircle2 className="size-3.5 ml-auto text-emerald-500" />}
                    {showWrong && <XCircle className="size-3.5 ml-auto text-rose-500" />}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Submit */}
      {!submitted && (
        <Button onClick={handleSubmit} disabled={!allAnswered} className="self-start">
          Submit Answers ({Object.keys(answers).length}/{questions.length})
        </Button>
      )}
    </div>
  )
}
