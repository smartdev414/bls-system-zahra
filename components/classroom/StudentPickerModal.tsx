"use client"

import { useState, useMemo } from "react"
import {
  Search, Check, Loader2, Users, ChevronRight, ChevronDown, X,
} from "lucide-react"
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
import { useDebounce } from "@/hooks/use-debounce"

type Student = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

type Group = {
  id: string
  name: string
  // Whose group it is — only sent to staff, who see every tutor's groups.
  tutorName?: string
  members: Student[]
}

type StudentsData = { students: Student[] }
type GroupsData = { groups: Group[] }

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

/**
 * A multi-select student picker modal that works without a session ID.
 * Used in the "new session" form to pre-select invitees before creation, and on
 * the course page to put students (or a whole group) onto a course.
 */
export function StudentPickerModal({
  selected,
  onConfirm,
  onClose,
  title = "Select Students to Invite",
  description = "Choose individual students or pick a whole group.",
  confirmLabel = "Confirm Selection",
  excludeIds,
  confirming = false,
  hideGroups = false,
}: {
  selected: Set<string>
  onConfirm: (ids: Set<string>, students: Student[]) => void
  onClose: () => void
  title?: string
  description?: string
  confirmLabel?: string
  /** Students to leave out entirely — e.g. the ones already on the course. */
  excludeIds?: Set<string>
  /** The caller is saving the selection; hold the modal open and block a second submit. */
  confirming?: boolean
  /** Individual students only — for when whole groups are added another way. */
  hideGroups?: boolean
}) {
  const { data: studentsData } = useFetch<StudentsData>("/api/tutor/students")
  const { data: groupsData } = useFetch<GroupsData>("/api/tutor/groups")

  const [search, setSearch] = useState("")
  // The list above is the students this person already works with. Typing a
  // name also looks through every student, so somebody new can be found.
  const debouncedSearch = useDebounce(search.trim())
  const { data: searchData } = useFetch<StudentsData>(
    `/api/tutor/students/search?q=${encodeURIComponent(debouncedSearch)}`,
    { immediate: debouncedSearch.length >= 2, errorMessage: false },
  )
  // Students ticked from a search, kept so they survive the search being cleared.
  const [found, setFound] = useState<Map<string, Student>>(new Map())
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set(selected))
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const allStudents = useMemo(
    () => (studentsData?.students ?? []).filter((s) => !excludeIds?.has(s.id)),
    [studentsData, excludeIds]
  )
  const groups = useMemo(
    () => (groupsData?.groups ?? []).map((g) => ({
      ...g,
      members: g.members.filter((m) => !excludeIds?.has(m.id)),
    })),
    [groupsData, excludeIds]
  )

  const filtered = useMemo(() => {
    if (!search.trim()) return allStudents
    const q = search.trim().toLowerCase()
    const matches = (s: Student) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
    const local = allStudents.filter(matches)
    const seen = new Set(local.map((s) => s.id))
    const extra = (debouncedSearch.length >= 2 ? searchData?.students ?? [] : []).filter(
      (s) => !seen.has(s.id) && !excludeIds?.has(s.id) && matches(s),
    )
    return [...local, ...extra]
  }, [allStudents, search, debouncedSearch, searchData, excludeIds])

  function toggleStudent(id: string) {
    const student = filtered.find((s) => s.id === id)
    if (student) setFound((prev) => new Map(prev).set(id, student))
    setLocalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectGroup(group: Group) {
    const ids = group.members.map((m) => m.id)
    const allSelected = ids.every((id) => localSelected.has(id))
    setLocalSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        ids.forEach((id) => next.delete(id))
      } else {
        ids.forEach((id) => next.add(id))
      }
      return next
    })
  }

  function toggleGroupExpand(groupId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  function selectAll() {
    const allIds = filtered.map((s) => s.id)
    const allAreSelected = allIds.every((id) => localSelected.has(id))
    setFound((prev) => {
      const next = new Map(prev)
      filtered.forEach((s) => next.set(s.id, s))
      return next
    })
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
    const known = new Map<string, Student>(found)
    groups.forEach((g) => g.members.forEach((m) => known.set(m.id, m)))
    allStudents.forEach((s) => known.set(s.id, s))
    const selectedStudents = [...localSelected].flatMap((id) => (known.has(id) ? [known.get(id)!] : []))
    onConfirm(localSelected, selectedStudents)
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => localSelected.has(s.id))

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg flex flex-col gap-0 p-0 h-[80vh]">
        <DialogHeader className="px-5 pt-5 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-primary" /> {title}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {description}
          </p>
        </DialogHeader>

        <Separator />

        <div className="px-4 py-3 border-b shrink-0 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search all students by name or email..."
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
          {/* Groups section */}
          {!hideGroups && groups.length > 0 && !search.trim() && (
            <div>
              <div className="px-4 py-2 bg-muted/30 sticky top-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Groups</p>
              </div>
              {groups.map((group) => {
                const groupSelected = group.members.length > 0 && group.members.every((m) => localSelected.has(m.id))
                const groupPartial = !groupSelected && group.members.some((m) => localSelected.has(m.id))
                const isExpanded = expandedGroups.has(group.id)

                return (
                  <div key={group.id}>
                    <div className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/20">
                      <button
                        className={`size-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          groupSelected
                            ? "bg-primary border-primary"
                            : groupPartial
                            ? "bg-primary/30 border-primary/60"
                            : "border-muted-foreground/40 hover:border-primary"
                        }`}
                        onClick={() => selectGroup(group)}
                        disabled={group.members.length === 0}
                      >
                        {(groupSelected || groupPartial) && <Check className="size-2.5 text-white" />}
                      </button>
                      <button
                        className="flex-1 flex items-center gap-2 text-left"
                        onClick={() => toggleGroupExpand(group.id)}
                      >
                        <span className="text-sm font-medium">{group.name}</span>
                        {group.tutorName && (
                          <span className="text-xs text-muted-foreground truncate">{group.tutorName}</span>
                        )}
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {group.members.length} student{group.members.length !== 1 ? "s" : ""}
                        </Badge>
                        {isExpanded
                          ? <ChevronDown className="size-3.5 text-muted-foreground ml-auto" />
                          : <ChevronRight className="size-3.5 text-muted-foreground ml-auto" />}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="border-l-2 border-primary/20 ml-8 mb-1">
                        {group.members.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-4 py-2">No members in this group.</p>
                        ) : group.members.map((member) => {
                          const isSelected = localSelected.has(member.id)
                          return (
                            <button
                              key={member.id}
                              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors"
                              onClick={() => toggleStudent(member.id)}
                            >
                              <div className={`size-3.5 rounded border flex items-center justify-center shrink-0 ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                                {isSelected && <Check className="size-2 text-white" />}
                              </div>
                              <Avatar className="size-5 shrink-0">
                                <AvatarFallback className="bg-primary/10 text-primary text-[8px]">{initials(member.name)}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">{member.name}</p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              <Separator className="my-1" />
            </div>
          )}

          {/* All students */}
          <div>
            {((!hideGroups && groups.length > 0) || !search.trim()) && (
              <div className="px-4 py-2 bg-muted/30 sticky top-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {search.trim() ? "Search Results" : "All Students"}
                </p>
              </div>
            )}
            {studentsData === null ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No students found.</p>
            ) : (
              filtered.map((student) => {
                const isSelected = localSelected.has(student.id)
                return (
                  <button
                    key={student.id}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-muted/20 transition-colors"
                    onClick={() => toggleStudent(student.id)}
                  >
                    <div className={`size-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 hover:border-primary"
                    }`}>
                      {isSelected && <Check className="size-2.5 text-white" />}
                    </div>
                    <Avatar className="size-7 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary text-[10px]">{initials(student.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{student.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>

        <Separator />
        <div className="px-5 py-3 shrink-0 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {localSelected.size > 0 ? (
              <span className="font-medium text-foreground">
                {localSelected.size} student{localSelected.size !== 1 ? "s" : ""} selected
              </span>
            ) : (
              "No students selected"
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={confirming}>Cancel</Button>
            <Button size="sm" onClick={handleConfirm} disabled={confirming}>
              {confirming && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
