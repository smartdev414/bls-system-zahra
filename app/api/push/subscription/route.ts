import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { pushConfigured } from "@/lib/push"

// One row per device that turned on "Phone notifications" in settings.
// lib/push.ts sends to them; see components/pwa/phone-notifications.tsx.

type SubscriptionBody = {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
}

/**
 * The VAPID public key the browser needs to subscribe, read at runtime so the
 * owner sets it once (VAPID_PUBLIC_KEY) rather than also baking a
 * NEXT_PUBLIC_ copy into the build. null = push isn't set up on this server.
 */
async function handleGET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null })
}

/** Save (or re-point to this user) the browser's push subscription. */
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as SubscriptionBody | null
    const endpoint = body?.endpoint
    const p256dh = body?.keys?.p256dh
    const auth = body?.keys?.auth
    if (!endpoint || !p256dh || !auth || !/^https:\/\//.test(endpoint) || endpoint.length > 2048) {
      return NextResponse.json({ message: "Invalid subscription" }, { status: 400 })
    }

    const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null
    // Upsert by endpoint: the same phone signing in as someone else moves the
    // subscription to them, so the previous user stops getting their pushes.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: session.sub, endpoint, p256dh, auth, userAgent },
      update: { userId: session.sub, p256dh, auth, userAgent },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[POST /api/push/subscription]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

/** Forget this device. Only removes the caller's own subscription. */
async function handleDELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as SubscriptionBody | null
    if (!body?.endpoint) return NextResponse.json({ message: "Missing endpoint" }, { status: 400 })

    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: session.sub } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/push/subscription]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
