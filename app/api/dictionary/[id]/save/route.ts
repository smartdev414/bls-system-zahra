import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"

type Ctx = { params: Promise<{ id: string }> }

// A student's own list of signs, starred from the dictionary to practise later.
async function student() {
  const session = await getSession()
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  if (session.role !== "STUDENT" || !can(session.role, "dictionary.view")) {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }
  return { session }
}

// POST /api/dictionary/[id]/save — star a sign. Starring it twice is fine.
async function handlePOST(_req: NextRequest, { params }: Ctx) {
  try {
    const { session, error } = await student()
    if (error) return error

    const { id } = await params
    const sign = await prisma.sign.findUnique({ where: { id }, select: { id: true } })
    if (!sign) return NextResponse.json({ message: "Sign not found" }, { status: 404 })

    await prisma.savedSign.upsert({
      where: { userId_signId: { userId: session.sub, signId: id } },
      create: { userId: session.sub, signId: id },
      update: {},
    })
    return NextResponse.json({ saved: true })
  } catch (err) {
    console.error("[POST /api/dictionary/[id]/save]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/dictionary/[id]/save — unstar it. Unstarring one not starred is fine too.
async function handleDELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { session, error } = await student()
    if (error) return error

    const { id } = await params
    await prisma.savedSign.deleteMany({ where: { userId: session.sub, signId: id } })
    return NextResponse.json({ saved: false })
  } catch (err) {
    console.error("[DELETE /api/dictionary/[id]/save]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
