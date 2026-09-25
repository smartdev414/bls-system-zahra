"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Mail, MailCheck } from "lucide-react"
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
import { usePostCallback } from "@/hooks/use-fetch"

type ForgotBody = { email: string }
type ForgotResponse = { message: string }

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)

  const { execute, loading } = usePostCallback<ForgotResponse, ForgotBody>(
    "/api/auth/forgot-password",
    {
      successMessage: false,
      onSuccess: () => setSent(true),
    }
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await execute({ email })
  }

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4 pb-16">
        <LogoFull width={200} />

        <Card className="w-full max-w-100 shadow-lg">
          {sent ? (
            <>
              <CardHeader className="text-center pb-2">
                <div className="flex justify-center mb-3">
                  <div className="size-14 rounded-full bg-emerald-100 flex items-center justify-center">
                    <MailCheck className="size-7 text-emerald-600" />
                  </div>
                </div>
                <CardTitle className="text-2xl">Check your email</CardTitle>
                <CardDescription>
                  If an account exists for <strong>{email}</strong>, we&apos;ve
                  sent a password reset link. It will expire in 60 minutes.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-2">
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  Didn&apos;t receive an email? Check your spam folder, or try
                  again in a few minutes.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSent(false)
                    setEmail("")
                  }}
                >
                  Use a different email
                </Button>
                <Button asChild variant="ghost" className="w-full">
                  <Link href="/login">
                    <ArrowLeft className="size-4 mr-1" />
                    Back to sign in
                  </Link>
                </Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-2xl">Forgot password?</CardTitle>
                <CardDescription>
                  Enter the email associated with your account and we&apos;ll
                  send you a link to reset your password.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-5 pt-2"
                >
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="e.g. alex@example.com"
                        autoComplete="email"
                        required
                        className="pl-9"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading || !email}
                  >
                    {loading ? "Sending…" : "Send Reset Link"}
                  </Button>

                  <p className="text-sm text-center text-muted-foreground border-t pt-4">
                    Remember your password?{" "}
                    <Link
                      href="/login"
                      className="text-primary font-semibold hover:underline"
                    >
                      Sign in
                    </Link>
                  </p>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </main>

      <Footer />
    </div>
  )
}
