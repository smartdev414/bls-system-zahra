"use client"

import { useEffect, useState } from "react"
import { Edit3, Save, X, Loader2, BookOpen, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { useFetch, usePutCallback } from "@/hooks/use-fetch"

type UserData = {
  user: {
    id: string
    name: string
    email: string
    role: string
    createdAt: string
    tutorProfile: {
      bio: string | null
      qualifications: string[]
      isVerified: boolean
    } | null
  }
}

export default function TutorProfilePage() {
  const { data, loading, refetch } = useFetch<UserData>("/api/user/settings", {
    errorMessage: "Could not load profile",
  })

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [bio, setBio] = useState("")
  const [qualifications, setQualifications] = useState<string[]>([])
  const [newQual, setNewQual] = useState("")

  useEffect(() => {
    if (data?.user) {
      setName(data.user.name)
      setBio(data.user.tutorProfile?.bio ?? "")
      setQualifications(data.user.tutorProfile?.qualifications ?? [])
    }
  }, [data])

  const { execute: save, loading: saving } = usePutCallback<
    UserData,
    { name: string; bio: string; qualifications: string[] }
  >("/api/user/settings", {
    successMessage: "Profile updated",
    errorMessage: "Could not update profile",
    onSuccess: () => { refetch(); setEditing(false) },
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  const user = data?.user
  const initials = user?.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) ?? "?"

  function addQual() {
    const q = newQual.trim()
    if (q && !qualifications.includes(q)) {
      setQualifications((prev) => [...prev, q])
      setNewQual("")
    }
  }

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">My Profile</h1>
        <p className="text-muted-foreground mt-1">Your public tutor profile visible to students.</p>
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
              <div className="flex items-center gap-2">
                <p className="text-xl font-bold">{user?.name}</p>
                {user?.tutorProfile?.isVerified && (
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs" variant="outline">
                    Verified
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <Badge variant="secondary" className="mt-1.5 text-xs capitalize">
                {user?.role.toLowerCase()}
              </Badge>
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
                <Label>Bio</Label>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  placeholder="Tell students about yourself..."
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Qualifications</Label>
                <div className="flex flex-wrap gap-2">
                  {qualifications.map((q) => (
                    <Badge key={q} variant="outline" className="gap-1.5 pr-1.5">
                      {q}
                      <button
                        type="button"
                        onClick={() => setQualifications((prev) => prev.filter((x) => x !== q))}
                        className="hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. CACDP Level 3"
                    value={newQual}
                    onChange={(e) => setNewQual(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addQual())}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addQual}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => save({ name, bio, qualifications })} disabled={saving || !name.trim()} size="sm">
                  <Save className="size-4 mr-1.5" />
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                  <X className="size-4 mr-1.5" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Full Name</p>
                  <p className="font-medium">{user?.name}</p>
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

              {user?.tutorProfile?.bio && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Bio</p>
                  <p className="text-sm leading-relaxed">{user.tutorProfile.bio}</p>
                </div>
              )}

              {user?.tutorProfile?.qualifications?.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Qualifications</p>
                  <div className="flex flex-wrap gap-2">
                    {user.tutorProfile.qualifications.map((q) => (
                      <Badge key={q} variant="outline">{q}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}

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
            { label: "My Courses", href: "/tutor/courses" },
            { label: "Live Sessions", href: "/tutor/sessions" },
            { label: "My Students", href: "/tutor/students" },
            { label: "Account Settings", href: "/tutor/settings" },
          ].map(({ label, href }) => (
            <a key={href} href={href} className="text-primary hover:underline underline-offset-2">
              {label}
            </a>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
