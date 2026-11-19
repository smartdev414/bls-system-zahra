"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TestBankPicker } from "@/components/tests/TestBankPicker"
import { DIFFICULTY_INFO, LEAGUE_DIFFICULTIES, type LeagueDifficulty } from "@/lib/leagues"
import { cn } from "@/lib/utils"

export type EditableLeague = {
  id: string
  title: string
  difficulty: LeagueDifficulty
  endsAt: string | null
  test: { id: string; title: string } | null
}

/** "2026-11-30" for a date input, from a league's end (the end of that day, UTC). */
function dayOf(endsAt: string | null): string {
  return endsAt ? new Date(endsAt).toISOString().slice(0, 10) : ""
}

/**
 * Start a league, or change one: how hard, which words, and — if it should
 * stop — the last day. The name fills itself in from the difficulty.
 */
export function LeagueFormDialog({ league, open, onOpenChange, onSaved }: {
  /** The league to change; none to start a new one. */
  league?: EditableLeague
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [difficulty, setDifficulty] = useState<LeagueDifficulty>(league?.difficulty ?? "EASY")
  const [testId, setTestId] = useState<string | null>(league?.test?.id ?? null)
  const [title, setTitle] = useState(league?.title ?? "")
  const [endDay, setEndDay] = useState(dayOf(league?.endsAt ?? null))
  const [saving, setSaving] = useState(false)

  const defaultTitle = `${DIFFICULTY_INFO[difficulty].label} fingerspelling league`
  const today = new Date().toISOString().slice(0, 10)

  async function save() {
    if (!testId) {
      toast.error("Choose the words — a fingerspelling test")
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { difficulty, testId, title: title.trim() || defaultTitle }
      // A finished league keeps its end unless it is changed here.
      if (!league || endDay !== dayOf(league.endsAt)) body.endsAt = endDay || null
      const res = await fetch(league ? `/api/leagues/${league.id}` : "/api/leagues", {
        method: league ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(d.message ?? "Could not save the league")
      toast.success(league ? "League saved" : "League started — students can join it now")
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the league")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{league ? "Change league" : "New fingerspelling league"}</DialogTitle>
          <DialogDescription>Any student can join, whatever their level.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>How hard</Label>
            <div role="radiogroup" aria-label="How hard" className="grid grid-cols-3 gap-2">
              {LEAGUE_DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === d}
                  onClick={() => setDifficulty(d)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors",
                    difficulty === d ? cn(DIFFICULTY_INFO[d].badge, "ring-1 ring-current") : "hover:bg-muted/50",
                  )}
                >
                  {DIFFICULTY_INFO[d].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{DIFFICULTY_INFO[difficulty].rules}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Words</Label>
            <p className="text-xs text-muted-foreground -mt-1">A fingerspelling test from your Tests — each go plays up to 10 of its words, picked at random.</p>
            <TestBankPicker kind="FINGERSPELLING" value={testId} onChange={(t) => setTestId(t.id)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="league-title">Name</Label>
              <Input id="league-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle} maxLength={100} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="league-end">Last day <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="league-end" type="date" value={endDay} min={today} onChange={(e) => setEndDay(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            {league ? "Save" : "Start league"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
