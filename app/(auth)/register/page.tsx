"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Mail, Lock, Eye, EyeOff, User, GraduationCap, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Logo } from "@/components/layout/logo"
import { Footer } from "@/components/layout/footer"
import { usePostCallback } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

type Role = "STUDENT" | "TUTOR"

type RegisterBody = {
  name: string
  email: string
  password: string
  role: Role
}
type RegisterResponse = { redirectTo: string }

export default function RegisterPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [role, setRole] = useState<Role>("STUDENT")
  const [agreed, setAgreed] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordError, setPasswordError] = useState("")

  const [form, setForm] = useState({ name: "", email: "", password: "" })

  const { execute, loading } = usePostCallback<RegisterResponse, RegisterBody>(
    "/api/auth/register",
    {
      successMessage: "Account created! Welcome to BSL Learning.",
      onSuccess: (data) => router.push(data.redirectTo),
    }
  )

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    if (e.target.name === "password") setPasswordError("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.password !== confirmPassword) {
      setPasswordError("Passwords do not match")
      return
    }
    if (!agreed) return
    await execute({ ...form, role })
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="flex flex-col items-center gap-1 py-8">
        <Logo />
        <p className="text-sm text-muted-foreground mt-1">Learn British Sign Language Online</p>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-4 pb-12">
        <Card className="w-full max-w-[440px] shadow-lg">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">Create an Account</CardTitle>
            <CardDescription>Join thousands learning BSL today.</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5 pt-2">

              {/* Role selector */}
              <div className="flex flex-col gap-2">
                <Label>I want to join as</Label>
                <div className="grid grid-cols-2 gap-3">
                  {(["STUDENT", "TUTOR"] as Role[]).map((r) => {
                    const Icon = r === "STUDENT" ? GraduationCap : BookOpen
                    const label = r === "STUDENT" ? "Student" : "Tutor"
                    const desc = r === "STUDENT" ? "I want to learn BSL" : "I want to teach BSL"
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all",
                          role === r
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border text-muted-foreground hover:border-muted-foreground"
                        )}
                      >
                        <Icon className="size-5" />
                        <span className="text-sm font-semibold">{label}</span>
                        <span className="text-[11px] leading-tight">{desc}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Full name */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Alex Johnson"
                    autoComplete="name"
                    required
                    className="pl-9"
                    value={form.name}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Email */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="alex@example.com"
                    autoComplete="email"
                    required
                    className="pl-9"
                    value={form.email}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    className="pl-9 pr-10"
                    value={form.password}
                    onChange={handleChange}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    required
                    className={cn("pl-9 pr-10", passwordError && "border-destructive")}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      setPasswordError("")
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-xs text-destructive">{passwordError}</p>
                )}
              </div>

              {/* Terms */}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="terms"
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(!!v)}
                  className="mt-0.5"
                />
                <Label htmlFor="terms" className="font-normal text-muted-foreground leading-snug cursor-pointer">
                  I agree to the{" "}
                  <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
                  {" "}and{" "}
                  <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
                </Label>
              </div>

              {/* Submit */}
              <Button type="submit" className="w-full" disabled={loading || !agreed}>
                {loading ? "Creating account…" : "Create Account"}
              </Button>

              {/* Sign in link */}
              <p className="text-sm text-center text-muted-foreground border-t pt-4">
                Already have an account?{" "}
                <Link href="/login" className="text-primary font-semibold hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </main>

      <Footer />
    </div>
  )
}
