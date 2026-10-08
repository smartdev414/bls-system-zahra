import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { COURSE_LEVELS, type CourseLevel } from "@/lib/levels"

const MAX_WORDS = 5000
const MAX_WORD_LENGTH = 100

// Adds a pasted word list in one go. The signs are created with no video and
// no written details, ready to be worked through on the recording page.
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const body = await req.json() as { words?: unknown; category?: string; level?: CourseLevel }

    const category = body.category?.trim()
    if (!category) return NextResponse.json({ message: "Category is required" }, { status: 400 })
    const level = body.level ?? "L1"
    if (!COURSE_LEVELS.includes(level)) return NextResponse.json({ message: "Invalid level" }, { status: 400 })
    if (!Array.isArray(body.words)) return NextResponse.json({ message: "Words are required" }, { status: 400 })

    // Word is unique in the database, but only for an exact match — compare
    // without case here so "hello" isn't added next to "Hello".
    const seen = new Set<string>()
    const words: string[] = []
    for (const raw of body.words) {
      if (typeof raw !== "string") continue
      const word = raw.trim().replace(/\s+/g, " ")
      if (!word) continue
      if (word.length > MAX_WORD_LENGTH) {
        return NextResponse.json({ message: `"${word.slice(0, 30)}…" is too long (max ${MAX_WORD_LENGTH} characters)` }, { status: 400 })
      }
      const key = word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      words.push(word)
    }

    if (!words.length) return NextResponse.json({ message: "Words are required" }, { status: 400 })
    if (words.length > MAX_WORDS) {
      return NextResponse.json({ message: `Too many words (max ${MAX_WORDS} at a time)` }, { status: 400 })
    }

    const existing = await prisma.sign.findMany({ select: { word: true } })
    const taken = new Set(existing.map((s) => s.word.toLowerCase()))
    const fresh = words.filter((w) => !taken.has(w.toLowerCase()))

    const { count } = await prisma.sign.createMany({
      data: fresh.map((word) => ({ word, category, level, description: "", handshape: "", usage: "" })),
      skipDuplicates: true,
    })

    return NextResponse.json({ created: count, skipped: words.length - count }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/admin/signs/bulk]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
