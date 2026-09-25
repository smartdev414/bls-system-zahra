"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { GraduationCap, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { LogoFull } from "@/components/layout/logo"
import { Footer } from "@/components/layout/footer"
import { usePostCallback } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

type Role = "STUDENT" | "TUTOR"
type CompleteBody = { role: Role; agreed: boolean }
type CompleteResponse = { redirectTo: string }

function CompleteGoogleForm() {
  const router = useRouter()
  const params = useSearchParams()
  const name = params.get("name") ?? ""
  const email = params.get("email") ?? ""

  const [role, setRole] = useState<Role>("STUDENT")
  const [agreed, setAgreed] = useState(false)

  const { execute, loading } = usePostCallback<CompleteResponse, CompleteBody>(
    "/api/auth/google/complete",
    {
      successMessage: "Account created! Welcome to BSL Learning.",
      onSuccess: (data) => router.push(data.redirectTo),
    }
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agreed) return
    await execute({ role, agreed })
  }

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 flex flex-col items-center justify-center gap-5 px-4 pb-12">
        <LogoFull />

        <Card className="w-full max-w-110 shadow-lg">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">One Last Step</CardTitle>
            <CardDescription>Tell us how you&apos;ll be using BSL Learning.</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5 pt-2">

              {/* Google account preview */}
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
                <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0 select-none">
                  {name.charAt(0).toUpperCase() || "G"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{name}</p>
                  <p className="text-xs text-muted-foreground truncate">{email}</p>
                </div>
                <span className="ml-auto text-xs text-muted-foreground shrink-0">via Google</span>
              </div>

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
                {loading ? "Creating account…" : "Complete Sign Up"}
              </Button>

              <p className="text-sm text-center text-muted-foreground border-t pt-4">
                Wrong account?{" "}
                <Link href="/register" className="text-primary font-semibold hover:underline">
                  Start over
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

export default function CompleteGooglePage() {
  return (
    <Suspense>
      <CompleteGoogleForm />
    </Suspense>
  )
}
