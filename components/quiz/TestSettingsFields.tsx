"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { DEFAULT_PASS_MARK, MAX_ATTEMPTS_LIMIT } from "@/lib/quiz"

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

export function TestSettingsFields({ value, onChange }: {
  value: TestSettingsDraft
  onChange: (value: TestSettingsDraft) => void
}) {
  const limited = value.maxAttempts !== null
  return (
    <div className="grid grid-cols-2 gap-4">
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
        <p className="text-xs text-muted-foreground">The score a student needs to pass.</p>
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
