"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Users, Search, Filter, Loader2, ShieldCheck,
  UserCheck, Trash2, ChevronDown, Clock, Check, X,
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
import { useFetch, usePatchCallback, useDeleteCallback } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { Pagination } from "@/components/ui/pagination"
import { can, roleLabel, type AppRole } from "@/lib/permissions"

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
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
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
}: {
  user: UserItem
  onMutated: () => void
  assignableRoles: AppRole[]
  canDelete: boolean
}) {
  const initials = user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

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

  const { execute: setStatus, loading: deciding } = usePatchCallback<
    { user: UserItem },
    { status: "ACTIVE" | "REJECTED" }
  >(`/api/admin/users/${user.id}`, {
    successMessage: (d) => (d.user.status === "ACTIVE" ? `${user.name} approved` : `${user.name} not approved`),
    errorMessage: "Could not update the account",
    onSuccess: () => onMutated(),
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
        <div className="flex items-center gap-4">
          <Avatar className="size-10 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm">{user.name}</p>
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

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {user.role === "STUDENT" && user.status !== "ACTIVE" && (
              <Button
                size="sm"
                disabled={deciding}
                onClick={() => setStatus({ status: "ACTIVE" })}
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
    </Card>
  )
}
