"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, RotateCcw, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { sameWord } from "@/lib/quiz"
import type { PracticeSign } from "@/lib/sign-practice"
import { cn } from "@/lib/utils"
import { GetReady, Review, SignRound, type SignAnswer } from "./SignTestTaker"

type Props = {
  /** The round, in the order it is played, each with its word and the words to pick from. */
  signs: PracticeSign[]
  answerSeconds: number
  /** "Practise again" — fetches a fresh round. */
  onPlayAgain: () => void
  backHref: string
}

/**
 * The timed vocabulary game as practice: the same screens as a vocabulary
 * test (SignTestTaker), played from a list of signs passed in. It is marked
 * here and nothing is sent or recorded, so there is no pass mark and no limit.
 */
export function SignPractice({ signs, answerSeconds, onPlayAgain, backHref }: Props) {
  const [view, setView] = useState<"ready" | "playing" | "result" | "review">("ready")
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<SignAnswer[]>([])
  const answersRef = useRef<SignAnswer[]>([])

  function answer(text: string) {
    const sign = signs[index]
    answersRef.current = [
      ...answersRef.current,
      { questionId: sign.id, answerText: text || null, isCorrect: sameWord(text, sign.answer) },
    ]
    if (index + 1 < signs.length) {
      setIndex(index + 1)
      return
    }
    setAnswers(answersRef.current)
    setView("result")
  }

  if (view === "ready") return <GetReady onDone={() => setView("playing")} />

  if (view === "playing" && signs[index]) {
    return (
      <SignRound
        key={signs[index].id}
        sign={signs[index]}
        kind="VOCABULARY"
        answerSeconds={answerSeconds}
        number={index + 1}
        total={signs.length}
        onAnswer={answer}
      />
    )
  }

  if (view === "review") {
    return <Review questions={signs} answers={answers} answersRevealed onBack={() => setView("result")} />
  }

  const right = answers.filter((a) => a.isCorrect).length
  const allRight = right === signs.length
  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 text-center" aria-live="polite">
      <div className={cn("size-24 rounded-full flex items-center justify-center", allRight ? "bg-emerald-100" : "bg-primary/10")}>
        <Trophy className={cn("size-12", allRight ? "text-emerald-600" : "text-primary")} />
      </div>
      <div>
        <p className="text-3xl font-black">{right} of {signs.length}</p>
        <p className="text-muted-foreground mt-1">{allRight ? "All right — well done!" : "signs right"}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={onPlayAgain}><RotateCcw className="size-4 mr-1.5" /> Practise again</Button>
        <Button variant="outline" onClick={() => setView("review")}>Review answers</Button>
      </div>
      <Button variant="ghost" size="sm" asChild>
        <Link href={backHref}><ChevronLeft className="size-4 mr-1" /> Back to dictionary</Link>
      </Button>
    </div>
  )
}
