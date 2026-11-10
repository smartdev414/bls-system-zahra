import { NextRequest, NextResponse } from "next/server"
import { withAudit } from "@/lib/audit"
import { markMobileSignIn } from "@/lib/mobile-google"

// GET /api/auth/google/mobile?challenge=… — the phone app's "Continue with Google". Marks the
// sign-in as the app's, then continues exactly like the website's Google sign-in.
async function handleGET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get("challenge") ?? ""
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return NextResponse.json({ message: "Invalid request" }, { status: 400 })
  }
  const res = NextResponse.redirect(new URL("/api/auth/google", req.nextUrl.origin))
  markMobileSignIn(res, challenge)
  return res
}

export const GET = withAudit(handleGET)
