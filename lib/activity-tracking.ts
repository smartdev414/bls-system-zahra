import type { NextRequest } from "next/server"
import prisma from "@/lib/prisma"
import type { LoginMethod } from "@/app/generated/prisma/enums"

// Login history and "last active" for everyone, read by the student activity
// pages (lib/student-activity.ts) and the admin Login activity page.
//
// None of this may ever stop someone signing in: every write here swallows its
// own errors.

/** Where a request came from, worked out from its user agent. */
export function clientOf(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ""
  // The phone app's fetch: okhttp on Android, CFNetwork on iOS. A browser on
  // the same phone says Mozilla/… and counts as web.
  if (/okhttp/i.test(ua)) return "android-app"
  if (/CFNetwork|Darwin\//i.test(ua) && !/Mozilla/i.test(ua)) return "ios-app"
  if (/Expo/i.test(ua)) return "mobile-app"
  return "web"
}

export function ipOf(req: Request | NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    null
  )
}

type LoginAttempt = {
  method: LoginMethod
  email: string
  userId?: string | null
  success: boolean
  failureReason?: string
  /** Overrides what the user agent says — the phone app's Google exchange. */
  client?: string
}

/** Records one sign-in attempt, and on success stamps the user's last login. */
export async function recordLogin(req: Request | NextRequest, attempt: LoginAttempt): Promise<void> {
  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null
  const now = new Date()
  try {
    await prisma.$transaction([
      prisma.loginEvent.create({
        data: {
          userId: attempt.userId ?? null,
          email: (typeof attempt.email === "string" ? attempt.email : "").trim().toLowerCase().slice(0, 320),
          success: attempt.success,
          method: attempt.method,
          failureReason: attempt.failureReason ?? null,
          client: attempt.client ?? clientOf(userAgent),
          ip: ipOf(req),
          userAgent,
          createdAt: now,
        },
      }),
      ...(attempt.success && attempt.userId
        ? [prisma.user.update({ where: { id: attempt.userId }, data: { lastLoginAt: now, lastActiveAt: now } })]
        : []),
    ])
  } catch (err) {
    console.error("[activity-tracking] could not record login", err)
  }
}

// How often a signed-in user's lastActiveAt is written. Within this window
// they count as "online now" on the staff pages.
export const ACTIVE_WRITE_EVERY_MS = 2 * 60 * 1000

/**
 * Notes that a signed-in user is using the platform. Cheap to call on every
 * request: pass the lastActiveAt already loaded and it only writes when that is
 * older than ACTIVE_WRITE_EVERY_MS.
 */
export async function touchActive(userId: string, lastActiveAt: Date | null | undefined): Promise<void> {
  const now = Date.now()
  if (lastActiveAt && now - lastActiveAt.getTime() < ACTIVE_WRITE_EVERY_MS) return
  try {
    // The condition keeps parallel requests from all writing the same minute.
    await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: new Date(now - ACTIVE_WRITE_EVERY_MS) } }],
      },
      data: { lastActiveAt: new Date(now) },
    })
  } catch (err) {
    console.error("[activity-tracking] could not touch lastActiveAt", err)
  }
}
