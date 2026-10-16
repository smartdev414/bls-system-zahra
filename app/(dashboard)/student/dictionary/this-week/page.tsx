"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarDays, ChevronLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFetch } from "@/hooks/use-fetch"
import { SignPractice } from "@/components/quiz/SignPractice"
import type { PracticeSign } from "@/lib/sign-practice"

type Round = { source: "week" | "saved"; signs: PracticeSign[]; answerSeconds: number }

// "Practise this week's signs" — the timed vocabulary game on the signs taught
// this week, or the starred signs when nothing new came out (lib/sign-practice.ts).
export default function ThisWeekPracticePage() {
  const [round, setRound] = useState(0)
  const { data, loading, refetch } = useFetch<Round>("/api/dictionary/practice?set=week", {
    errorMessage: "Could not load this week's signs",
    onSuccess: () => setRound((r) => r + 1),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild aria-label="Back to dictionary" className="shrink-0">
          <Link href="/student/dictionary"><ChevronLeft className="size-5" /></Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight">This week&apos;s signs</h1>
          {data && data.signs.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {data.source === "week"
                ? "Signs from your lessons this week. Pick the right word before the time runs out."
                : "Nothing new this week, so here are your starred signs. Pick the right word before the time runs out."}
            </p>
          )}
        </div>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data.signs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <CalendarDays className="size-10 text-primary" />
          <p className="font-semibold">No signs to practise yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            None of this week&apos;s lessons have signs from the dictionary. Star some signs in the dictionary and they&apos;ll be practised here instead.
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
