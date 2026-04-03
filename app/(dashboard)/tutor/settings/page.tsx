"use client"

import { useEffect, useState } from "react"
import { User, Lock, Loader2, Save, Eye, EyeOff, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { useFetch, usePutCallback } from "@/hooks/use-fetch"

// ─── Types ────────────────────────────────────────────────────────────────────

type UserData = {
  user: {
    id: string
    name: string
    email: string
    role: string
    avatarUrl: string | null
    bslLevel: string | null
    createdAt: string
    tutorProfile: { bio: string | null; qualifications: string[]; isVerified: boolean } | null
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorSettingsPage() {
  const { data, loading, refetch } = useFetch<UserData>("/api/user/settings", {
    errorMessage: "Could not load settings",
  })

  const [name, setName] = useState("")
  const [bio, setBio] = useState("")
  const [qualifications, setQualifications] = useState<string[]>([])
  const [newQual, setNewQual] = useState("")

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    if (data?.user) {
      setName(data.user.name)
      setBio(data.user.tutorProfile?.bio ?? "")
      setQualifications(data.user.tutorProfile?.qualifications ?? [])
    }
  }, [data])

  const { execute: saveProfile, loading: savingProfile } = usePutCallback<
    UserData,
    { name: string; bio: string; qualifications: string[] }
  >("/api/user/settings", {
    successMessage: "Profile updated",
    errorMessage: "Could not update profile",
    onSuccess: () => refetch(),
  })

  const { execute: savePassword, loading: savingPassword } = usePutCallback<
    { message: string },
    { currentPassword: string; newPassword: string }
  >("/api/user/password", {
    successMessage: "Password changed successfully",
    errorMessage: "Could not change password",
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); setConfirmPassword("") },
  })

  function addQualification() {
    const trimmed = newQual.trim()
    if (trimmed && !qualifications.includes(trimmed)) {
      setQualifications((prev) => [...prev, trimmed])
      setNewQual("")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Account Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your tutor profile and account.</p>
      </div>

      {/* Profile */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4 text-primary" /> Tutor Profile
          </CardTitle>
          <CardDescription>This information is visible to your students.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              saveProfile({ name, bio, qualifications })
            }}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <div className="flex items-center gap-2">
                <Input value={data?.user.email ?? ""} disabled className="bg-muted" />
                {data?.user.tutorProfile?.isVerified && (
                  <Badge variant="outline" className="shrink-0 text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                    Verified
                  </Badge>
                )}
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                placeholder="Tell students about your BSL experience and background..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
              />
            </div>

            {/* Qualifications */}
            <div className="flex flex-col gap-2">
              <Label>Qualifications</Label>
              <div className="flex flex-wrap gap-2">
                {qualifications.map((q) => (
                  <Badge key={q} variant="outline" className="gap-1.5 pr-1">
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
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addQualification())}
                />
                <Button type="button" variant="outline" size="sm" onClick={addQualification}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>

            <Button type="submit" disabled={savingProfile || !name.trim()} className="self-start">
              <Save className="size-4 mr-1.5" />
              {savingProfile ? "Saving..." : "Save Profile"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="size-4 text-primary" /> Change Password
          </CardTitle>
          <CardDescription>Use a strong password with at least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              savePassword({ currentPassword, newPassword })
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label>Current Password</Label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required className="pr-10"
                />
                <button type="button" onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>New Password</Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8} required className="pr-10"
                />
                <button type="button" onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={savingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword || newPassword.length < 8}
              className="self-start"
            >
              <Lock className="size-4 mr-1.5" />
              {savingPassword ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Account info */}
      <Card className="shadow-sm">
        <CardHeader><CardTitle className="text-base">Account Information</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Account type</span>
            <Badge variant="outline">{data?.user.role}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Member since</span>
            <span className="font-medium">
              {data?.user.createdAt
                ? new Date(data.user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                : "—"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
