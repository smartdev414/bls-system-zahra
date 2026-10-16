import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { RECORDER_COOKIE, recorderCookieOptions, verifyRecorderPass } from "@/lib/recorder-pass"

/**
 * POST /api/egress/pass — the recorder page trades the pass from its address
 * for a cookie (see lib/recorder-pass.ts), so pdf.js, <video> and the
 * whiteboard can load the class's material without being signed in.
 */
export async function POST(req: NextRequest) {
  const { pass } = (await req.json().catch(() => ({}))) as { pass?: string }
  const sessionId = pass ? await verifyRecorderPass(pass) : null
  if (!pass || !sessionId) return NextResponse.json({ message: "Invalid pass" }, { status: 401 })

  const liveSession = await prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true } })
  if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

  const res = NextResponse.json({ sessionId })
  res.cookies.set(RECORDER_COOKIE, pass, recorderCookieOptions)
  return res
}
