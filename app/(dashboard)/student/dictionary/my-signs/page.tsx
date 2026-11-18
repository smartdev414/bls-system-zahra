"use client"

import { VocabularyRound } from "@/components/dictionary/VocabularyRound"

// "Test my signs" — the timed vocabulary game on the student's starred signs only.
export default function MySignsTestPage() {
  return <VocabularyRound set="mine" />
}
