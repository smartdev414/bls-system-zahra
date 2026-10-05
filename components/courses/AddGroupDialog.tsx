"use client"

import { useState } from "react"
import { Loader2, Plus, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useFetch } from "@/hooks/use-fetch"

type Group = {
  id: string
  name: string
  // Whose group it is — only sent to staff, who see every tutor's groups.
  tutorName?: string
  members: Array<{ id: string }>
}

/**
 * Put a group on a course: pick one that already exists, or start a new one.
 * Either way its students are enrolled on the course with it.
 */
export function AddGroupDialog({
  courseId,
  attachedIds,
  onClose,
  onAdded,
}: {
  courseId: string
  /** Groups already on the course, left out of the list. */
  attachedIds: Set<string>
  onClose: () => void
  /** `isNew` is true for a group just created here, which has no students yet. */
  onAdded: (group: { id: string; name: string }, isNew: boolean) => void
}) {
  const { data, loading } = useFetch<{ groups: Group[] }>("/api/tutor/groups", {
    errorMessage: "Could not load groups",
  })
  const [name, setName] = useState("")
  // The group id being added, or "new" while a new one is created.
  const [busy, setBusy] = useState<string | null>(null)

  const available = (data?.groups ?? []).filter((g) => !attachedIds.has(g.id))

  async function add(body: { groupId: string } | { name: string }, label: string) {
    setBusy("groupId" in body ? body.groupId : "new")
    try {
      const res = await fetch(`/api/tutor/courses/${courseId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({})) as {
        group?: { id: string; name: string }
        added?: number
        message?: string
      }
      if (!res.ok || !json.group) {
        toast.error(json.message ?? "Could not add the group")
        return
      }
      // A new group has nobody in it, so the page goes straight on to choosing
      // its students — no message needed in between.
      if (!("name" in body)) {
        toast.success(`${label} added` + (json.added ? ` — ${json.added} student${json.added === 1 ? "" : "s"} enrolled` : ""))
      }
      onClose()
      onAdded(json.group, "name" in body)
    } catch {
      toast.error("Could not add the group")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-primary" /> Add a group
          </DialogTitle>
          <DialogDescription>
            A group is one class on this course. Its students are enrolled with it, and you can then give it its own class times.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Your groups</Label>
            {loading && !data ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : available.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                {data?.groups.length ? "Every group is already on this course." : "No groups yet — create the first one below."}
              </p>
            ) : (
              <div className="flex flex-col divide-y rounded-xl border max-h-64 overflow-y-auto">
                {available.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {g.members.length} student{g.members.length === 1 ? "" : "s"}
                        {g.tutorName ? ` · ${g.tutorName}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      disabled={busy !== null}
                      onClick={() => add({ groupId: g.id }, g.name)}
                      aria-label={`Add ${g.name}`}
                    >
                      {busy === g.id ? <Loader2 className="size-3 animate-spin" /> : "Add"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) void add({ name: name.trim() }, name.trim()) }}
          >
            <Label htmlFor="new-group" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Or start a new group
            </Label>
            <div className="flex gap-2">
              <Input
                id="new-group"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Monday evening"
              />
              <Button type="submit" disabled={!name.trim() || busy !== null} className="shrink-0 gap-1">
                {busy === "new" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Create
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
