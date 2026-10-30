import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { fulfilSignRequests } from "@/lib/sign-requests"

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

// "Not adding": closes every open request for the word.
async function handleDELETE(req: NextRequest) {
  try {
    const denied = await adminSession()
    if (denied) return denied

    const word = req.nextUrl.searchParams.get("word")?.trim() ?? ""
    if (!word) return NextResponse.json({ message: "Word is required" }, { status: 400 })

    const { count } = await prisma.signRequest.updateMany({
      where: { status: "OPEN", word: { equals: word, mode: "insensitive" } },
      data: { status: "DECLINED", resolvedAt: new Date() },
    })
    return NextResponse.json({ declined: count })
  } catch (err) {
    console.error("[DELETE /api/admin/sign-requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
