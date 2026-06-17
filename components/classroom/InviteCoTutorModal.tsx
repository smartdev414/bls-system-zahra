"use client"

import { useState, useMemo } from "react"
import { Search, Check, Loader2, Users2, X } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useFetch } from "@/hooks/use-fetch"
import { toast } from "sonner"

type Tutor = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

type CoTutor = { tutorId: string; tutorName: string; tutorEmail: string; invitedAt: string }

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

// Lets the host tutor invite another platform tutor to co-teach this session.
// The invitee gets a notification (and email if configured) with a deep link
// that opens the classroom with full tutor controls.
export function InviteCoTutorModal({
  sessionId,
  sessionTitle,
  onClose,
}: {
  sessionId: string
  sessionTitle: string
  onClose: () => void
}) {
  const { data: tutorsData, loading } = useFetch<{ tutors: Tutor[] }>("/api/tutor/colleagues")
  const { data: coTutorsData, refetch: refetchCoTutors } = useFetch<{ coTutors: CoTutor[] }>(
    `/api/tutor/sessions/${sessionId}/co-tutors`,
  )

  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)

  const allTutors = tutorsData?.tutors ?? []
  const alreadyAdded = new Set((coTutorsData?.coTutors ?? []).map((c) => c.tutorId))

  const filtered = useMemo(() => {
    if (!search.trim()) return allTutors
    const q = search.toLowerCase()
    return allTutors.filter(
      (t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q),
    )
  }, [allTutors, search])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function sendInvites() {
    if (selected.size === 0) return
    setSending(true)
    try {
      const res = await fetch(`/api/tutor/sessions/${sessionId}/co-tutors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorIds: [...selected] }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string }
        throw new Error(err.message ?? "Failed to invite co-teacher")
      }
      toast.success(`Invited ${selected.size} co-teacher${selected.size !== 1 ? "s" : ""} — they'll get a notification with a link to join.`)
      setSelected(new Set())
      await refetchCoTutors()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not invite co-teacher")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg flex flex-col gap-0 p-0 h-[80vh]">
        <DialogHeader className="px-5 pt-5 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Users2 className="size-4 text-primary" /> Invite a second teacher
          </DialogTitle>
          <p className="text-sm text-muted-foreground truncate">
            Session: <span className="font-medium text-foreground">{sessionTitle}</span>
          </p>
        </DialogHeader>

        <Separator />

        <div className="px-4 py-3 border-b shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tutors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No other tutors found.
            </p>
          ) : (
            filtered.map((tutor) => {
              const added = alreadyAdded.has(tutor.id)
              const isSelected = selected.has(tutor.id)
              return (
                <button
                  key={tutor.id}
                  disabled={added}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-muted/20 transition-colors ${added ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => !added && toggle(tutor.id)}
                >
                  <div className={`size-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 hover:border-primary"
                  }`}>
                    {isSelected && <Check className="size-2.5 text-white" />}
                  </div>
                  <Avatar className="size-7 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-[10px]">{initials(tutor.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tutor.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{tutor.email}</p>
                  </div>
                  {added && <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">Added</Badge>}
                </button>
              )
            })
          )}
        </ScrollArea>

        <Separator />
        <div className="px-5 py-3 shrink-0 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {selected.size > 0 ? (
              <span className="font-medium text-foreground">{selected.size} selected</span>
            ) : (
              "Select a tutor to invite"
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={selected.size === 0 || sending} onClick={sendInvites}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : `Invite${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
