"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { LogoFull } from "@/components/layout/logo"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"
import { useFetch, usePostCallback } from "@/hooks/use-fetch"

type TokenInfo = { email: string; name: string; expiresAt: string }
type ResetBody = { token: string; password: string }
type ResetResponse = { message: string }

function StrengthBar({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]
  const score = checks.filter(Boolean).length
  const colors = [
    "bg-destructive",
    "bg-orange-400",
    "bg-yellow-400",
    "bg-emerald-400",
    "bg-emerald-500",
  ]
  if (!password) return null
  return (
    <div className="flex gap-1 mt-1.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            i < score ? colors[score] : "bg-muted"
          )}
        />
      ))}
    </div>
  )
}

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [showCf, setShowCf] = useState(false)
  const [done, setDone] = useState(false)

  const { data, loading, error } = useFetch<TokenInfo>(
    `/api/auth/reset-password?token=${encodeURIComponent(token)}`,
    { errorMessage: false }
  )

  const { execute, loading: submitting } = usePostCallback<
    ResetResponse,
    ResetBody
  >("/api/auth/reset-password", {
    successMessage: "Password updated. Please sign in.",
    onSuccess: () => {
      setDone(true)
      setTimeout(() => router.push("/login"), 1500)
    },
  })

  const passwordsMatch = !confirm || confirm === password
  const canSubmit =
    password.length >= 8 && passwordsMatch && !submitting && !done

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    await execute({ token, password })
  }

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 flex flex-col items-center justify-center gap-5 px-4 py-12">
        <LogoFull />

        {/* Until the token check has answered, keep showing the spinner. The
            server-rendered HTML is produced before that check runs, so testing
            `loading` alone shipped the "invalid" card to every visitor. */}
        {(loading || (!data && !error)) && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm">Validating your reset link…</p>
          </div>
        )}

        {!loading && error && (
          <Card className="w-full max-w-md shadow-lg text-center">
            <CardContent className="pt-10 pb-8 flex flex-col items-center gap-4">
              <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="size-8 text-destructive" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground mb-1">
                  Reset link invalid
                </h2>
                <p className="text-sm text-muted-foreground">
                  {error?.message ??
                    "This password reset link is invalid, expired, or has already been used."}
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button asChild variant="outline">
                  <Link href="/login">Back to sign in</Link>
                </Button>
                <Button asChild>
                  <Link href="/forgot-password">Request a new link</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && data && !done && (
          <Card className="w-full max-w-100 shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">Set a new password</CardTitle>
              <CardDescription>
                Choose a strong password for <strong>{data.email}</strong>.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-4 pt-2"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPw ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      className="pl-9 pr-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={
                        showPw ? "Hide password" : "Show password"
                      }
                    >
                      {showPw ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                  <StrengthBar password={password} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="confirm"
                      type={showCf ? "text" : "password"}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                      required
                      className={cn(
                        "pl-9 pr-10",
                        !passwordsMatch && "border-destructive"
                      )}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCf((v) => !v)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={
                        showCf ? "Hide password" : "Show password"
                      }
                    >
                      {showCf ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                  {!passwordsMatch && (
                    <p className="text-xs text-destructive">
                      Passwords do not match
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full mt-1"
                  disabled={!canSubmit}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      Updating…
                    </>
                  ) : (
                    "Update Password"
                  )}
                </Button>

                <p className="text-sm text-center text-muted-foreground border-t pt-4">
                  Remembered it after all?{" "}
                  <Link
                    href="/login"
                    className="text-primary font-semibold hover:underline"
                  >
                    Sign in
                  </Link>
                </p>
              </form>
            </CardContent>
          </Card>
        )}

        {done && (
          <Card className="w-full max-w-md shadow-lg text-center">
            <CardContent className="pt-10 pb-8 flex flex-col items-center gap-4">
              <div className="size-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="size-8 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground mb-1">
                  Password updated
                </h2>
                <p className="text-sm text-muted-foreground">
                  Redirecting you to sign in…
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  )
}
