"use client"

import { useEffect, useState } from "react"
import { User, Lock, Loader2, Save, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
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
    bslLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null
    createdAt: string
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data, loading, refetch } = useFetch<UserData>("/api/user/settings", {
    errorMessage: "Could not load settings",
  })

  // Profile form
  const [name, setName] = useState("")
  const [bslLevel, setBslLevel] = useState<string>("none")

  // Password form
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    if (data?.user) {
      setName(data.user.name)
      setBslLevel(data.user.bslLevel ?? "none")
    }
  }, [data])

  const { execute: saveProfile, loading: savingProfile } = usePutCallback<UserData, { name: string; bslLevel: string | null }>(
    "/api/user/settings",
    {
      successMessage: "Profile updated",
      errorMessage: "Could not update profile",
      onSuccess: () => refetch(),
    }
  )

  const { execute: savePassword, loading: savingPassword } = usePutCallback<{ message: string }, { currentPassword: string; newPassword: string }>(
    "/api/user/password",
    {
      successMessage: "Password changed successfully",
      errorMessage: "Could not change password",
      onSuccess: () => {
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
      },
    }
  )

  function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault()
    saveProfile({ name, bslLevel: bslLevel === "none" ? null : bslLevel as "BEGINNER" | "INTERMEDIATE" | "ADVANCED" })
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) return
    savePassword({ currentPassword, newPassword })
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
        <p className="text-muted-foreground mt-1">Manage your profile and security preferences.</p>
      </div>

      {/* Profile */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4 text-primary" /> Profile
          </CardTitle>
          <CardDescription>Update your display name and BSL level.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSubmit} className="flex flex-col gap-5">
            {/* Email (read-only) */}
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <div className="flex items-center gap-2">
                <Input value={data?.user.email ?? ""} disabled className="bg-muted" />
                <Badge variant="outline" className="shrink-0 text-xs">Verified</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
            </div>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bslLevel">BSL Level</Label>
              <Select value={bslLevel} onValueChange={setBslLevel}>
                <SelectTrigger id="bslLevel">
                  <SelectValue placeholder="Select your level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  <SelectItem value="BEGINNER">Beginner</SelectItem>
                  <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
                  <SelectItem value="ADVANCED">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              disabled={savingProfile || !name.trim()}
              className="self-start"
            >
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
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
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
              disabled={
                savingPassword ||
                !currentPassword ||
                !newPassword ||
                newPassword !== confirmPassword ||
                newPassword.length < 8
              }
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
        <CardHeader>
          <CardTitle className="text-base">Account Information</CardTitle>
        </CardHeader>
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
