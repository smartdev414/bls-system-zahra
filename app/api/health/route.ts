import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"

// Public health probe for an external uptime monitor (UptimeRobot, BetterStack,
// etc.). Returns 200 when the app + database are healthy, 503 otherwise, plus a
// presence map of critical integration env vars (booleans only — never values)
// so a quick GET tells you what's misconfigured. No auth: it leaks no secrets.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const present = (...names: string[]) => names.every((n) => !!process.env[n])

export async function GET() {
  let db = false
  try {
    await prisma.$queryRaw`SELECT 1`
    db = true
  } catch (err) {
    console.error("[GET /api/health] db check failed", err)
  }

  const config = {
    database: present("DATABASE_URL"),
    livekit: present("LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_WS_URL"),
    pusher: present("PUSHER_APP_ID", "PUSHER_SECRET", "NEXT_PUBLIC_PUSHER_KEY", "NEXT_PUBLIC_PUSHER_CLUSTER"),
    email: present("MAILGUN_API_KEY", "MAILGUN_DOMAIN"),
    storage: present("AWS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"),
    // Captions use LiveKit Inference STT; agent worker is deployed separately on LiveKit Cloud.
    captions: present("LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_WS_URL"),
    // Optional: grammar suggestions on captions a tutor types.
    captionGrammar: present("OPENAI_API_KEY"),
    alerting: present("ALERT_WEBHOOK_URL"),
  }

  const status = db ? "ok" : "degraded"
  return NextResponse.json(
    { status, db, config, ts: new Date().toISOString() },
    { status: db ? 200 : 503 },
  )
}
