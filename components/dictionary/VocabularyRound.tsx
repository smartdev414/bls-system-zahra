"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarDays, ChevronLeft, Loader2, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFetch } from "@/hooks/use-fetch"
import { SignPractice } from "@/components/quiz/SignPractice"
import type { PracticeSign } from "@/lib/sign-practice"

type Round = { source: "week" | "saved"; signs: PracticeSign[]; answerSeconds: number }

/**
 * The timed vocabulary game from the dictionary, on one set of signs:
 *   week — this week's signs, or the starred ones when nothing new came out;
 *   mine — the student's starred signs only.
 * Practice only: nothing is marked or recorded (lib/sign-practice.ts).
 */
export function VocabularyRound({ set }: { set: "week" | "mine" }) {
  const [round, setRound] = useState(0)
  const { data, loading, refetch } = useFetch<Round>(`/api/dictionary/practice?set=${set}`, {
    errorMessage: set === "week" ? "Could not load this week's signs" : "Could not load your signs",
    onSuccess: () => setRound((r) => r + 1),
  })

  const intro = set === "mine"
    ? "Your starred signs. Pick the right word before the time runs out."
    : data?.source === "week"
      ? "Signs from your lessons this week. Pick the right word before the time runs out."
      : "Nothing new this week, so here are your starred signs. Pick the right word before the time runs out."

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild aria-label="Back to dictionary" className="shrink-0">
          <Link href="/student/dictionary"><ChevronLeft className="size-5" /></Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight">
            {set === "mine" ? "Test my signs" : <>This week&apos;s signs</>}
          </h1>
          {data && data.signs.length > 0 && <p className="text-sm text-muted-foreground">{intro}</p>}
        </div>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data.signs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          {set === "mine" ? <Star className="size-10 text-primary" /> : <CalendarDays className="size-10 text-primary" />}
          <p className="font-semibold">No signs to practise yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            {set === "mine"
              ? "Tap the star on any sign in the dictionary to add it to My signs, then test yourself on them here."
              : "None of this week's lessons have signs from the dictionary. Star some signs in the dictionary and they'll be practised here instead."}
          </p>
          <Button asChild><Link href="/student/dictionary">Go to the dictionary</Link></Button>
        </div>
      ) : (
        <SignPractice
          key={round}
          signs={data.signs}
          answerSeconds={data.answerSeconds}
          onPlayAgain={() => void refetch()}
          backHref="/student/dictionary"
        />
      )}
    </div>
  )
}
