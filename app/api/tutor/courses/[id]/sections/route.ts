import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { courseContentScope } from "@/lib/permissions"

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId } = await params
    const course = await prisma.course.findFirst({ where: { id: courseId, ...courseContentScope(session) } })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const { title } = await req.json() as { title: string }
    if (!title?.trim()) return NextResponse.json({ message: "Title is required" }, { status: 400 })

    const count = await prisma.section.count({ where: { courseId } })
    const section = await prisma.section.create({
      data: { courseId, title: title.trim(), order: count + 1 },
    })

    return NextResponse.json({ section }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/courses/[id]/sections]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
