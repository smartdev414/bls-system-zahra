"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ACTIVITY_HINT, ACTIVITY_LABEL, MAX_NOTES, MAX_TITLE, RECEPTIVE_ACTIVITIES, ukToday,
  type ReceptiveActivity, type ReceptiveEntry, type ReceptiveInput,
} from "@/lib/receptive-log"

type Props = {
  /** The entry being changed; empty for a new one. */
  initial?: ReceptiveEntry
  saving: boolean
  submitLabel: string
  /** Resolve true when saved, so a new-entry form can clear itself. */
  onSubmit: (input: ReceptiveInput) => Promise<boolean>
  onCancel?: () => void
}

/** Date, kind of activity, what/who, how long and notes. Used to add and to edit. */
export function ReceptiveEntryForm({ initial, saving, submitLabel, onSubmit, onCancel }: Props) {
  const today = ukToday()
  const [date, setDate] = useState(initial?.date ?? today)
  const [activity, setActivity] = useState<ReceptiveActivity | "">(initial?.activity ?? "")
  const [title, setTitle] = useState(initial?.title ?? "")
  const [hours, setHours] = useState(initial ? String(Math.floor(initial.minutes / 60)) : "")
  const [mins, setMins] = useState(initial ? String(initial.minutes % 60) : "")
  const [notes, setNotes] = useState(initial?.notes ?? "")
  const [problem, setProblem] = useState<string | null>(null)

  const minutes = (Number(hours) || 0) * 60 + (Number(mins) || 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // The server checks all of this too; these just answer sooner.
    if (!activity) return setProblem("Choose what kind of activity it was")
    if (!title.trim()) return setProblem("Say what you watched or who you met")
    if (minutes < 1) return setProblem("Enter how long it was")
    setProblem(null)
    const ok = await onSubmit({ date, activity, title: title.trim(), minutes, notes: notes.trim() || null })
    if (ok && !initial) {
      // Keep the date and activity: students often log several things from one day.
      setTitle(""); setHours(""); setMins(""); setNotes("")
    }
  }

  const id = initial?.id ?? "new"

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rl-date-${id}`}>Date</Label>
          <Input id={`rl-date-${id}`} type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rl-activity-${id}`}>Activity</Label>
          <Select value={activity} onValueChange={(v) => setActivity(v as ReceptiveActivity)}>
            <SelectTrigger id={`rl-activity-${id}`} className="w-full"><SelectValue placeholder="Choose one" /></SelectTrigger>
            <SelectContent>
              {RECEPTIVE_ACTIVITIES.map((a) => <SelectItem key={a} value={a}>{ACTIVITY_LABEL[a]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`rl-title-${id}`}>What did you watch, or who did you meet?</Label>
        <Input
          id={`rl-title-${id}`} value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)}
          placeholder={activity ? ACTIVITY_HINT[activity] : "e.g. BBC News with in-vision signer"}
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium leading-none mb-1.5">How long?</legend>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Hours" type="number" inputMode="numeric" min={0} max={24} value={hours}
            onChange={(e) => setHours(e.target.value)} className="w-20" placeholder="0"
          />
          <span className="text-sm text-muted-foreground">hours</span>
          <Input
            aria-label="Minutes" type="number" inputMode="numeric" min={0} max={59} step={5} value={mins}
            onChange={(e) => setMins(e.target.value)} className="w-20" placeholder="0"
          />
          <span className="text-sm text-muted-foreground">minutes</span>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`rl-notes-${id}`}>
          What did you notice or learn? <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`rl-notes-${id}`} value={notes} maxLength={MAX_NOTES} rows={3} onChange={(e) => setNotes(e.target.value)}
          placeholder="New signs, facial expressions, how much you understood…"
        />
      </div>

      {problem && <p role="alert" className="text-sm font-medium text-destructive">{problem}</p>}

      <div className="flex items-center justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>}
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />} {submitLabel}
        </Button>
      </div>
    </form>
  )
}
