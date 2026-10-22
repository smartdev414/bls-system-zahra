import { NextRequest, NextResponse } from "next/server"
import { runReminders } from "@/lib/reminders"
import { deleteExpiredAnswerVideos } from "@/lib/test-recordings"

// Reminders read the clock and the database every time; never cache this.
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * GET /api/cron/reminders — sends the automatic reminders (lib/reminders.ts),
 * and deletes students' test recordings once they are 30 days old.
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
    // Students' recordings in tests are kept for 30 days (lib/test-recordings.ts).
    const answerVideosDeleted = await deleteExpiredAnswerVideos().catch((err) => {
      console.error("[cron] deleting old test recordings", err)
      return null
    })
    return NextResponse.json({ sent, answerVideosDeleted })
  } catch (err) {
    console.error("[GET /api/cron/reminders]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
