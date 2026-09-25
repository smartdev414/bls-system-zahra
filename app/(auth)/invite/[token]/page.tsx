"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Lock, Eye, EyeOff, User, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { LogoFull } from "@/components/layout/logo"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type InviteInfo = {
  email: string
  tutorName: string
  tutorAvatar: string | null
  expiresAt: string
}

function StrengthBar({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]
  const score = checks.filter(Boolean).length
  const colors = ["bg-destructive", "bg-orange-400", "bg-yellow-400", "bg-emerald-400", "bg-emerald-500"]
  if (!password) return null
  return (
    <div className="flex gap-1 mt-1.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i < score ? colors[score] : "bg-muted")} />
      ))}
    </div>
  )
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [showCf, setShowCf] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/invites/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json()
          setError(data.message ?? "Invalid invitation")
        } else {
          const data = await res.json()
          setInvite(data)
        }
      })
      .catch(() => setError("Failed to load invitation"))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!invite) return
    if (password !== confirm) { toast.error("Passwords do not match"); return }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return }

    setSubmitting(true)
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: invite.email,
          password,
          role: "STUDENT",
          inviteToken: token,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.message ?? "Registration failed"); return }
      toast.success("Welcome to BSL Platform!")
      router.push(data.redirectTo)
    } catch {
      toast.error("Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 flex flex-col items-center justify-center gap-5 px-4 py-12">
        <LogoFull />


        {loading && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm">Loading your invitation…</p>
          </div>
        )}

        {!loading && error && (
          <Card className="w-full max-w-md shadow-lg text-center">
            <CardContent className="pt-10 pb-8 flex flex-col items-center gap-4">
              <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="size-8 text-destructive" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground mb-1">Invitation Invalid</h2>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button asChild variant="outline"><Link href="/register">Create account</Link></Button>
                <Button asChild><Link href="/login">Sign in</Link></Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && invite && (
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader className="text-center pb-2">
              {/* Tutor avatar */}
              <div className="flex justify-center mb-3">
                <div className="relative">
                  <Avatar className="size-16 ring-2 ring-primary/30">
                    {invite.tutorAvatar && <AvatarImage src={invite.tutorAvatar} alt={invite.tutorName} />}
                    <AvatarFallback className="text-xl bg-primary/10 text-primary font-bold">
                      {invite.tutorName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full p-0.5">
                    <CheckCircle2 className="size-3.5 text-white" />
                  </span>
                </div>
              </div>
              <CardTitle className="text-2xl">You've been invited!</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                <strong className="text-foreground">{invite.tutorName}</strong> has invited you to join BSL Platform as a student.
                Complete your account below to get started.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">

                {/* Pre-filled email (read-only) */}
                <div className="flex flex-col gap-1.5">
                  <Label>Email Address</Label>
                  <Input value={invite.email} readOnly className="bg-muted text-muted-foreground cursor-not-allowed" />
                  <p className="text-xs text-muted-foreground">This email was used for your invitation and cannot be changed.</p>
                </div>

                {/* Full name */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="name"
                      placeholder="Alex Johnson"
                      required
                      className="pl-9"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPw ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      required
                      minLength={8}
                      className="pl-9 pr-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <StrengthBar password={password} />
                </div>

                {/* Confirm */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="confirm"
                      type={showCf ? "text" : "password"}
                      placeholder="Repeat your password"
                      required
                      className={cn("pl-9 pr-10", confirm && confirm !== password && "border-destructive")}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCf((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showCf ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="w-full mt-1" disabled={submitting}>
                  {submitting ? <><Loader2 className="size-4 animate-spin mr-2" />Creating account…</> : "Accept Invitation & Join"}
                </Button>

                <p className="text-xs text-center text-muted-foreground border-t pt-3">
                  Already have an account?{" "}
                  <Link href="/login" className="text-primary font-semibold hover:underline">Sign in</Link>
                </p>
              </form>
            </CardContent>
          </Card>
        )}

      </main>
      <Footer />
    </div>
  )
}
