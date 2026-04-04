"use client"

import { useState } from "react"
import {
  Users, Search, Filter, Loader2, ShieldCheck,
  UserCheck, Trash2, ChevronDown,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type UserItem = {
  id: string
  name: string
  email: string
  role: "STUDENT" | "TUTOR" | "ADMIN"
  bslLevel: string | null
  createdAt: string
  isVerified: boolean | null
  enrollmentCount: number
  courseCount: number
}

type UsersData = { users: UserItem[]; total: number; page: number; totalPages: number }

const roleColor: Record<string, string> = {
  STUDENT: "bg-blue-100 text-blue-700 border-blue-200",
  TUTOR: "bg-violet-100 text-violet-700 border-violet-200",
  ADMIN: "bg-rose-100 text-rose-700 border-rose-200",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [page, setPage] = useState(1)

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)
  if (roleFilter !== "all") params.set("role", roleFilter)
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
            {loading ? "\u00A0" : `${data?.total ?? 0} user${data?.total !== 1 ? "s" : ""} registered`}
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
            <SelectItem value="ADMIN">Admins</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data?.users.length ? (
        <div className="flex flex-col gap-2">
          {data.users.map((user) => (
            <UserRow key={user.id} user={user} onMutated={refetch} />
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Users className="size-10 text-muted-foreground" />
            <p className="font-semibold">No users found</p>
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

function UserRow({ user, onMutated }: { user: UserItem; onMutated: () => void }) {
  const initials = user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

  const { execute: updateRole } = usePatchCallback<
    { user: UserItem },
    { role: "STUDENT" | "TUTOR" | "ADMIN" }
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

  const { execute: deleteUser, loading: deleting } = useDeleteCallback(
    `/api/admin/users/${user.id}`,
    {
      successMessage: "User deleted",
      errorMessage: "Could not delete user",
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
                {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
              </Badge>
              {user.role === "TUTOR" && user.isVerified && (
                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                  <UserCheck className="size-2.5 mr-1" /> Verified
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{user.email}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              {user.role === "STUDENT" && <span>{user.enrollmentCount} enrolled</span>}
              {user.role === "TUTOR" && <span>{user.courseCount} courses</span>}
              <span>Joined {new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {user.role === "TUTOR" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleVerified({ isVerified: !user.isVerified })}
                className={user.isVerified ? "text-amber-600 border-amber-200" : "text-emerald-600 border-emerald-200"}
              >
                <ShieldCheck className="size-3.5 mr-1" />
                {user.isVerified ? "Unverify" : "Verify"}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Role <ChevronDown className="size-3.5 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(["STUDENT", "TUTOR", "ADMIN"] as const).map((role) => (
                  <DropdownMenuItem
                    key={role}
                    disabled={user.role === role}
                    onSelect={() => updateRole({ role })}
                  >
                    {role.charAt(0) + role.slice(1).toLowerCase()}
                    {user.role === role && " (current)"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive"
              disabled={deleting}
              onClick={() => deleteUser()}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
