import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { MAX_REQUEST_REPLY, fulfilSignRequests, replyToSignRequests } from "@/lib/sign-requests"

// Where a requested word lands if whoever filmed it didn't pick a category.
const REQUESTED_CATEGORY = "Requested"

async function adminSession() {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  return null
}

// How many words students are waiting on, for the Record videos button.
async function handleGET() {
  try {
    const denied = await adminSession()
    if (denied) return denied
    const words = await prisma.signRequest.findMany({
      where: { status: "OPEN" },
      select: { word: true },
    })
    return NextResponse.json({ open: new Set(words.map((w) => w.word.toLowerCase())).size })
  } catch (err) {
    console.error("[GET /api/admin/sign-requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// A take was filmed for a requested word that isn't in the dictionary yet:
// the sign is made with it (or, if someone added the word meanwhile, given it).
async function handlePOST(req: NextRequest) {
  try {
    const denied = await adminSession()
    if (denied) return denied

    const body = await req.json().catch(() => ({})) as { word?: unknown; videoUrl?: unknown; category?: unknown }
    const word = typeof body.word === "string" ? body.word.trim() : ""
    const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : ""
    const category = typeof body.category === "string" ? body.category.trim() : ""
    if (!word || !videoUrl) return NextResponse.json({ message: "Word and video are required" }, { status: 400 })

    const existing = await prisma.sign.findFirst({
      where: { word: { equals: word, mode: "insensitive" } },
      select: { id: true },
    })
    const sign = existing
      ? await prisma.sign.update({ where: { id: existing.id }, data: { videoUrl, ...(category && { category }) } })
      : await prisma.sign.create({
          data: { word, category: category || REQUESTED_CATEGORY, description: "", handshape: "", usage: "", videoUrl },
        })

    await prisma.signRequest.updateMany({
      where: { status: "OPEN", word: { equals: word, mode: "insensitive" } },
      data: { signId: sign.id },
    })
    await fulfilSignRequests(sign)

    return NextResponse.json({ sign }, { status: existing ? 200 : 201 })
  } catch (err) {
    console.error("[POST /api/admin/sign-requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// "Reply": closes every open request for the word. With a message (e.g. "there
// is no single sign for this — it's shown like this…") each student who asked
// gets it in the app and by email; without one the request just closes.
async function handleDELETE(req: NextRequest) {
  try {
    const denied = await adminSession()
    if (denied) return denied

    const word = req.nextUrl.searchParams.get("word")?.trim() ?? ""
    if (!word) return NextResponse.json({ message: "Word is required" }, { status: 400 })
    const body = await req.json().catch(() => ({})) as { message?: unknown }
    const message = typeof body.message === "string" ? body.message.trim() : ""
    if (message.length > MAX_REQUEST_REPLY) {
      return NextResponse.json({ message: `Keep the reply under ${MAX_REQUEST_REPLY} characters` }, { status: 400 })
    }

    const open = await prisma.signRequest.findMany({
      where: { status: "OPEN", word: { equals: word, mode: "insensitive" } },
      select: { id: true, studentId: true, word: true },
    })
    await prisma.signRequest.updateMany({
      where: { id: { in: open.map((r) => r.id) } },
      data: { status: "DECLINED", resolvedAt: new Date() },
    })
    const notified = message ? await replyToSignRequests(open, message) : 0
    return NextResponse.json({ declined: open.length, notified })
  } catch (err) {
    console.error("[DELETE /api/admin/sign-requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// "Hold": the admin wants to research the word before filming it or replying.
// It stays open but moves below the other requests, and the students see
// "Looking into it". `{ hold: false }` puts it back with the others.
async function handlePATCH(req: NextRequest) {
  try {
    const denied = await adminSession()
    if (denied) return denied

    const word = req.nextUrl.searchParams.get("word")?.trim() ?? ""
    if (!word) return NextResponse.json({ message: "Word is required" }, { status: 400 })
    const body = await req.json().catch(() => ({})) as { hold?: unknown }
    if (typeof body.hold !== "boolean") return NextResponse.json({ message: "Say whether to hold it" }, { status: 400 })

    const { count } = await prisma.signRequest.updateMany({
      where: { status: "OPEN", word: { equals: word, mode: "insensitive" } },
      data: { heldAt: body.hold ? new Date() : null },
    })
    if (count === 0) return NextResponse.json({ message: "Nobody is waiting for this word any more" }, { status: 404 })
    return NextResponse.json({ held: body.hold, requests: count })
  } catch (err) {
    console.error("[PATCH /api/admin/sign-requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PATCH = withAudit(handlePATCH)
export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
