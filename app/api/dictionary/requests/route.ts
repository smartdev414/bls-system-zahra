import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { MAX_REQUEST_CONTEXT, MAX_REQUEST_WORD } from "@/lib/sign-requests"

async function studentSession() {
  const session = await getSession()
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  if (session.role !== "STUDENT" || !can(session.role, "dictionary.view")) {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }
  return { session }
}

// The signs this student has asked for, newest first.
async function handleGET() {
  try {
    const { session, error } = await studentSession()
    if (error) return error

    const requests = await prisma.signRequest.findMany({
      where: { studentId: session.sub },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, word: true, context: true, status: true, createdAt: true },
    })
    return NextResponse.json({ requests })
  } catch (err) {
    console.error("[GET /api/dictionary/requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// A student asks for a word that isn't in the dictionary yet.
async function handlePOST(req: NextRequest) {
  try {
    const { session, error } = await studentSession()
    if (error) return error

    const body = await req.json().catch(() => ({})) as { word?: unknown; context?: unknown }
    const word = typeof body.word === "string" ? body.word.trim().replace(/\s+/g, " ") : ""
    const context = typeof body.context === "string" ? body.context.trim() : ""
    if (!word) return NextResponse.json({ message: "Type the word you want to learn" }, { status: 400 })
    if (word.length > MAX_REQUEST_WORD) {
      return NextResponse.json({ message: `Keep the word under ${MAX_REQUEST_WORD} characters` }, { status: 400 })
    }
    if (context.length > MAX_REQUEST_CONTEXT) {
      return NextResponse.json({ message: `Keep the example under ${MAX_REQUEST_CONTEXT} characters` }, { status: 400 })
    }

    const existing = await prisma.sign.findFirst({
      where: { word: { equals: word, mode: "insensitive" } },
      select: { id: true, word: true, videoUrl: true, imageUrl: true },
    })
    // Already there to watch: no need to ask.
    if (existing && (existing.videoUrl || existing.imageUrl)) {
      return NextResponse.json(
        { message: `"${existing.word}" is already in the dictionary`, word: existing.word },
        { status: 409 }
      )
    }

    // Asking again for the same word just updates what they said about it.
    const mine = await prisma.signRequest.findFirst({
      where: { studentId: session.sub, status: "OPEN", word: { equals: word, mode: "insensitive" } },
      select: { id: true },
    })
    const request = mine
      ? await prisma.signRequest.update({
          where: { id: mine.id },
          data: { context: context || undefined },
          select: { id: true, word: true, context: true, status: true, createdAt: true },
        })
      : await prisma.signRequest.create({
          // A word already in the dictionary without a video is in the
          // filming list; the request rides along with it.
          data: { studentId: session.sub, word, context, signId: existing?.id ?? null },
          select: { id: true, word: true, context: true, status: true, createdAt: true },
        })

    return NextResponse.json({ request }, { status: mine ? 200 : 201 })
  } catch (err) {
    console.error("[POST /api/dictionary/requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
