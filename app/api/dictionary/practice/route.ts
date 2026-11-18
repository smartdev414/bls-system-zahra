import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { DEFAULT_ANSWER_SECONDS } from "@/lib/quiz"
import { savedPracticeSigns, savedTestRound, weekPracticeRound } from "@/lib/sign-practice"

// GET /api/dictionary/practice?set=saved|week — a round of practice signs,
// words included: practice is marked on the student's own screen and nothing
// is recorded (lib/sign-practice.ts).
//   saved — the student's starred signs, as flashcards.
//   week  — this week's signs for the timed vocabulary game; the starred signs
//           when nothing was taught this week (`source` says which it was).
//   mine  — the starred signs only, in the timed vocabulary game.
async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT" || !can(session.role, "dictionary.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const set = req.nextUrl.searchParams.get("set")
    if (set === "week" || set === "mine") {
      const round = set === "week" ? await weekPracticeRound(session.sub) : await savedTestRound(session.sub)
      return NextResponse.json({ ...round, answerSeconds: DEFAULT_ANSWER_SECONDS })
    }
    return NextResponse.json({ source: "saved", signs: await savedPracticeSigns(session.sub) })
  } catch (err) {
    console.error("[GET /api/dictionary/practice]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
