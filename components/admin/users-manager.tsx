"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Users, Search, Filter, Loader2, ShieldCheck,
  UserCheck, Trash2, ChevronDown, Clock, Check, X, BookOpen, SlidersHorizontal, VideoOff, Video, Pencil,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useFetch, usePatchCallback, useDeleteCallback } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { Pagination } from "@/components/ui/pagination"
import { can, roleLabel, type AppRole } from "@/lib/permissions"
import { TUTOR_AREAS, type TutorAccess, type TutorArea } from "@/lib/tutor-areas"

// ─── Types ────────────────────────────────────────────────────────────────────

type UserItem = {
  id: string
  name: string
  email: string
  role: AppRole
  status: "PENDING" | "ACTIVE" | "REJECTED"
  /** What a student told us at sign-up, to help decide whether to approve. */
  signupNote: string | null
  bslLevel: string | null
  createdAt: string
  isVerified: boolean | null
  /** A teacher's switches (what they may change); null for everyone else. */
  access: TutorAccess | null
  /** A student left out of class recordings (safeguarding); null for staff. */
  recordingOptOut: boolean | null
  enrollmentCount: number
  courseCount: number
}

type UsersData = { users: UserItem[]; total: number; awaitingCount: number; page: number; totalPages: number }

/** Someone staff still have to decide on: a new student, or a tutor not yet verified. */
function isAwaiting(user: UserItem): boolean {
  return (user.role === "STUDENT" && user.status === "PENDING") || (user.role === "TUTOR" && user.isVerified === false)
}

const roleColor: Record<string, string> = {
  STUDENT: "bg-blue-100 text-blue-700 border-blue-200",
  TUTOR: "bg-violet-100 text-violet-700 border-violet-200",
  SUPPORT: "bg-amber-100 text-amber-700 border-amber-200",
  ADMIN: "bg-rose-100 text-rose-700 border-rose-200",
}

/** Roles a staff member may hand out. Only admins can create more staff — see
 *  the matching `users.assignStaffRole` check in PATCH /api/admin/users/[id]. */
const ASSIGNABLE_ROLES: Record<"admin" | "support", AppRole[]> = {
  admin: ["STUDENT", "TUTOR", "SUPPORT", "ADMIN"],
  support: ["STUDENT", "TUTOR"],
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function UsersManager({ viewerRole = "ADMIN" }: { viewerRole?: AppRole } = {}) {
  const assignableRoles = viewerRole === "ADMIN" ? ASSIGNABLE_ROLES.admin : ASSIGNABLE_ROLES.support
  const canDelete = can(viewerRole, "users.delete")
  const canSetAccess = can(viewerRole, "users.tutorAccess")
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [page, setPage] = useState(1)

  // The waiting list lives in the URL so the "waiting for approval"
  // notification can link straight to it.
  const router = useRouter()
  const pathname = usePathname()
  const showAwaiting = useSearchParams().get("status") === "pending"
  function toggleAwaiting() {
    router.replace(showAwaiting ? pathname : `${pathname}?status=pending`)
    setPage(1)
  }

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)
  if (roleFilter !== "all") params.set("role", roleFilter)
  if (showAwaiting) params.set("status", "pending")
  params.set("page", String(page))

  const { data, loading, refetch } = useFetch<UsersData>(`/api/admin/users?${params.toString()}`, {
    errorMessage: "Could not load users",
  })

  function handleRoleChange(value: string) {
    setRoleFilter(value)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Users className="size-6 text-primary" /> Users
          </h1>
          <p className="text-muted-foreground mt-1">
            {loading
              ? "\u00A0"
              : showAwaiting
                ? `${data?.total ?? 0} waiting for approval`
                : `${data?.total ?? 0} user${data?.total !== 1 ? "s" : ""} registered`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search name or email..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={handleRoleChange}>
          <SelectTrigger className="w-36">
            <Filter className="size-3.5 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="STUDENT">Students</SelectItem>
            <SelectItem value="TUTOR">Tutors</SelectItem>
            {viewerRole === "ADMIN" && <SelectItem value="SUPPORT">Support Team</SelectItem>}
            {viewerRole === "ADMIN" && <SelectItem value="ADMIN">Admins</SelectItem>}
          </SelectContent>
        </Select>
        {(showAwaiting || (data?.awaitingCount ?? 0) > 0) && (
          <Button
            variant={showAwaiting ? "default" : "outline"}
            onClick={toggleAwaiting}
            className={showAwaiting ? "" : "text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"}
          >
            <Clock className="size-3.5 mr-1.5" />
            Waiting for approval{data ? ` (${data.awaitingCount})` : ""}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data?.users.length ? (
        <div className="flex flex-col gap-2">
          {data.users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              onMutated={refetch}
              assignableRoles={assignableRoles}
              canDelete={canDelete}
              canSetAccess={canSetAccess}
            />
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Users className="size-10 text-muted-foreground" />
            <p className="font-semibold">{showAwaiting ? "Nobody is waiting for approval" : "No users found"}</p>
          </CardContent>
        </Card>
      )}

      {data && data.totalPages > 1 && (
        <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} className="mt-2" />
      )}
    </div>
  )
}

// ─── User row — owns its own mutation hooks ───────────────────────────────────

function UserRow({
  user,
  onMutated,
  assignableRoles,
  canDelete,
  canSetAccess,
}: {
  user: UserItem
  onMutated: () => void
  assignableRoles: AppRole[]
  canDelete: boolean
  canSetAccess: boolean
}) {
  const initials = user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
  const [approving, setApproving] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(user.name)

  const { execute: saveName, loading: savingName } = usePatchCallback<
    { user: UserItem },
    { name: string }
  >(`/api/admin/users/${user.id}`, {
    successMessage: "Name updated",
    // No errorMessage: the server says what's wrong with the name.
    onSuccess: () => { setEditingName(false); onMutated() },
  })

  function submitName() {
    const name = nameDraft.trim()
    if (!name || name === user.name) { setEditingName(false); setNameDraft(user.name); return }
    saveName({ name })
  }

  const { execute: updateRole } = usePatchCallback<
    { user: UserItem },
    { role: AppRole }
  >(`/api/admin/users/${user.id}`, {
    successMessage: "Role updated",
    errorMessage: "Could not update role",
    onSuccess: () => onMutated(),
  })

  const { execute: toggleVerified } = usePatchCallback<
    { user: UserItem },
    { isVerified: boolean }
  >(`/api/admin/users/${user.id}`, {
    successMessage: (d) => `Tutor ${(d as { user: { tutorProfile?: { isVerified: boolean } } }).user.tutorProfile?.isVerified ? "verified" : "unverified"}`,
    errorMessage: "Could not update verification",
    onSuccess: () => onMutated(),
  })

  const { execute: setRecordingOptOut, loading: savingOptOut } = usePatchCallback<
    { user: { recordingOptOut: boolean } },
    { recordingOptOut: boolean }
  >(`/api/admin/users/${user.id}`, {
    successMessage: (d) => d.user.recordingOptOut
      ? `${user.name} is left out of class recordings`
      : `${user.name} can be in class recordings again`,
    errorMessage: "Could not update",
    onSuccess: () => onMutated(),
  })

  const { execute: setStatus, loading: deciding } = usePatchCallback<
    { user: UserItem },
    { status: "ACTIVE" | "REJECTED"; courseIds?: string[] }
  >(`/api/admin/users/${user.id}`, {
    successMessage: (d) => (d.user.status === "ACTIVE" ? `${user.name} approved` : `${user.name} not approved`),
    errorMessage: "Could not update the account",
    onSuccess: () => { setApproving(false); onMutated() },
  })

  const { execute: deleteUser, loading: deleting } = useDeleteCallback(
    `/api/admin/users/${user.id}`,
    {
      successMessage: "User deleted",
      // No errorMessage: the server explains why (e.g. the tutor still owns courses).
      onSuccess: () => onMutated(),
    }
  )

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="size-10 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {editingName ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => { e.preventDefault(); submitName() }}
                >
                  <Input
                    autoFocus
                    value={nameDraft}
                    maxLength={100}
                    disabled={savingName}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") { setEditingName(false); setNameDraft(user.name) } }}
                    className="h-8 w-56 text-sm"
                    aria-label="Name"
                  />
                  <Button type="submit" size="icon" className="size-8" disabled={savingName} title="Save name">
                    {savingName ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  </Button>
                  <Button
                    type="button" variant="ghost" size="icon" className="size-8" disabled={savingName} title="Cancel"
                    onClick={() => { setEditingName(false); setNameDraft(user.name) }}
                  >
                    <X className="size-3.5" />
                  </Button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => { setNameDraft(user.name); setEditingName(true) }}
                  className="group flex items-center gap-1.5 font-semibold text-sm hover:text-primary"
                  title="Edit name"
                >
                  {user.name}
                  <Pencil className="size-3 text-muted-foreground group-hover:text-primary" />
                </button>
              )}
              <Badge variant="outline" className={`text-[10px] ${roleColor[user.role]}`}>
                {roleLabel(user.role)}
              </Badge>
              {user.role === "TUTOR" && user.isVerified && (
                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                  <UserCheck className="size-2.5 mr-1" /> Verified
                </Badge>
              )}
              {isAwaiting(user) && (
                <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                  <Clock className="size-2.5 mr-1" /> Waiting for approval
                </Badge>
              )}
              {user.recordingOptOut && (
                <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-700 border-slate-300">
                  <VideoOff className="size-2.5 mr-1" /> Not recorded
                </Badge>
              )}
              {user.role === "STUDENT" && user.status === "REJECTED" && (
                <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">
                  Not approved
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{user.email}</p>
            {user.signupNote && (
              <p className="text-xs mt-1 italic text-foreground/80 break-words">&ldquo;{user.signupNote}&rdquo;</p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              {user.role === "STUDENT" && <span>{user.enrollmentCount} enrolled</span>}
              {user.role === "TUTOR" && <span>{user.courseCount} courses</span>}
              <span>Joined {new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            </div>
          </div>

          {/* Actions — on their own line on a phone */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:shrink-0">
            {user.role === "STUDENT" && user.status !== "ACTIVE" && (
              <Button
                size="sm"
                disabled={deciding}
                onClick={() => setApproving(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Check className="size-3.5 mr-1" /> Approve
              </Button>
            )}
            {user.role === "STUDENT" && user.status === "PENDING" && (
              <Button
                variant="outline"
                size="sm"
                disabled={deciding}
                className="text-destructive border-destructive/30"
                onClick={() => {
                  if (window.confirm(`Turn down ${user.name}? They won't be able to use the platform, and we'll email them to say so.`)) {
                    setStatus({ status: "REJECTED" })
                  }
                }}
              >
                <X className="size-3.5 mr-1" /> Reject
              </Button>
            )}
            {user.role === "TUTOR" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleVerified({ isVerified: !user.isVerified })}
                className={user.isVerified ? "text-amber-600 border-amber-200" : "text-emerald-600 border-emerald-200"}
              >
                <ShieldCheck className="size-3.5 mr-1" />
                {user.isVerified ? "Unverify" : "Approve"}
              </Button>
            )}

            {user.role === "STUDENT" && user.recordingOptOut !== null && (
              // Safeguarding: keeps this student's face out of every class
              // recording. The student can't turn it back off themselves.
              <Button
                variant="outline"
                size="sm"
                disabled={savingOptOut}
                title={user.recordingOptOut ? "Let this student appear in class recordings again" : "Keep this student's face out of class recordings"}
                onClick={() => setRecordingOptOut({ recordingOptOut: !user.recordingOptOut })}
              >
                {user.recordingOptOut
                  ? <><Video className="size-3.5 mr-1" /> Allow recording</>
                  : <><VideoOff className="size-3.5 mr-1" /> Don&apos;t record</>}
              </Button>
            )}

            {user.role === "TUTOR" && user.access && canSetAccess && (
              <Button variant="outline" size="sm" onClick={() => setAccessOpen(true)}>
                <SlidersHorizontal className="size-3.5 mr-1" /> Access
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Role <ChevronDown className="size-3.5 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {assignableRoles.map((role) => (
                  <DropdownMenuItem
                    key={role}
                    disabled={user.role === role}
                    onSelect={() => updateRole({ role })}
                  >
                    {roleLabel(role)}
                    {user.role === role && " (current)"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                disabled={deleting}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${user.name} (${user.email})? Their enrolments, certificates, messages and reviews are removed too. This cannot be undone.`
                    )
                  ) {
                    deleteUser()
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
      {approving && (
        <ApproveDialog
          user={user}
          saving={deciding}
          onApprove={(courseIds) => setStatus({ status: "ACTIVE", courseIds })}
          onClose={() => setApproving(false)}
        />
      )}
      {accessOpen && user.access && (
        // The list reloads once the dialog closes; reloading after each switch
        // would unmount this row and close the dialog mid-way.
        <AccessDialog user={user} access={user.access} onClose={() => { setAccessOpen(false); onMutated() }} />
      )}
    </Card>
  )
}

// ─── Approve — and put them on their course in the same step ─────────────────

type CourseOption = { id: string; title: string; level: string | null; status: string; enrollmentCount: number }

function ApproveDialog({ user, saving, onApprove, onClose }: {
  user: UserItem
  saving: boolean
  onApprove: (courseIds: string[]) => void
  onClose: () => void
}) {
  const { data, loading } = useFetch<{ courses: CourseOption[] }>("/api/admin/courses?status=published&limit=100", {
    errorMessage: "Could not load courses",
  })
  const [picked, setPicked] = useState<string[]>([])
  const courses = data?.courses ?? []

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve {user.name}</DialogTitle>
          <DialogDescription>Tick the course they&apos;re joining and they&apos;ll be on it as soon as they sign in.</DialogDescription>
        </DialogHeader>
        {user.signupNote && (
          <p className="text-sm italic rounded-lg bg-muted/50 px-3 py-2 break-words">&ldquo;{user.signupNote}&rdquo;</p>
        )}
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-primary" /></div>
        ) : courses.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No published courses yet — you can add them to one later.</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            {courses.map((c) => {
              const on = picked.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    on ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded border ${
                    on ? "bg-primary border-primary text-primary-foreground" : "border-input"
                  }`}>
                    {on && <Check className="size-3.5" />}
                  </span>
                  <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{c.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.enrollmentCount} student{c.enrollmentCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={() => onApprove(picked)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Check className="size-4 mr-1.5" />}
            {picked.length === 0
              ? "Approve"
              : `Approve & add to ${picked.length === 1 ? "course" : `${picked.length} courses`}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Access — what one teacher may change ────────────────────────────────────

function AccessDialog({ user, access, onClose }: {
  user: UserItem
  access: TutorAccess
  onClose: () => void
}) {
  // Each switch saves as it is tapped; the list shows the saved state.
  const [current, setCurrent] = useState(access)
  const { execute: save, loading: saving } = usePatchCallback<
    { user: { access: TutorAccess | null } },
    { access: Partial<TutorAccess> }
  >(`/api/admin/users/${user.id}`, {
    errorMessage: "Could not save",
    successMessage: false,
    onSuccess: (d) => { if (d.user.access) setCurrent(d.user.access) },
    // Put the switch back the way it was saved.
    onError: (_e, body) => setCurrent((c) => {
      const next = { ...c }
      for (const a of Object.keys(body.access) as TutorArea[]) next[a] = !body.access[a]
      return next
    }),
  })

  function toggle(area: TutorArea) {
    setCurrent((c) => ({ ...c, [area]: !c[area] }))
    save({ access: { [area]: !current[area] } })
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What {user.name} can change</DialogTitle>
          <DialogDescription>
            Off means view only. They can always teach their classes, upload and record their own videos, and write captions.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {TUTOR_AREAS.map(({ area, label, hint }) => {
            const on = current[area]
            return (
              <button
                key={area}
                type="button"
                role="switch"
                aria-checked={on}
                disabled={saving}
                onClick={() => toggle(area)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  on ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
                <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-input"}`}>
                  <span className={`absolute top-0.5 size-4 rounded-full bg-background shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                </span>
              </button>
            )
          })}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
