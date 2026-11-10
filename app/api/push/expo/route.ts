import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { EXPO_MARKER, isExpoToken } from "@/lib/push"

// The Teach Me Sign phone app registers its Expo push token here after sign-in,
// and removes it on sign-out. lib/push.ts sends every notification to it.

type Body = { token?: string; device?: string }

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as Body | null
    const token = body?.token?.trim()
    if (!token || token.length > 300 || !isExpoToken(token)) {
      return NextResponse.json({ message: "Invalid push token" }, { status: 400 })
    }
    const userAgent = (body?.device || req.headers.get("user-agent") || "")?.slice(0, 300) || null
    // Upsert by token: the same phone signing in as someone else moves it to them.
    await prisma.pushSubscription.upsert({
      where: { endpoint: token },
      create: { userId: session.sub, endpoint: token, p256dh: EXPO_MARKER, auth: EXPO_MARKER, userAgent },
      update: { userId: session.sub, p256dh: EXPO_MARKER, auth: EXPO_MARKER, userAgent },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[POST /api/push/expo]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.token) return NextResponse.json({ message: "Missing token" }, { status: 400 })
    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.token, userId: session.sub } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/push/expo]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
