import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import {
  signToken,
  setSessionCookie,
  dashboardPath,
  signPendingGoogleToken,
  setPendingGoogleCookie,
} from "@/lib/auth"

type GoogleUserInfo = {
  id: string
  email: string
  name: string
  picture?: string
}

async function exchangeCodeForTokens(
  code: string,
  appUrl: string
): Promise<{ access_token: string } | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${appUrl}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  })
  if (!res.ok) return null
  return res.json()
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  return res.json()
}

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const error = searchParams.get("error")

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/login?error=google_cancelled`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code, appUrl)
    if (!tokens) {
      return NextResponse.redirect(`${appUrl}/login?error=google_failed`)
    }

    const googleUser = await fetchGoogleUser(tokens.access_token)
    if (!googleUser) {
      return NextResponse.redirect(`${appUrl}/login?error=google_failed`)
    }

    // Find existing user by googleId or email
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ googleId: googleUser.id }, { email: googleUser.email }],
      },
    })

    if (existing) {
      // Link googleId if not already linked
      const user = existing.googleId
        ? existing
        : await prisma.user.update({
            where: { id: existing.id },
            data: { googleId: googleUser.id },
          })

      const token = await signToken({
        sub: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      })
      const res = NextResponse.redirect(`${appUrl}${dashboardPath(user.role)}`)
      setSessionCookie(res, token)
      return res
    }

    // New user — set a short-lived cookie and redirect to onboarding
    const pendingToken = await signPendingGoogleToken({
      googleId: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      avatarUrl: googleUser.picture,
    })

    const query = new URLSearchParams({
      name: googleUser.name,
      email: googleUser.email,
    })

    const res = NextResponse.redirect(
      `${appUrl}/register/complete-google?${query}`
    )
    setPendingGoogleCookie(res, pendingToken)
    return res
  } catch (err) {
    console.error("[GET /api/auth/google/callback]", err)
    return NextResponse.redirect(`${appUrl}/login?error=google_failed`)
  }
}
