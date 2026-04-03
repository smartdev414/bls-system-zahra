"use client"

import { useEffect, useState } from "react"
import { User, Edit3, Save, X, Loader2, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useFetch, usePutCallback } from "@/hooks/use-fetch"

type UserData = {
  user: {
    id: string
    name: string
    email: string
    role: string
    bslLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null
    createdAt: string
  }
}

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-100 text-emerald-700 border-emerald-200",
  INTERMEDIATE: "bg-amber-100 text-amber-700 border-amber-200",
  ADVANCED: "bg-rose-100 text-rose-700 border-rose-200",
}

export default function StudentProfilePage() {
  const { data, loading, refetch } = useFetch<UserData>("/api/user/settings", {
    errorMessage: "Could not load profile",
  })

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [bslLevel, setBslLevel] = useState("none")

  useEffect(() => {
    if (data?.user) {
      setName(data.user.name)
      setBslLevel(data.user.bslLevel ?? "none")
    }
  }, [data])

  const { execute: save, loading: saving } = usePutCallback<UserData, { name: string; bslLevel: string | null }>(
    "/api/user/settings",
    {
      successMessage: "Profile updated",
      errorMessage: "Could not update profile",
      onSuccess: () => { refetch(); setEditing(false) },
    }
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  const user = data?.user
  const initials = user?.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) ?? "?"

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">My Profile</h1>
        <p className="text-muted-foreground mt-1">Your personal information and BSL level.</p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-6">
          {/* Avatar + name */}
          <div className="flex items-center gap-5 mb-6">
            <Avatar className="size-16">
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-black">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-xl font-bold">{user?.name}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <Badge variant="secondary" className="text-xs capitalize">
                  {user?.role.toLowerCase()}
                </Badge>
                {user?.bslLevel && (
                  <Badge variant="outline" className={`text-xs ${levelColor[user.bslLevel]}`}>
                    {user.bslLevel.charAt(0) + user.bslLevel.slice(1).toLowerCase()}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <Separator className="mb-6" />

          {editing ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Full Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>BSL Level</Label>
                <Select value={bslLevel} onValueChange={setBslLevel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    <SelectItem value="BEGINNER">Beginner</SelectItem>
                    <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
                    <SelectItem value="ADVANCED">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => save({ name, bslLevel: bslLevel === "none" ? null : bslLevel as "BEGINNER" | "INTERMEDIATE" | "ADVANCED" })}
                  disabled={saving || !name.trim()}
                  size="sm"
                >
                  <Save className="size-4 mr-1.5" />
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                  <X className="size-4 mr-1.5" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Full Name</p>
                  <p className="font-medium">{user?.name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Email</p>
                  <p className="font-medium">{user?.email}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">BSL Level</p>
                  <p className="font-medium">{user?.bslLevel ? user.bslLevel.charAt(0) + user.bslLevel.slice(1).toLowerCase() : "Not specified"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Member Since</p>
                  <p className="font-medium">
                    {user?.createdAt
                      ? new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                      : "—"}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Edit3 className="size-4 mr-1.5" /> Edit Profile
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="size-4 text-primary" /> Quick Links
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {[
            { label: "My Lessons", href: "/student/lessons" },
            { label: "BSL Dictionary", href: "/student/dictionary" },
            { label: "Account Settings", href: "/student/settings" },
          ].map(({ label, href }) => (
            <a key={href} href={href} className="flex items-center gap-2 text-primary hover:underline underline-offset-2">
              <User className="size-3.5" /> {label}
            </a>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
