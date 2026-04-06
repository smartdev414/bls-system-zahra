import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function verifyLessonOwnership(lessonId: string, tutorId: string) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, section: { course: { tutorId } } },
    include: { section: { include: { course: { select: { tutorId: true, id: true } } } } },
  })
  return lesson
}

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const lesson = await verifyLessonOwnership(id, session.sub)
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    const full = await prisma.lesson.findUnique({
      where: { id },
      include: {
        assets: { orderBy: { order: "asc" } },
        questions: {
          orderBy: { order: "asc" },
          include: { options: { orderBy: { order: "asc" } } },
        },
        section: { select: { courseId: true } },
      },
    })

    return NextResponse.json({ lesson: full })
  } catch (err) {
    console.error("[GET /api/tutor/lessons/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const lesson = await verifyLessonOwnership(id, session.sub)
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    const body = await req.json() as {
      title?: string
      description?: string
      type?: "VIDEO" | "TEXT" | "QUIZ"
      isFree?: boolean
    }

    const updated = await prisma.lesson.update({
      where: { id },
      data: {
        ...(body.title && { title: body.title.trim() }),
        ...(body.description !== undefined && { description: body.description?.trim() ?? null }),
        ...(body.type && { type: body.type }),
        ...(typeof body.isFree === "boolean" && { isFree: body.isFree }),
      },
      include: { assets: { orderBy: { order: "asc" } } },
    })

    return NextResponse.json({ lesson: updated })
  } catch (err) {
    console.error("[PUT /api/tutor/lessons/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const lesson = await verifyLessonOwnership(id, session.sub)
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    await prisma.lesson.delete({ where: { id } })
    return NextResponse.json({ message: "Lesson deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/lessons/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
