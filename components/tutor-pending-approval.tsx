import { Clock, Mail, CheckCircle2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export function TutorPendingApproval({ userName }: { userName: string }) {
  const firstName = userName.split(" ")[0]

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-lg w-full text-center">
        <CardContent className="pt-8 pb-8 px-8 space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome, {firstName}!
            </h1>
            <p className="text-muted-foreground text-lg">
              Your account is pending approval
            </p>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            Thank you for signing up as a tutor. An administrator will review
            your account shortly. You&apos;ll be able to access your dashboard
            once your account has been approved.
          </p>

          <div className="rounded-lg border bg-muted/50 p-4 space-y-3 text-sm text-left">
            <h3 className="font-medium text-foreground">What happens next?</h3>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
              <span className="text-muted-foreground">Your account has been created</span>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
              <span className="text-muted-foreground">Admin review in progress</span>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="w-4 h-4 mt-0.5 text-muted-foreground/60 shrink-0" />
              <span className="text-muted-foreground">You&apos;ll get full access once approved</span>
            </div>
          </div>

          <Button variant="outline" asChild>
            <Link href="/api/auth/logout">Sign out</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
