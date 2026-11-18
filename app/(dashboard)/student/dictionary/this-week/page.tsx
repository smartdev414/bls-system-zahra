"use client"

import { VocabularyRound } from "@/components/dictionary/VocabularyRound"

// "Practise this week's signs" — the timed vocabulary game on the signs taught
// this week, or the starred signs when nothing new came out (lib/sign-practice.ts).
export default function ThisWeekPracticePage() {
  return <VocabularyRound set="week" />
}
