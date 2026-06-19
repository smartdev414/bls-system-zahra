"use client"

import { useState, useMemo } from "react"
import { Search, Check, Loader2, Users2, X } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useFetch } from "@/hooks/use-fetch"

export type Tutor = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

/**
 * Multi-select tutor picker for the "new session" form — pick co-teachers
 * before the session is created.
 */
export function TutorPickerModal({
  selected,
  onConfirm,
  onClose,
}: {
  selected: Set<string>
  onConfirm: (ids: Set<string>, tutors: Tutor[]) => void
  onClose: () => void
}) {
  const { data: tutorsData } = useFetch<{ tutors: Tutor[] }>("/api/tutor/colleagues")

  const [search, setSearch] = useState("")
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set(selected))

  const allTutors = tutorsData?.tutors ?? []

  const filtered = useMemo(() => {
    if (!search.trim()) return allTutors
    const q = search.toLowerCase()
    return allTutors.filter(
      (t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q),
    )
  }, [allTutors, search])

  function toggleTutor(id: string) {
    setLocalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    const allIds = filtered.map((t) => t.id)
    const allAreSelected = allIds.every((id) => localSelected.has(id))
    if (allAreSelected) {
      setLocalSelected((prev) => {
        const next = new Set(prev)
        allIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setLocalSelected((prev) => {
        const next = new Set(prev)
        allIds.forEach((id) => next.add(id))
        return next
      })
    }
  }

  function handleConfirm() {
    const selectedTutors = allTutors.filter((t) => localSelected.has(t.id))
    onConfirm(localSelected, selectedTutors)
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => localSelected.has(t.id))

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg flex flex-col gap-0 p-0 h-[80vh]">
        <DialogHeader className="px-5 pt-5 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Users2 className="size-4 text-primary" /> Select Tutors to Invite
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Choose colleagues to co-teach this session with you.
          </p>
        </DialogHeader>

        <Separator />

        <div className="px-4 py-3 border-b shrink-0 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tutors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          {filtered.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs shrink-0 gap-1"
              onClick={selectAll}
            >
              {allFilteredSelected ? <><X className="size-3" /> Deselect all</> : <><Check className="size-3" /> Select all</>}
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {tutorsData === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No tutors found.</p>
          ) : (
            filtered.map((tutor) => {
              const isSelected = localSelected.has(tutor.id)
              return (
                <button
                  key={tutor.id}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-muted/20 transition-colors"
                  onClick={() => toggleTutor(tutor.id)}
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
                </button>
              )
            })
          )}
        </ScrollArea>

        <Separator />
        <div className="px-5 py-3 shrink-0 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {localSelected.size > 0 ? (
              <span className="font-medium text-foreground">
                {localSelected.size} tutor{localSelected.size !== 1 ? "s" : ""} selected
              </span>
            ) : (
              "No tutors selected"
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleConfirm}>
              Confirm Selection
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
