import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can } from "@/lib/permissions"
import {
  DESCRIPTION_GRAMMAR_MAX, DESCRIPTION_MODES, correctDescription, descriptionGrammarConfigured,
  type DescriptionMode,
} from "@/lib/description-grammar"

/**
 * English correction for a course or lesson description, asked for from the
 * "Improve English" menu in the rich text editor. `mode` is "fix" (spelling
 * and grammar only, the default) or a tone to reword the description in.
 *
 * Answers with the corrected HTML, or `corrected: null` when there is nothing
 * to change. As with typed captions, a model that is down or not configured
 * answers 200 — `available: false` or `failed: true` — so the editor can say
 * so without a 5xx for something the tutor can simply do without.
 */

// Per-user ceiling, so a stuck client cannot run up the model bill. Held in
// memory: it resets on deploy and is per instance, which is fine for a ceiling.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10
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
  if (!can(session.role, "lessons.manage")) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  if (!descriptionGrammarConfigured()) {
    return NextResponse.json({ available: false, corrected: null })
  }

  const body = await req.json().catch(() => null) as { html?: unknown; mode?: unknown } | null
  const mode = (body?.mode ?? "fix") as DescriptionMode
  if (!DESCRIPTION_MODES.includes(mode)) {
    return NextResponse.json({ message: "Unknown mode" }, { status: 400 })
  }
  const html = typeof body?.html === "string" ? body.html.trim() : ""
  if (!html) return NextResponse.json({ message: "html is required" }, { status: 400 })
  if (html.length > DESCRIPTION_GRAMMAR_MAX) {
    return NextResponse.json({ message: "This description is too long to check in one go" }, { status: 413 })
  }

  if (overLimit(session.sub)) {
    return NextResponse.json({ message: "Too many requests — try again in a minute" }, { status: 429 })
  }

  try {
    const corrected = await correctDescription(html, mode, req.signal)
    return NextResponse.json({ available: true, corrected: corrected === html ? null : corrected })
  } catch (err) {
    // The tutor left the page and the browser dropped the request: not a failure.
    if (!req.signal.aborted) console.error("[POST /api/tutor/descriptions/correct]", err)
    return NextResponse.json({ available: true, corrected: null, failed: true })
  }
}

export const POST = withAudit(handlePOST)
