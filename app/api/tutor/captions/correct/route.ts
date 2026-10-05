import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { TYPED_CAPTION_MAX } from "@/lib/library"
import { captionGrammarConfigured, correctCaption } from "@/lib/caption-grammar"

/**
 * Grammar check for a caption the tutor is typing in the live classroom.
 *
 * Called when the tutor pauses typing. Answers with a corrected caption, or
 * `corrected: null` when there is nothing to change. A model that is slow, down
 * or not configured is never an error here — the tutor simply gets no
 * suggestion and sends what they typed — so those cases answer 200 rather than
 * paging anyone with a 5xx for every pause in someone's typing.
 */

// Per-tutor ceiling, so a stuck client cannot run up the model bill. Held in
// memory: it resets on deploy and is per instance, which is fine for a ceiling.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 40
const recent = new Map<string, number[]>()

function overLimit(userId: string): boolean {
  const now = Date.now()
  const calls = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  if (calls.length >= MAX_PER_WINDOW) {
    recent.set(userId, calls)
    return true
  }
  calls.push(now)
  recent.set(userId, calls)
  return false
}

async function handlePOST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  if (session.role !== "TUTOR" && session.role !== "ADMIN") {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  if (!captionGrammarConfigured()) {
    return NextResponse.json({ available: false, corrected: null })
  }

  const body = await req.json().catch(() => null) as { text?: unknown } | null
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, TYPED_CAPTION_MAX) : ""
  if (!text) return NextResponse.json({ message: "text is required" }, { status: 400 })

  if (overLimit(session.sub)) {
    return NextResponse.json({ message: "Too many requests" }, { status: 429 })
  }

  try {
    const corrected = await correctCaption(text, req.signal)
    return NextResponse.json({ available: true, corrected: corrected === text ? null : corrected })
  } catch (err) {
    // The tutor typed on and the browser dropped the request: not a failure.
    if (!req.signal.aborted) console.error("[POST /api/tutor/captions/correct]", err)
    return NextResponse.json({ available: true, corrected: null })
  }
}

export const POST = withAudit(handlePOST)
