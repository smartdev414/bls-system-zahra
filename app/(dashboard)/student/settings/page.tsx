"use client"

import { useEffect, useState } from "react"
import {
  User, Lock, Info, Camera, Eye, EyeOff, Check, X,
  Shield, Calendar, Mail, Loader2, CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300",
  INTERMEDIATE: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300",
  ADVANCED: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300",
}

type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; color: string }

function checkPasswordStrength(p: string): PasswordStrength {
  if (!p) return { score: 0, label: "", color: "" }
  let score = 0
  if (p.length >= 8) score++
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++
  if (/\d/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  const capped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4
  const map: Record<number, { label: string; color: string }> = {
    0: { label: "Too short", color: "bg-muted" },
    1: { label: "Weak", color: "bg-destructive" },
    2: { label: "Fair", color: "bg-amber-400" },
    3: { label: "Good", color: "bg-blue-500" },
    4: { label: "Strong", color: "bg-emerald-500" },
  }
  return { score: capped, ...map[capped] }
}

// ─── Sidebar nav ─────────────────────────────────────────────────────────────

type Section = "profile" | "security" | "account"

const sections: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "profile",  label: "Profile",   icon: User   },
  { id: "security", label: "Security",  icon: Lock   },
  { id: "account",  label: "Account",   icon: Info   },
]

// ─── Avatar uploader ──────────────────────────────────────────────────────────

function AvatarUploader({
  name, currentUrl, onUploaded,
}: { name: string; currentUrl: string | null; onUploaded: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return
    setUploading(true)
    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
      })
      if (!presignRes.ok) return
      const { presignedUrl, fileUrl } = await presignRes.json() as { presignedUrl: string; fileUrl: string }
      await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
      onUploaded(fileUrl)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="relative group w-fit">
      <Avatar className="size-24 ring-4 ring-background shadow-md">
        <AvatarImage src={currentUrl ?? undefined} alt={name} />
        <AvatarFallback className="bg-primary/10 text-primary text-2xl font-black">
          {initials}
        </AvatarFallback>
      </Avatar>
      <label className={cn(
        "absolute inset-0 rounded-full flex items-center justify-center",
        "bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer",
        uploading && "opacity-100"
      )}>
        {uploading
          ? <Loader2 className="size-6 text-white animate-spin" />
          : <Camera className="size-6 text-white" />
        }
        <input
          type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </label>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StudentSettingsPage() {
  const [section, setSection] = useState<Section>("profile")
  const { data, loading, refetch } = useFetch<UserData>("/api/user/settings", {
    errorMessage: "Could not load settings",
  })

  // Profile state
  const [name, setName] = useState("")
  const [bslLevel, setBslLevel] = useState("none")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  // Password state
  const [currentPw, setCurrentPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    if (data?.user) {
      setName(data.user.name)
      setBslLevel(data.user.bslLevel ?? "none")
      setAvatarUrl(data.user.avatarUrl)
    }
  }, [data])

  const { execute: saveProfile, loading: savingProfile } = usePutCallback<UserData, object>(
    "/api/user/settings",
    { successMessage: "Profile saved", errorMessage: "Could not save profile", onSuccess: () => refetch() }
  )

  const { execute: savePassword, loading: savingPassword } = usePutCallback<{ message: string }, object>(
    "/api/user/password",
    {
      successMessage: "Password changed",
      errorMessage: "Incorrect current password",
      onSuccess: () => { setCurrentPw(""); setNewPw(""); setConfirmPw("") },
    }
  )

  const pwStrength = checkPasswordStrength(newPw)
  const pwMatch = newPw && confirmPw && newPw === confirmPw
  const pwMismatch = confirmPw && newPw !== confirmPw

  const user = data?.user

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl flex flex-col gap-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your profile, security and account preferences.</p>
      </div>

      <div className="flex gap-8 items-start">
        {/* ── Sidebar ── */}
        <nav className="w-52 shrink-0 flex flex-col gap-1 sticky top-24">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left",
                section === id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* ── Content ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">

          {/* ── PROFILE SECTION ── */}
          {section === "profile" && (
            <>
              {/* Avatar card */}
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="font-semibold mb-1">Profile Photo</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  Your photo is shown to tutors and on your profile.
                </p>
                <div className="flex items-center gap-5">
                  <AvatarUploader
                    name={name || user?.name || "?"}
                    currentUrl={avatarUrl}
                    onUploaded={(url) => {
                      setAvatarUrl(url)
                      void saveProfile({ name, bslLevel: bslLevel === "none" ? null : bslLevel, avatarUrl: url })
                    }}
                  />
                  <div>
                    <p className="text-sm font-medium">{user?.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{user?.email}</p>
                    {user?.bslLevel && (
                      <Badge variant="outline" className={cn("text-[10px] mt-2", levelColor[user.bslLevel])}>
                        {user.bslLevel.charAt(0) + user.bslLevel.slice(1).toLowerCase()}
                      </Badge>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Hover the photo to upload a new one. JPG, PNG or WebP.
                    </p>
                  </div>
                </div>
              </div>

              {/* Personal info card */}
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="font-semibold mb-1">Personal Information</h2>
                <p className="text-sm text-muted-foreground mb-5">Update your name and BSL proficiency level.</p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void saveProfile({
                      name,
                      bslLevel: bslLevel === "none" ? null : bslLevel,
                      avatarUrl,
                    })
                  }}
                  className="flex flex-col gap-5"
                >
                  {/* Email read-only */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="flex items-center gap-1.5">
                      <Mail className="size-3.5 text-muted-foreground" /> Email address
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input value={user?.email ?? ""} disabled className="bg-muted text-muted-foreground" />
                      <Badge variant="outline" className="shrink-0 gap-1 text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300">
                        <CheckCircle2 className="size-3" /> Verified
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Your email address cannot be changed.</p>
                  </div>

                  <Separator />

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="name">Full Name</Label>
                      <Input
                        id="name" value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your full name" required
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="bslLevel">BSL Level</Label>
                      <Select value={bslLevel} onValueChange={setBslLevel}>
                        <SelectTrigger id="bslLevel"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not specified</SelectItem>
                          <SelectItem value="BEGINNER">
                            <span className="flex items-center gap-2">
                              <span className="size-2 rounded-full bg-emerald-500 inline-block" /> Beginner
                            </span>
                          </SelectItem>
                          <SelectItem value="INTERMEDIATE">
                            <span className="flex items-center gap-2">
                              <span className="size-2 rounded-full bg-amber-500 inline-block" /> Intermediate
                            </span>
                          </SelectItem>
                          <SelectItem value="ADVANCED">
                            <span className="flex items-center gap-2">
                              <span className="size-2 rounded-full bg-rose-500 inline-block" /> Advanced
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Helps tutors tailor content to your level.</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t">
                    <p className="text-xs text-muted-foreground">
                      Changes are saved immediately.
                    </p>
                    <Button type="submit" disabled={savingProfile || !name.trim()} size="sm">
                      {savingProfile
                        ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving…</>
                        : <><Check className="size-3.5 mr-1.5" /> Save Changes</>
                      }
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}

          {/* ── SECURITY SECTION ── */}
          {section === "security" && (
            <div className="rounded-2xl border bg-card p-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="size-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Shield className="size-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold">Change Password</h2>
                  <p className="text-sm text-muted-foreground">Keep your account safe with a strong password.</p>
                </div>
              </div>

              <Separator className="my-5" />

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (newPw !== confirmPw) return
                  void savePassword({ currentPassword: currentPw, newPassword: newPw })
                }}
                className="flex flex-col gap-5 max-w-md"
              >
                {/* Current password */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="currentPw">Current Password</Label>
                  <div className="relative">
                    <Input
                      id="currentPw"
                      type={showCurrent ? "text" : "password"}
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      required className="pr-10"
                      placeholder="••••••••"
                    />
                    <button type="button" onClick={() => setShowCurrent((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <Separator />

                {/* New password */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="newPw">New Password</Label>
                  <div className="relative">
                    <Input
                      id="newPw"
                      type={showNew ? "text" : "password"}
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      minLength={8} required className="pr-10"
                      placeholder="Min. 8 characters"
                    />
                    <button type="button" onClick={() => setShowNew((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>

                  {/* Strength meter */}
                  {newPw && (
                    <div className="flex flex-col gap-1.5 mt-1">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className={cn(
                            "h-1 flex-1 rounded-full transition-colors",
                            i <= pwStrength.score ? pwStrength.color : "bg-muted"
                          )} />
                        ))}
                      </div>
                      <p className={cn("text-xs font-medium", {
                        "text-destructive": pwStrength.score <= 1,
                        "text-amber-500": pwStrength.score === 2,
                        "text-blue-500": pwStrength.score === 3,
                        "text-emerald-500": pwStrength.score === 4,
                      })}>
                        {pwStrength.label}
                      </p>
                    </div>
                  )}
                </div>

                {/* Confirm password */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirmPw">Confirm New Password</Label>
                  <div className="relative">
                    <Input
                      id="confirmPw"
                      type="password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      required className="pr-10"
                      placeholder="Repeat new password"
                    />
                    {pwMatch && (
                      <Check className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-emerald-500" />
                    )}
                    {pwMismatch && (
                      <X className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-destructive" />
                    )}
                  </div>
                  {pwMismatch && (
                    <p className="text-xs text-destructive">Passwords do not match</p>
                  )}
                </div>

                {/* Tips */}
                <div className="rounded-xl bg-muted/50 p-4 text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground mb-2">Tips for a strong password</p>
                  {[
                    { ok: newPw.length >= 8, text: "At least 8 characters" },
                    { ok: /[A-Z]/.test(newPw) && /[a-z]/.test(newPw), text: "Mix of upper and lowercase letters" },
                    { ok: /\d/.test(newPw), text: "At least one number" },
                    { ok: /[^A-Za-z0-9]/.test(newPw), text: "At least one special character" },
                  ].map(({ ok, text }) => (
                    <div key={text} className="flex items-center gap-2">
                      <span className={cn("size-3.5 rounded-full flex items-center justify-center", ok ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground")}>
                        {ok ? <Check className="size-2.5" /> : <span className="size-1.5 rounded-full bg-muted-foreground/50 block" />}
                      </span>
                      {text}
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-1 border-t">
                  <div />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      savingPassword || !currentPw || !newPw ||
                      newPw !== confirmPw || newPw.length < 8
                    }
                  >
                    {savingPassword
                      ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Updating…</>
                      : <><Shield className="size-3.5 mr-1.5" /> Update Password</>
                    }
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* ── ACCOUNT SECTION ── */}
          {section === "account" && (
            <div className="rounded-2xl border bg-card p-6">
              <h2 className="font-semibold mb-1">Account Information</h2>
              <p className="text-sm text-muted-foreground mb-5">Read-only details about your account.</p>

              <div className="flex flex-col gap-0 divide-y rounded-xl border overflow-hidden">
                {[
                  {
                    icon: User,
                    label: "Account Type",
                    value: <Badge variant="secondary" className="capitalize">{user?.role.toLowerCase()}</Badge>,
                  },
                  {
                    icon: Mail,
                    label: "Email Address",
                    value: (
                      <span className="flex items-center gap-2 text-sm">
                        {user?.email}
                        <Badge variant="outline" className="gap-1 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300">
                          <CheckCircle2 className="size-2.5" /> Verified
                        </Badge>
                      </span>
                    ),
                  },
                  {
                    icon: Calendar,
                    label: "Member Since",
                    value: (
                      <span className="text-sm">
                        {user?.createdAt
                          ? new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                          : "—"}
                      </span>
                    ),
                  },
                  ...(user?.bslLevel ? [{
                    icon: Info,
                    label: "BSL Level",
                    value: (
                      <Badge variant="outline" className={cn("text-xs", levelColor[user.bslLevel])}>
                        {user.bslLevel.charAt(0) + user.bslLevel.slice(1).toLowerCase()}
                      </Badge>
                    ),
                  }] : []),
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-3.5 bg-card">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Icon className="size-4 shrink-0" />
                      {label}
                    </div>
                    <div>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
