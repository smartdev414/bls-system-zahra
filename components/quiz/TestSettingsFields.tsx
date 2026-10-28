"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { DEFAULT_PASS_MARK, MAX_ATTEMPTS_LIMIT, correctNeeded } from "@/lib/quiz"

/**
 * How a test is passed: the score needed and how many goes a student gets.
 * Shown on the add and edit lesson screens when the lesson is a test.
 *
 * Both are kept as the text the inputs hold (null attempts = unlimited);
 * `testSettingsBody` turns them into what the API expects.
 */
export type TestSettingsDraft = { passMark: string; maxAttempts: string | null }

export const DEFAULT_TEST_SETTINGS: TestSettingsDraft = { passMark: String(DEFAULT_PASS_MARK), maxAttempts: null }

export function testSettingsBody(draft: TestSettingsDraft): { passMark: number; maxAttempts: number | null } {
  return {
    // An emptied field falls back to the default; anything else is checked by the API.
    passMark: draft.passMark.trim() === "" ? DEFAULT_PASS_MARK : Number(draft.passMark),
    // A limit left blank goes as 0, which the API turns down — sending nothing
    // would quietly make the test unlimited.
    maxAttempts: draft.maxAttempts === null ? null : Number(draft.maxAttempts) || 0,
  }
}

/** "at least 7 of 10 questions right" (or "7 of 10 marks") — what the pass mark means for a test of this length. */
function neededToPass(passMark: string, questionCount: number, noun: string, totalMarks?: number): string | null {
  const mark = Number(passMark)
  if (!Number.isInteger(mark) || mark < 1 || mark > 100) return null
  if (totalMarks !== undefined) {
    if (totalMarks < 1) return null
    return `at least ${correctNeeded(mark, totalMarks)} of ${totalMarks} mark${totalMarks !== 1 ? "s" : ""}`
  }
  if (questionCount < 1) return null
  const needed = correctNeeded(mark, questionCount)
  return `at least ${needed} of ${questionCount} ${noun}${questionCount !== 1 ? "s" : ""} right`
}

export function TestSettingsFields({ value, onChange, questionCount = 0, noun = "question", totalMarks }: {
  value: TestSettingsDraft
  onChange: (value: TestSettingsDraft) => void
  /** Questions on the test so far, to say what the pass mark comes to. */
  questionCount?: number
  /** What the test is made of: "question", or "sign" in a fingerspelling or vocabulary test. */
  noun?: string
  /** Tests scored in marks (assessments, presentations): the marks it is out of. */
  totalMarks?: number
}) {
  const limited = value.maxAttempts !== null
  const needed = neededToPass(value.passMark, questionCount, noun, totalMarks)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="test-pass-mark">Pass mark (%)</Label>
        <Input
          id="test-pass-mark"
          type="number"
          min={1}
          max={100}
          step={1}
          value={value.passMark}
          onChange={(e) => onChange({ ...value, passMark: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          The score a student needs to pass{needed ? ` — ${needed}.` : "."}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Attempts allowed</Label>
        <div className="flex gap-2">
          <Select
            value={limited ? "limited" : "unlimited"}
            onValueChange={(v) => onChange({ ...value, maxAttempts: v === "limited" ? "3" : null })}
          >
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unlimited">Unlimited (practice)</SelectItem>
              <SelectItem value="limited">Limited</SelectItem>
            </SelectContent>
          </Select>
          {limited && (
            <Input
              type="number"
              min={1}
              max={MAX_ATTEMPTS_LIMIT}
              step={1}
              className="w-20"
              value={value.maxAttempts ?? ""}
              onChange={(e) => onChange({ ...value, maxAttempts: e.target.value })}
              aria-label="Number of attempts"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {limited
            ? "Correct answers are shown once a student passes or runs out of attempts."
            : "Students can retake it as often as they like and see the correct answers each time."}
        </p>
      </div>
    </div>
  )
}
