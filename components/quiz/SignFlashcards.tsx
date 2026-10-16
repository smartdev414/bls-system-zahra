"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, ChevronLeft, Eye, RotateCcw, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ProtectedVideo } from "@/components/ui/protected-video"
import type { PracticeSign } from "@/lib/sign-practice"

type Props = {
  signs: PracticeSign[]
  /** "Practise again" — fetches a fresh round. */
  onPlayAgain: () => void
  backHref: string
}

/**
 * Flashcards: the sign plays, the student taps to see the word, then says
 * whether they knew it. A card they did not know goes to the back of the pile
 * and comes round again, until every card has been a "Got it". No clock, and
 * nothing is recorded.
 */
export function SignFlashcards({ signs, onPlayAgain, backHref }: Props) {
  const [pile, setPile] = useState<PracticeSign[]>(signs)
  const [revealed, setRevealed] = useState(false)
  // Counts the cards shown, so a card that comes round again starts its video from the top.
  const [turn, setTurn] = useState(0)
  // Cards that came back after an "Again" — the rest were known first time.
  const [missed, setMissed] = useState<Set<string>>(() => new Set())

  const card = pile[0]
  const done = signs.length - pile.length

  function gotIt() {
    setPile(pile.slice(1))
    setRevealed(false)
    setTurn(turn + 1)
  }

  function again() {
    setMissed(new Set(missed).add(card.id))
    setPile([...pile.slice(1), card])
    setRevealed(false)
    setTurn(turn + 1)
  }

  if (!card) {
    const firstTime = signs.length - missed.size
    return (
      <div className="flex flex-col items-center gap-6 py-8 px-4 text-center" aria-live="polite">
        <div className="size-24 rounded-full flex items-center justify-center bg-emerald-100">
          <Trophy className="size-12 text-emerald-600" />
        </div>
        <div>
          <p className="text-3xl font-black">{firstTime} of {signs.length}</p>
          <p className="text-muted-foreground mt-1">known first time</p>
        </div>
        <Button onClick={onPlayAgain}><RotateCcw className="size-4 mr-1.5" /> Practise again</Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}><ChevronLeft className="size-4 mr-1" /> Back to dictionary</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-2 mx-auto w-full max-w-xl">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          {done} of {signs.length} done{pile.length > 1 ? ` · ${pile.length} to go` : " · last one"}
        </p>
        <Progress value={(done / signs.length) * 100} className="h-1.5" />
      </div>

      {card.mediaType === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={turn}
          src={card.imageUrl ?? ""}
          alt="The sign"
          className="w-full aspect-video rounded-xl border bg-black object-contain select-none pointer-events-none"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      ) : (
        <ProtectedVideo
          key={turn}
          src={card.imageUrl ?? ""}
          autoPlay muted loop playsInline controls
          className="w-full aspect-video rounded-xl border bg-black object-contain"
        />
      )}

      {revealed ? (
        <>
          <p className="text-center text-3xl font-black break-words py-2" aria-live="polite">{card.answer}</p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-14 text-base font-semibold" onClick={again}>
              <RotateCcw className="size-4 mr-1.5" /> Again
            </Button>
            <Button className="h-14 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white" onClick={gotIt}>
              <Check className="size-4 mr-1.5" /> Got it
            </Button>
          </div>
        </>
      ) : (
        <Button variant="outline" className="h-[7.5rem] text-base font-semibold border-dashed" onClick={() => setRevealed(true)}>
          <Eye className="size-5 mr-2" /> Tap to see the word
        </Button>
      )}
    </div>
  )
}
