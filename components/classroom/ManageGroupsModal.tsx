"use client"

import { useState, useMemo } from "react"
import {
  Users, Plus, Trash2, Search, X, Check, Loader2, Pencil, FolderOpen,
} from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { useFetch } from "@/hooks/use-fetch"
import { toast } from "sonner"
import { useTutorAccess } from "@/components/tutor-access-provider"
import { VIEW_ONLY_MESSAGE } from "@/lib/tutor-areas"

type StudentMember = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

type Group = {
  id: string
  name: string
  createdAt: string
  // False for a group the office set up, shown to a tutor to use but not change.
  canEdit?: boolean
  members: StudentMember[]
}

type Student = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

type GroupsData = { groups: Group[] }
type StudentsData = { students: Student[] }

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

export function ManageGroupsModal({ onClose }: { onClose: () => void }) {
  // A teacher an admin has made view only for groups can look but not change.
  const canEditGroups = useTutorAccess().groups
  const { data: groupsData, refetch: refetchGroups, loading: groupsLoading } = useFetch<GroupsData>("/api/tutor/groups")
  const { data: studentsData } = useFetch<StudentsData>("/api/tutor/students")

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [creating, setCreating] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [memberSearch, setMemberSearch] = useState("")
  const [busy, setBusy] = useState(false)

  const groups = groupsData?.groups ?? []
  const allStudents = studentsData?.students ?? []

  // Sync selectedGroup with fresh data after refetch
  const syncedGroup = useMemo(() => {
    if (!selectedGroup) return null
    return groups.find((g) => g.id === selectedGroup.id) ?? null
  }, [groups, selectedGroup])

  const currentGroup = syncedGroup
  const schoolGroup = currentGroup?.canEdit === false
  const readOnly = !canEditGroups || schoolGroup

  const nonMembers = useMemo(() => {
    if (!currentGroup) return []
    const memberIds = new Set(currentGroup.members.map((m) => m.id))
    return allStudents.filter((s) => !memberIds.has(s.id))
  }, [currentGroup, allStudents])

  const filteredNonMembers = memberSearch
    ? nonMembers.filter((s) =>
        s.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
        s.email.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : nonMembers

  async function createGroup() {
    if (!newGroupName.trim()) return
    setBusy(true)
    try {
      const res = await fetch("/api/tutor/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGroupName.trim() }),
      })
      if (!res.ok) throw new Error("Failed to create group")
      await refetchGroups()
      setNewGroupName("")
      setCreating(false)
      toast.success("Group created")
    } catch {
      toast.error("Could not create group")
    } finally {
      setBusy(false)
    }
  }

  async function deleteGroup(groupId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/tutor/groups/${groupId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete group")
      if (selectedGroup?.id === groupId) setSelectedGroup(null)
      await refetchGroups()
      toast.success("Group deleted")
    } catch {
      toast.error("Could not delete group")
    } finally {
      setBusy(false)
    }
  }

  async function renameGroup(groupId: string) {
    if (!renameValue.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/tutor/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      })
      if (!res.ok) throw new Error("Failed to rename group")
      await refetchGroups()
      setRenamingId(null)
      setRenameValue("")
      toast.success("Group renamed")
    } catch {
      toast.error("Could not rename group")
    } finally {
      setBusy(false)
    }
  }

  async function addMember(studentId: string) {
    if (!currentGroup) return
    setBusy(true)
    try {
      const res = await fetch(`/api/tutor/groups/${currentGroup.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: [studentId] }),
      })
      if (!res.ok) throw new Error("Failed to add member")
      await refetchGroups()
    } catch {
      toast.error("Could not add member")
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(studentId: string) {
    if (!currentGroup) return
    setBusy(true)
    try {
      const res = await fetch(`/api/tutor/groups/${currentGroup.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: [studentId] }),
      })
      if (!res.ok) throw new Error("Failed to remove member")
      await refetchGroups()
    } catch {
      toast.error("Could not remove member")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="size-5 text-primary" /> {canEditGroups ? "Manage Student Groups" : "Student Groups"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {canEditGroups ? "Create groups to quickly invite multiple students at once." : VIEW_ONLY_MESSAGE.groups}
          </p>
        </DialogHeader>

        <Separator />

        <div className="flex flex-1 min-h-0">
          {/* Left panel: groups list */}
          <div className="w-56 border-r flex flex-col shrink-0 min-h-0">
            <div className="px-3 py-2 border-b">
              <p className="text-[0.625rem] font-bold uppercase tracking-wider text-muted-foreground">Groups</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {groupsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-5 animate-spin text-primary" />
                </div>
              ) : groups.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6 px-3">No groups yet.</p>
              ) : (
                <div className="py-1">
                  {groups.map((group) => (
                    <div key={group.id} className="group/row">
                      {renamingId === group.id ? (
                        <div className="flex items-center gap-1 px-2 py-1.5">
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="h-6 text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") renameGroup(group.id)
                              if (e.key === "Escape") { setRenamingId(null); setRenameValue("") }
                            }}
                          />
                          <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={() => renameGroup(group.id)} disabled={busy}>
                            <Check className="size-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={() => { setRenamingId(null); setRenameValue("") }}>
                            <X className="size-3" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors ${currentGroup?.id === group.id ? "bg-primary/10 text-primary font-medium" : ""}`}
                          onClick={() => setSelectedGroup(group)}
                        >
                          <span className="flex-1 truncate">{group.name}</span>
                          <Badge variant="secondary" className="shrink-0 text-[0.625rem] h-4 px-1">{group.members.length}</Badge>
                          <span className={!canEditGroups || group.canEdit === false ? "hidden" : "hidden group-hover/row:flex items-center gap-0.5 shrink-0"}>
                            <span
                              role="button"
                              className="p-0.5 rounded hover:bg-muted cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); setRenamingId(group.id); setRenameValue(group.name) }}
                            >
                              <Pencil className="size-2.5 text-muted-foreground" />
                            </span>
                            <span
                              role="button"
                              className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); deleteGroup(group.id) }}
                            >
                              <Trash2 className="size-2.5 text-destructive" />
                            </span>
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Create group */}
            {canEditGroups && <div className="border-t p-2">
              {creating ? (
                <div className="flex flex-col gap-1.5">
                  <Input
                    placeholder="Group name..."
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="h-7 text-xs"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createGroup()
                      if (e.key === "Escape") { setCreating(false); setNewGroupName("") }
                    }}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" className="h-6 text-xs flex-1" onClick={createGroup} disabled={!newGroupName.trim() || busy}>
                      {busy ? <Loader2 className="size-3 animate-spin" /> : "Create"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setCreating(false); setNewGroupName("") }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1" onClick={() => setCreating(true)}>
                  <Plus className="size-3" /> New Group
                </Button>
              )}
            </div>}
          </div>

          {/* Right panel: group members */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {!currentGroup ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center px-6">
                <div className="rounded-full bg-muted p-4">
                  <Users className="size-8 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">Select a group</p>
                <p className="text-xs text-muted-foreground">Choose a group from the left to {canEditGroups ? "manage" : "see"} its members.</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b shrink-0">
                  <p className="font-semibold text-sm">{currentGroup.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {currentGroup.members.length} member{currentGroup.members.length !== 1 ? "s" : ""}
                    {schoolGroup && " · Set up by the school — you can invite this group to a class, but not change it"}
                  </p>
                </div>

                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  {/* Current members */}
                  {currentGroup.members.length > 0 && (
                    <div className="shrink-0 max-h-[30%] overflow-y-auto overscroll-contain border-b">
                      <div className="px-4 py-1.5 bg-muted/30">
                        <p className="text-[0.625rem] font-bold uppercase tracking-wider text-muted-foreground">Members</p>
                      </div>
                      {currentGroup.members.map((member) => (
                        <div key={member.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/20 group/member">
                          <Avatar className="size-6 shrink-0">
                            <AvatarFallback className="bg-primary/10 text-primary text-[0.5625rem]">{initials(member.name)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{member.name}</p>
                            <p className="text-[0.625rem] text-muted-foreground truncate">{member.email}</p>
                          </div>
                          {!readOnly && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6 shrink-0 opacity-100 md:opacity-0 md:group-hover/member:opacity-100 text-destructive hover:text-destructive"
                              disabled={busy}
                              onClick={() => removeMember(member.id)}
                            >
                              <X className="size-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add students */}
                  {!readOnly && <div className="flex flex-col flex-1 min-h-0">
                    <div className="px-4 py-2 border-b shrink-0">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                        <Input
                          placeholder="Search students to add..."
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          className="pl-7 h-7 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                      {filteredNonMembers.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">
                          {nonMembers.length === 0 ? "All students are already in this group." : "No students match your search."}
                        </p>
                      ) : (
                        filteredNonMembers.map((student) => (
                          <div key={student.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/20 group/add">
                            <Avatar className="size-6 shrink-0">
                              <AvatarFallback className="bg-primary/10 text-primary text-[0.5625rem]">{initials(student.name)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{student.name}</p>
                              <p className="text-[0.625rem] text-muted-foreground truncate">{student.email}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[0.625rem] px-2 gap-1 shrink-0"
                              disabled={busy}
                              onClick={() => addMember(student.id)}
                            >
                              <Plus className="size-2.5" /> Add
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
