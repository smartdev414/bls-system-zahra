"use client"

import { Clock, Mail, CheckCircle2, RefreshCw, XCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LogoFull } from "@/components/layout/logo"
import { useDeleteCallback } from "@/hooks/use-fetch"

/** The waiting page for a student who signed up on their own (see lib/account-approval.ts). */
export function StudentPendingApproval({ userName, rejected }: { userName: string; rejected: boolean }) {
  const firstName = userName.split(" ")[0]

  const { execute: signOut, loading: signingOut } = useDeleteCallback("/api/auth/logout", {
    onSuccess: () => { window.location.href = "/login" },
  })

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-5 px-4 py-12">
      <LogoFull />
      <Card className="max-w-lg w-full text-center shadow-lg">
        <CardContent className="pt-8 pb-8 px-8 space-y-6">
          {rejected ? (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-destructive" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">Sorry, {firstName}</h1>
                <p className="text-muted-foreground text-lg">Your account was not approved</p>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                If you think this is a mistake, or you&apos;re joining a class with one of our teachers,
                please get in touch with us and we&apos;ll take another look.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">Welcome, {firstName}!</h1>
                <p className="text-muted-foreground text-lg">Your account is waiting for approval</p>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Our team checks every new student before they join. We&apos;ll email you as soon as
                your account is approved.
              </p>

              <div className="rounded-lg border bg-muted/50 p-4 space-y-3 text-sm text-left">
                <h3 className="font-medium text-foreground">What happens next?</h3>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
                  <span className="text-muted-foreground">Your account has been created</span>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
                  <span className="text-muted-foreground">Our team is reviewing it</span>
                </div>
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 mt-0.5 text-muted-foreground/60 shrink-0" />
                  <span className="text-muted-foreground">You&apos;ll get an email when you can start learning</span>
                </div>
              </div>
            </>
          )}

          <div className="flex flex-col gap-3">
            {!rejected && (
              <Button onClick={() => window.location.reload()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Check again
              </Button>
            )}
            <Button variant="ghost" onClick={() => signOut()} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
