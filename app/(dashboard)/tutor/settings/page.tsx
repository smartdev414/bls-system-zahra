"use client"

import { useEffect, useState } from "react"
import {
  User, Lock, Info, Camera, Eye, EyeOff, Check, X,
  Shield, Calendar, Mail, Loader2, CheckCircle2, Plus,
  GraduationCap, BadgeCheck, BookOpen, Video, Users, ArrowRight,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
    bslLevel: string | null
    createdAt: string
    tutorProfile: {
      bio: string | null
      qualifications: string[]
      isVerified: boolean
    } | null
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PwStrength = { score: 0|1|2|3|4; label: string; color: string }
function pwStrength(p: string): PwStrength {
  if (!p) return { score: 0, label: "", color: "" }
  let s = 0
  if (p.length >= 8) s++
  if (p.length >= 12) s++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  const c = Math.min(s, 4) as 0|1|2|3|4
  return { score: c, ...[
    { label: "Too short",  color: "bg-muted"       },
    { label: "Weak",       color: "bg-destructive" },
    { label: "Fair",       color: "bg-amber-400"   },
    { label: "Good",       color: "bg-blue-500"    },
    { label: "Strong",     color: "bg-emerald-500" },
  ][c] }
}

type Section = "profile" | "security" | "account"
const NAV: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "profile",  label: "Tutor Profile", icon: User  },
  { id: "security", label: "Security",      icon: Lock  },
  { id: "account",  label: "Account",       icon: Info  },
]

// ─── Avatar uploader ─────────────────────────────────────────────────────────

function AvatarUploader({ name, currentUrl, onUploaded }: {
  name: string; currentUrl: string | null; onUploaded: (url: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return
    setUploading(true)
    try {
      const r = await fetch("/api/upload/presign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
      })
      if (!r.ok) return
      const { presignedUrl, fileUrl } = await r.json() as { presignedUrl: string; fileUrl: string }
      await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
      onUploaded(fileUrl)
    } finally { setUploading(false) }
  }

  return (
    <div className="relative group w-fit">
      <Avatar className="size-20 ring-4 ring-background shadow-lg">
        <AvatarImage src={currentUrl ?? undefined} alt={name} />
        <AvatarFallback className="bg-primary/10 text-primary text-xl font-black">{initials}</AvatarFallback>
      </Avatar>
      <label className={cn(
        "absolute inset-0 rounded-full flex items-center justify-center bg-black/50 cursor-pointer transition-opacity",
        uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}>
        {uploading ? <Loader2 className="size-5 text-white animate-spin" /> : <Camera className="size-5 text-white" />}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      </label>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorSettingsPage() {
  const [section, setSection] = useState<Section>("profile")
  const { data, loading, refetch } = useFetch<UserData>("/api/user/settings", { errorMessage: "Could not load profile" })

  const [name, setName]                     = useState("")
  const [bio, setBio]                       = useState("")
  const [qualifications, setQualifications] = useState<string[]>([])
  const [newQual, setNewQual]               = useState("")
  const [avatarUrl, setAvatar]              = useState<string | null>(null)

  const [currentPw, setCurrentPw] = useState("")
  const [newPw, setNewPw]         = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [showC, setShowC]         = useState(false)
  const [showN, setShowN]         = useState(false)

  useEffect(() => {
    if (data?.user) {
      setName(data.user.name)
      setBio(data.user.tutorProfile?.bio ?? "")
      setQualifications(data.user.tutorProfile?.qualifications ?? [])
      setAvatar(data.user.avatarUrl)
    }
  }, [data])

  const { execute: saveProfile, loading: saving } = usePutCallback<UserData, object>(
    "/api/user/settings",
    { successMessage: "Profile saved", errorMessage: "Could not save profile", onSuccess: () => refetch() }
  )

  const { execute: savePw, loading: savingPw } = usePutCallback<{ message: string }, object>(
    "/api/user/password",
    {
      successMessage: "Password updated",
      errorMessage: "Incorrect current password",
      onSuccess: () => { setCurrentPw(""); setNewPw(""); setConfirmPw("") },
    }
  )

  function addQual() {
    const t = newQual.trim()
    if (t && !qualifications.includes(t)) { setQualifications((p) => [...p, t]); setNewQual("") }
  }

  const str        = pwStrength(newPw)
  const pwMatch    = newPw && confirmPw && newPw === confirmPw
  const pwMismatch = confirmPw && newPw !== confirmPw
  const user       = data?.user
  const isVerified = user?.tutorProfile?.isVerified ?? false

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  )

  return (
    <div className="max-w-5xl flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Profile & Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your tutor profile, qualifications and account security.</p>
      </div>

      <div className="flex gap-8 items-start">

        {/* ── Sidebar ── */}
        <nav className="w-52 shrink-0 flex flex-col gap-1 sticky top-24">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left",
                section === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}>
              <Icon className="size-4 shrink-0" />{label}
            </button>
          ))}

          {/* Verification badge */}
          <div className="mt-4 px-3">
            <div className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium border",
              isVerified
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
                : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
            )}>
              <BadgeCheck className="size-3.5 shrink-0" />
              {isVerified ? "Verified Tutor" : "Pending Verification"}
            </div>
          </div>
        </nav>

        {/* ── Content ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">

          {/* ════ PROFILE ════ */}
          {section === "profile" && (
            <>
              {/* Profile preview card */}
              <div className="rounded-2xl border bg-card overflow-hidden">
                <div className="h-24 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
                <div className="px-6 pb-6">
                  <div className="flex items-end justify-between -mt-10 mb-4">
                    <AvatarUploader
                      name={name || user?.name || "?"}
                      currentUrl={avatarUrl}
                      onUploaded={(url) => {
                        setAvatar(url)
                        void saveProfile({ name, bio, qualifications, avatarUrl: url })
                      }}
                    />
                    <p className="text-xs text-muted-foreground pb-1">Hover photo to change</p>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold">{user?.name}</h2>
                        {isVerified && (
                          <Badge variant="outline" className="gap-1 text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300">
                            <BadgeCheck className="size-3" />Verified
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{user?.email}</p>

                      {/* Qualifications preview */}
                      {(user?.tutorProfile?.qualifications ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {user!.tutorProfile!.qualifications.map((q) => (
                            <Badge key={q} variant="secondary" className="text-[10px]">{q}</Badge>
                          ))}
                        </div>
                      )}

                      {/* Bio preview */}
                      {user?.tutorProfile?.bio && (
                        <p className="text-sm text-muted-foreground mt-3 line-clamp-2 italic">
                          "{user.tutorProfile.bio}"
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0">
                      Since {user?.createdAt
                        ? new Date(user.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Edit form */}
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="font-semibold mb-1">Profile Details</h2>
                <p className="text-sm text-muted-foreground mb-5">Visible to all students on the platform.</p>

                <form onSubmit={(e) => {
                  e.preventDefault()
                  void saveProfile({ name, bio, qualifications, avatarUrl })
                }} className="flex flex-col gap-5">

                  <div className="flex flex-col gap-1.5">
                    <Label className="flex items-center gap-1.5">
                      <Mail className="size-3.5 text-muted-foreground" />Email Address
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input value={user?.email ?? ""} disabled className="bg-muted text-muted-foreground" />
                      {isVerified && (
                        <Badge variant="outline" className="shrink-0 gap-1 text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300">
                          <CheckCircle2 className="size-3" />Verified
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="name">Full Name</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                    <p className="text-xs text-muted-foreground">Shown to students on your courses and sessions.</p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="bio">
                      Bio <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)}
                      placeholder="Tell students about your BSL experience, background and teaching style..."
                      rows={4} className="resize-none" />
                    <p className="text-xs text-muted-foreground text-right">{bio.length} / 500</p>
                  </div>

                  {/* Qualifications */}
                  <div className="flex flex-col gap-2">
                    <Label className="flex items-center gap-1.5">
                      <GraduationCap className="size-3.5 text-muted-foreground" />Qualifications
                    </Label>
                    {qualifications.length > 0 && (
                      <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-muted/50 border">
                        {qualifications.map((q) => (
                          <Badge key={q} variant="outline" className="gap-1.5 pr-1.5 pl-2.5 py-1">
                            {q}
                            <button type="button"
                              onClick={() => setQualifications((p) => p.filter((x) => x !== q))}
                              className="hover:text-destructive transition-colors">
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input placeholder="e.g. CACDP Level 3, Signature BSL Level 6"
                        value={newQual} onChange={(e) => setNewQual(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addQual() } }} />
                      <Button type="button" variant="outline" onClick={addQual} disabled={!newQual.trim()}>
                        <Plus className="size-4 mr-1" />Add
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Press Enter or click Add. Shown as badges on your profile.</p>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t">
                    <p className="text-xs text-muted-foreground">Changes are visible to students immediately.</p>
                    <Button type="submit" disabled={saving || !name.trim()} size="sm">
                      {saving ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" />Saving…</> : <><Check className="size-3.5 mr-1.5" />Save Profile</>}
                    </Button>
                  </div>
                </form>
              </div>

              {/* Quick links */}
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="font-semibold mb-4">Quick Links</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  {[
                    { label: "My Courses",    href: "/tutor/courses",    icon: BookOpen },
                    { label: "Live Sessions", href: "/tutor/sessions",   icon: Video    },
                    { label: "My Students",   href: "/tutor/students",   icon: Users    },
                  ].map(({ label, href, icon: Icon }) => (
                    <Link key={href} href={href}
                      className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium hover:bg-muted/50 hover:border-primary/50 transition-colors group">
                      <span className="flex items-center gap-2.5">
                        <Icon className="size-4 text-primary" />{label}
                      </span>
                      <ArrowRight className="size-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </Link>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ════ SECURITY ════ */}
          {section === "security" && (
            <div className="rounded-2xl border bg-card p-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="size-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Shield className="size-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold">Change Password</h2>
                  <p className="text-sm text-muted-foreground">Use a strong, unique password.</p>
                </div>
              </div>
              <Separator className="my-5" />

              <form onSubmit={(e) => {
                e.preventDefault()
                if (newPw !== confirmPw) return
                void savePw({ currentPassword: currentPw, newPassword: newPw })
              }} className="flex flex-col gap-5 max-w-md">

                <div className="flex flex-col gap-1.5">
                  <Label>Current Password</Label>
                  <div className="relative">
                    <Input type={showC ? "text" : "password"} value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)} required className="pr-10" placeholder="••••••••" />
                    <button type="button" onClick={() => setShowC((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showC ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <Separator />

                <div className="flex flex-col gap-1.5">
                  <Label>New Password</Label>
                  <div className="relative">
                    <Input type={showN ? "text" : "password"} value={newPw}
                      onChange={(e) => setNewPw(e.target.value)} minLength={8} required className="pr-10" placeholder="Min. 8 characters" />
                    <button type="button" onClick={() => setShowN((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showN ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {newPw && (
                    <div className="flex flex-col gap-1.5 mt-1">
                      <div className="flex gap-1">
                        {[1,2,3,4].map((i) => (
                          <div key={i} className={cn("h-1 flex-1 rounded-full transition-all", i <= str.score ? str.color : "bg-muted")} />
                        ))}
                      </div>
                      <p className={cn("text-xs font-medium", { "text-destructive": str.score<=1, "text-amber-500": str.score===2, "text-blue-500": str.score===3, "text-emerald-500": str.score===4 })}>
                        {str.label}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Confirm New Password</Label>
                  <div className="relative">
                    <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                      required className="pr-10" placeholder="Repeat new password" />
                    {pwMatch    && <Check className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-emerald-500" />}
                    {pwMismatch && <X     className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-destructive"  />}
                  </div>
                  {pwMismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
                </div>

                <div className="rounded-xl bg-muted/50 p-4 text-xs text-muted-foreground space-y-1.5">
                  <p className="font-semibold text-foreground mb-2">Requirements</p>
                  {[
                    { ok: newPw.length >= 8,                         text: "At least 8 characters"        },
                    { ok: /[A-Z]/.test(newPw)&&/[a-z]/.test(newPw), text: "Upper and lowercase letters"   },
                    { ok: /\d/.test(newPw),                          text: "At least one number"           },
                    { ok: /[^A-Za-z0-9]/.test(newPw),               text: "At least one special character" },
                  ].map(({ ok, text }) => (
                    <div key={text} className="flex items-center gap-2">
                      <span className={cn("size-3.5 rounded-full flex items-center justify-center shrink-0",
                        ok ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900" : "bg-muted")}>
                        {ok ? <Check className="size-2.5" /> : <span className="size-1.5 rounded-full bg-muted-foreground/40 block" />}
                      </span>
                      {text}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-1 border-t">
                  <Button type="submit" size="sm"
                    disabled={savingPw || !currentPw || !newPw || newPw !== confirmPw || newPw.length < 8}>
                    {savingPw ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" />Updating…</> : <><Shield className="size-3.5 mr-1.5" />Update Password</>}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* ════ ACCOUNT ════ */}
          {section === "account" && (
            <div className="rounded-2xl border bg-card p-6">
              <h2 className="font-semibold mb-1">Account Information</h2>
              <p className="text-sm text-muted-foreground mb-5">Read-only details about your tutor account.</p>
              <div className="divide-y rounded-xl border overflow-hidden">
                {[
                  { icon: User,         label: "Account Type",         value: <Badge variant="secondary" className="capitalize">{user?.role.toLowerCase()}</Badge> },
                  { icon: BadgeCheck,   label: "Verification Status",  value: isVerified
                    ? <Badge variant="outline" className="gap-1 text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300"><BadgeCheck className="size-3" />Verified</Badge>
                    : <Badge variant="outline" className="gap-1 text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300">Pending Review</Badge>
                  },
                  { icon: Mail,         label: "Email Address",        value: <span className="flex items-center gap-2 text-sm">{user?.email}<Badge variant="outline" className="gap-1 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 className="size-2.5" />Verified</Badge></span> },
                  { icon: Calendar,     label: "Member Since",         value: <span className="text-sm">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—"}</span> },
                  { icon: GraduationCap,label: "Qualifications",       value: (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {(user?.tutorProfile?.qualifications ?? []).length > 0
                        ? user!.tutorProfile!.qualifications.map((q) => <Badge key={q} variant="secondary" className="text-[10px]">{q}</Badge>)
                        : <span className="text-sm text-muted-foreground">None added</span>
                      }
                    </div>
                  )},
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-3.5 bg-card gap-4">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground shrink-0">
                      <Icon className="size-4" />{label}
                    </div>
                    <div className="text-right">{value}</div>
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
