import { NextRequest, NextResponse } from "next/server"
import { runReminders } from "@/lib/reminders"

// Reminders read the clock and the database every time; never cache this.
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * GET /api/cron/reminders — sends the automatic reminders (lib/reminders.ts).
 *
 * Called every 10 minutes by the scheduler (Vercel Cron, or any cron hitting
 * this URL) with `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET set
 * the route stays shut, so nobody else can trigger a wave of notifications.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ message: "Reminders are not configured" }, { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  try {
    const sent = await runReminders()
    return NextResponse.json({ sent })
  } catch (err) {
    console.error("[GET /api/cron/reminders]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
