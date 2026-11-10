import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"
import { setPendingGoogleCookie, setSessionCookie, signPendingGoogleToken, signToken } from "@/lib/auth"
import { verifyHandoff } from "@/lib/mobile-google"

// POST /api/auth/google/mobile/exchange { code, verifier } — the phone app trades the one-time code
// from the Google callback for its session cookie (or, for a new account, the same short-lived
// "finish signing up" cookie the website uses, followed by POST /api/auth/google/complete).
async function handlePOST(req: NextRequest) {
  const { code, verifier } = (await req.json().catch(() => ({}))) as { code?: string; verifier?: string }
  if (!code || !verifier) return NextResponse.json({ message: "Invalid request" }, { status: 400 })

  const handoff = await verifyHandoff(code, verifier)
  if (!handoff) {
    return NextResponse.json({ message: "This sign-in has expired. Please try again." }, { status: 401 })
  }

  if (handoff.kind === "pending") {
    const res = NextResponse.json({ status: "needs-signup", name: handoff.pending.name, email: handoff.pending.email })
    setPendingGoogleCookie(res, await signPendingGoogleToken(handoff.pending))
    return res
  }

  const user = await prisma.user.findUnique({ where: { id: handoff.userId } })
  if (!user) return NextResponse.json({ message: "Account not found" }, { status: 404 })
  const token = await signToken({ sub: user.id, name: user.name, email: user.email, role: user.role })
  const res = NextResponse.json({ status: "signed-in" })
  setSessionCookie(res, token)
  return res
}

export const POST = withAudit(handlePOST)
