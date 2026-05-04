"use client"

import { useEffect, useState } from "react"
import {
  User, Lock, Info, Camera, Eye, EyeOff, Check, X,
  Shield, Calendar, Mail, Loader2, CheckCircle2, BookOpen,
  GraduationCap, Video, ArrowRight, Award, Copy, Share2,
} from "lucide-react"
import Link from "next/link"
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
import { COURSE_LEVELS, levelColor, levelDot, type CourseLevel } from "@/lib/levels"

// ─── Types ────────────────────────────────────────────────────────────────────

type UserData = {
  user: {
    id: string
    name: string
    email: string
    role: string
    avatarUrl: string | null
    bslLevel: CourseLevel | null
    createdAt: string
  }
}

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
    { label: "Too short",  color: "bg-muted"        },
    { label: "Weak",       color: "bg-destructive"  },
    { label: "Fair",       color: "bg-amber-400"    },
    { label: "Good",       color: "bg-blue-500"     },
    { label: "Strong",     color: "bg-emerald-500"  },
  ][c] }
}

type Section = "profile" | "security" | "account" | "certifications"
const NAV: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "profile",         label: "Profile",        icon: User  },
  { id: "certifications",  label: "Certifications", icon: Award },
  { id: "security",        label: "Security",       icon: Lock  },
  { id: "account",         label: "Account",        icon: Info  },
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
      const form = new FormData()
      form.append("file", file)
      const r = await fetch("/api/upload/image", { method: "POST", body: form })
      if (!r.ok) return
      const { fileUrl } = await r.json() as { fileUrl: string }
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

export default function StudentSettingsPage() {
  const [section, setSection] = useState<Section>("profile")
  const { data, loading, refetch } = useFetch<UserData>("/api/user/settings", { errorMessage: "Could not load profile" })

  const [name, setName]         = useState("")
  const [bslLevel, setBslLevel] = useState("none")
  const [avatarUrl, setAvatar]  = useState<string | null>(null)

  const [currentPw, setCurrentPw]   = useState("")
  const [newPw, setNewPw]           = useState("")
  const [confirmPw, setConfirmPw]   = useState("")
  const [showCurrent, setShowC]     = useState(false)
  const [showNew, setShowN]         = useState(false)

  useEffect(() => {
    if (data?.user) {
      setName(data.user.name)
      setBslLevel(data.user.bslLevel ?? "none")
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

  const str        = pwStrength(newPw)
  const pwMatch    = newPw && confirmPw && newPw === confirmPw
  const pwMismatch = confirmPw && newPw !== confirmPw
  const user       = data?.user

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  )

  return (
    <div className="max-w-5xl flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Profile & Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your profile, BSL level and account security.</p>
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
        </nav>

        {/* ── Content ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">

          {/* ════ PROFILE ════ */}
          {section === "profile" && (
            <>
              {/* Profile preview card */}
              <div className="rounded-2xl border bg-card overflow-hidden">
                {/* Banner */}
                <div className="h-24 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
                <div className="px-6 pb-6">
                  <div className="flex items-end justify-between -mt-10 mb-4">
                    <AvatarUploader
                      name={name || user?.name || "?"}
                      currentUrl={avatarUrl}
                      onUploaded={(url) => {
                        setAvatar(url)
                        void saveProfile({ name, bslLevel: bslLevel === "none" ? null : bslLevel, avatarUrl: url })
                      }}
                    />
                    <p className="text-xs text-muted-foreground pb-1">Hover photo to change</p>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold">{user?.name}</h2>
                      <p className="text-sm text-muted-foreground mt-0.5">{user?.email}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs capitalize">{user?.role.toLowerCase()}</Badge>
                        {user?.bslLevel && (
                          <Badge variant="outline" className={cn("text-xs", levelColor[user.bslLevel])}>
                            {user.bslLevel}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0">
                      Member since {user?.createdAt
                        ? new Date(user.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Edit form */}
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="font-semibold mb-1">Personal Information</h2>
                <p className="text-sm text-muted-foreground mb-5">Update your name and BSL proficiency level.</p>

                <form onSubmit={(e) => {
                  e.preventDefault()
                  void saveProfile({ name, bslLevel: bslLevel === "none" ? null : bslLevel, avatarUrl })
                }} className="flex flex-col gap-5">

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
                    <p className="text-xs text-muted-foreground">Email address cannot be changed.</p>
                  </div>

                  <Separator />

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="name">Full Name</Label>
                      <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" required />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="bslLevel">BSL Level</Label>
                      <Select value={bslLevel} onValueChange={setBslLevel}>
                        <SelectTrigger id="bslLevel"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not specified</SelectItem>
                          {COURSE_LEVELS.map((l) => (
                            <SelectItem key={l} value={l}>
                              <span className="flex items-center gap-2">
                                <span className={cn("size-2 rounded-full inline-block", levelDot[l])} />
                                {l}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Helps tutors tailor content to your level.</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t">
                    <p className="text-xs text-muted-foreground">Changes appear on your profile immediately.</p>
                    <Button type="submit" disabled={saving || !name.trim()} size="sm">
                      {saving ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" />Saving…</> : <><Check className="size-3.5 mr-1.5" />Save Changes</>}
                    </Button>
                  </div>
                </form>
              </div>

              {/* Quick links */}
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="font-semibold mb-4">Quick Links</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  {[
                    { label: "My Courses",    href: "/student/courses",    icon: BookOpen     },
                    { label: "Dictionary",    href: "/student/dictionary", icon: GraduationCap },
                    { label: "Classroom",     href: "/student/classroom",  icon: Video        },
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
                    <Input type={showCurrent ? "text" : "password"} value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)} required className="pr-10" placeholder="••••••••" />
                    <button type="button" onClick={() => setShowC((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <Separator />

                <div className="flex flex-col gap-1.5">
                  <Label>New Password</Label>
                  <div className="relative">
                    <Input type={showNew ? "text" : "password"} value={newPw}
                      onChange={(e) => setNewPw(e.target.value)} minLength={8} required className="pr-10" placeholder="Min. 8 characters" />
                    <button type="button" onClick={() => setShowN((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
                    { ok: newPw.length >= 8,                          text: "At least 8 characters"       },
                    { ok: /[A-Z]/.test(newPw)&&/[a-z]/.test(newPw),  text: "Upper and lowercase letters"  },
                    { ok: /\d/.test(newPw),                           text: "At least one number"          },
                    { ok: /[^A-Za-z0-9]/.test(newPw),                text: "At least one special character"},
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

          {/* ════ CERTIFICATIONS ════ */}
          {section === "certifications" && (
            <CertificationsSection />
          )}

          {/* ════ ACCOUNT ════ */}
          {section === "account" && (
            <div className="rounded-2xl border bg-card p-6">
              <h2 className="font-semibold mb-1">Account Information</h2>
              <p className="text-sm text-muted-foreground mb-5">Read-only details about your account.</p>
              <div className="divide-y rounded-xl border overflow-hidden">
                {[
                  { icon: User,         label: "Account Type",   value: <Badge variant="secondary" className="capitalize">{user?.role.toLowerCase()}</Badge> },
                  { icon: Mail,         label: "Email Address",  value: <span className="flex items-center gap-2 text-sm">{user?.email}<Badge variant="outline" className="gap-1 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 className="size-2.5" />Verified</Badge></span> },
                  { icon: Calendar,     label: "Member Since",   value: <span className="text-sm">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—"}</span> },
                  ...(user?.bslLevel ? [{ icon: GraduationCap, label: "BSL Level", value: <Badge variant="outline" className={cn("text-xs", levelColor[user.bslLevel])}>{user.bslLevel}</Badge> }] : []),
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-3.5 bg-card">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Icon className="size-4 shrink-0" />{label}
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

// ─── Certifications Section ──────────────────────────────────────────────────

import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"

type CertEnrollment = {
  id: string
  status: string
  passedCount: number
  totalSteps: number
  progress: number
  certificate: { token: string; issuedAt: string; expiresAt: string | null } | null
}

type CertProgram = {
  id: string
  title: string
  level: string
  isEnrolled: boolean
  enrollment: CertEnrollment | null
}

function CertificationsSection() {
  const { data, loading } = useFetch<{ programs: CertProgram[] }>("/api/student/certifications", {
    errorMessage: "Could not load certifications",
  })

  const programs = data?.programs ?? []
  const enrolled = programs.filter((p) => p.isEnrolled)
  const completed = enrolled.filter((p) => p.enrollment?.status === "COMPLETED")
  const active = enrolled.filter((p) => p.enrollment?.status === "ACTIVE")

  const appUrl = typeof window !== "undefined" ? window.location.origin : ""

  if (loading) {
    return (
      <div className="rounded-2xl border bg-card p-6 flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Earned certificates */}
      <div className="rounded-2xl border bg-card p-6">
        <h2 className="font-semibold mb-1 flex items-center gap-2">
          <Award className="size-4 text-primary" /> Earned Certificates
        </h2>
        <p className="text-sm text-muted-foreground mb-4">Certificates you can share with employers.</p>

        {completed.length > 0 ? (
          <div className="flex flex-col gap-3">
            {completed.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
                <div className="rounded-full bg-emerald-100 p-2 shrink-0">
                  <Award className="size-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{p.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Issued {p.enrollment?.certificate?.issuedAt
                      ? new Date(p.enrollment.certificate.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700"
                    onClick={() => {
                      if (p.enrollment?.certificate?.token) {
                        navigator.clipboard.writeText(`${appUrl}/verify/${p.enrollment.certificate.token}`)
                        toast.success("Link copied!")
                      }
                    }}
                  >
                    <Copy className="size-3" /> Copy
                  </Button>
                  {p.enrollment?.certificate?.token && (
                    <Button asChild size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700">
                      <Link href={`/verify/${p.enrollment.certificate.token}`} target="_blank">
                        <Share2 className="size-3" /> View
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No certificates yet.{" "}
            <Link href="/student/certifications" className="text-primary underline underline-offset-2">
              Browse certifications
            </Link>
          </p>
        )}
      </div>

      {/* In progress */}
      {active.length > 0 && (
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="size-4 text-primary" /> In Progress
          </h2>
          <div className="flex flex-col gap-3">
            {active.map((p) => (
              <Link
                key={p.id}
                href={`/student/certifications/${p.id}`}
                className="flex items-center gap-3 rounded-xl border px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{p.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.enrollment?.passedCount}/{p.enrollment?.totalSteps} steps completed
                  </p>
                </div>
                <div className="w-20 shrink-0">
                  <Progress value={p.enrollment?.progress ?? 0} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground text-right mt-0.5">{p.enrollment?.progress}%</p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick link */}
      <div className="rounded-2xl border bg-card p-6">
        <Link
          href="/student/certifications"
          className="flex items-center justify-between gap-3 text-sm font-medium hover:text-primary transition-colors"
        >
          <span className="flex items-center gap-2">
            <Award className="size-4 text-primary" /> Browse all certifications
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
        </Link>
      </div>
    </div>
  )
}
