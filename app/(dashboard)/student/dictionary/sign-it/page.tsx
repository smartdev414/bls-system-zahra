"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, Loader2, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFetch } from "@/hooks/use-fetch"
import { SignItYourself } from "@/components/quiz/SignItYourself"
import type { PracticeSign } from "@/lib/sign-practice"

// Sign it yourself: the student's starred signs, word → sign, filmed and self-marked (nothing is saved).
export default function SignItPage() {
  // A new round each time — the API sends the starred signs in a new order.
  const [round, setRound] = useState(0)
  const { data, loading, refetch } = useFetch<{ signs: PracticeSign[] }>("/api/dictionary/practice?set=saved", {
    errorMessage: "Could not load your signs",
    onSuccess: () => setRound((r) => r + 1),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild aria-label="Back to dictionary">
          <Link href="/student/dictionary"><ChevronLeft className="size-5" /></Link>
        </Button>
        <h1 className="text-xl font-black tracking-tight">Sign it yourself</h1>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data.signs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Star className="size-10 text-amber-400" />
          <p className="font-semibold">No signs starred yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">Tap the star on any sign in the dictionary to add it to your list.</p>
          <Button asChild><Link href="/student/dictionary">Go to the dictionary</Link></Button>
        </div>
      ) : (
        <SignItYourself key={round} signs={data.signs} onPlayAgain={() => void refetch()} backHref="/student/dictionary" />
      )}
    </div>
  )
}
