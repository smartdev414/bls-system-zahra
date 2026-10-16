import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can } from "@/lib/permissions"
import {
  QUESTION_GRAMMAR_MAX, QUESTION_GRAMMAR_MAX_ANSWERS, correctQuestion, questionGrammarConfigured,
} from "@/lib/question-grammar"

/**
 * English correction for one test question and its answers, asked for with
 * the "Fix English" button in the test builder. Nothing is saved: the builder
 * puts the corrected text in the fields and the tutor saves as usual.
 *
 *   POST { question: string, answers: string[] }
 *   → { available, corrected: { question, answers } | null, failed? }
 *
 * `corrected` is null when there was nothing to change. As with descriptions,
 * a model that is down or not configured answers 200 — `available: false` or
 * `failed: true` — rather than a 5xx for something the tutor can do without.
 */

// Per-user ceiling, so a stuck client cannot run up the model bill. Held in
// memory: it resets on deploy and is per instance, which is fine for a ceiling.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20
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
  if (!can(session.role, "tests.manage")) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  if (!questionGrammarConfigured()) {
    return NextResponse.json({ available: false, corrected: null })
  }

  const body = await req.json().catch(() => null) as { question?: unknown; answers?: unknown } | null
  const question = typeof body?.question === "string" ? body.question : ""
  const answers = Array.isArray(body?.answers) ? body.answers : []
  if (answers.length > QUESTION_GRAMMAR_MAX_ANSWERS || answers.some((a) => typeof a !== "string")) {
    return NextResponse.json({ message: "answers must be a list of text" }, { status: 400 })
  }
  const input = { question, answers: answers as string[] }
  if (![input.question, ...input.answers].some((t) => t.trim())) {
    return NextResponse.json({ message: "There is no text to correct" }, { status: 400 })
  }
  if ([input.question, ...input.answers].some((t) => t.length > QUESTION_GRAMMAR_MAX)) {
    return NextResponse.json({ message: "This question is too long to check" }, { status: 413 })
  }

  if (overLimit(session.sub)) {
    return NextResponse.json({ message: "Too many requests — try again in a minute" }, { status: 429 })
  }

  try {
    const corrected = await correctQuestion(input, req.signal)
    const same = corrected.question === input.question && corrected.answers.every((a, i) => a === input.answers[i])
    return NextResponse.json({ available: true, corrected: same ? null : corrected })
  } catch (err) {
    // The tutor left the page and the browser dropped the request: not a failure.
    if (!req.signal.aborted) console.error("[POST /api/tests/questions/correct]", err)
    return NextResponse.json({ available: true, corrected: null, failed: true })
  }
}

export const POST = withAudit(handlePOST)
