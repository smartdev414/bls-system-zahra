import { createHash } from "crypto"
import { SignJWT, jwtVerify } from "jose"
import type { NextRequest, NextResponse } from "next/server"
import type { PendingGooglePayload } from "@/lib/auth"

// Google sign-in for the Teach Me Sign phone app.
//
// Google refuses sign-in inside an app's embedded browser, so the app opens the normal flow in the
// system browser. That browser has its own cookies, so instead of a session cookie the callback
// hands the app a one-time code through the app's URL scheme. The code is bound to a challenge the
// app chose (PKCE-style): only the app that started the sign-in knows the verifier, so another
// app that registered the same scheme and caught the redirect cannot use the code.

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "bsl-dev-secret-change-in-production")
const MOBILE_COOKIE = "bsl-mobile-google"
export const MOBILE_REDIRECT = "teachmesign://google-auth"

/** base64url(sha256(verifier)), the same transform the app applies. */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

/** Remembers, in the system browser, that this Google sign-in was started by the app. */
export function markMobileSignIn(res: NextResponse, challenge: string): void {
  res.cookies.set(MOBILE_COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  })
}

export function mobileChallenge(req: NextRequest): string | null {
  const value = req.cookies.get(MOBILE_COOKIE)?.value
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
}

export function clearMobileSignIn(res: NextResponse): void {
  res.cookies.delete(MOBILE_COOKIE)
}

type Handoff =
  | { kind: "user"; userId: string; challenge: string }
  | { kind: "pending"; pending: Omit<PendingGooglePayload, "type">; challenge: string }

export async function signHandoff(handoff: Handoff): Promise<string> {
  return new SignJWT({ ...handoff, type: "mobile-google-handoff" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(SECRET)
}

export async function verifyHandoff(code: string, verifier: string): Promise<Handoff | null> {
  try {
    const { payload } = await jwtVerify(code, SECRET)
    if (payload.type !== "mobile-google-handoff") return null
    const handoff = payload as unknown as Handoff
    return handoff.challenge === challengeFor(verifier) ? handoff : null
  } catch {
    return null
  }
}
