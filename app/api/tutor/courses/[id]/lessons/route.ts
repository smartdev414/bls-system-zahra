import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { can, courseContentScope } from "@/lib/permissions"
import { isReleased, parseReleaseAt } from "@/lib/lesson-release"
import { parseTestSettings } from "@/lib/quiz"

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId } = await params
    const course = await prisma.course.findFirst({ where: { id: courseId, ...courseContentScope(session) } })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const body = await req.json() as {
      sectionId: string
      title: string
      type: "VIDEO" | "TEXT" | "QUIZ"
      description?: string
      isFree?: boolean
      /** ISO date-time students get the lesson; null or omitted = straight away. */
      releaseAt?: string | null
      /** Tests only: score out of 100 needed to pass, and attempts allowed (null = unlimited). */
      passMark?: number
      maxAttempts?: number | null
      assets?: Array<{
        type: "VIDEO" | "PDF" | "IMAGE" | "DOCUMENT" | "AUDIO" | "SUBTITLE"
        title: string
        description?: string
        fileUrl: string
        fileName: string
        fileSize?: number
        duration?: number
        mimeType?: string
      }>
    }

    const { sectionId, title, type, description, isFree = false, assets = [] } = body

    if (!sectionId || !title?.trim()) {
      return NextResponse.json({ message: "sectionId and title are required" }, { status: 400 })
    }

    const releaseAt = parseReleaseAt(body.releaseAt ?? null)
    if (releaseAt === undefined) {
      return NextResponse.json({ message: "Release date is not a valid date" }, { status: 400 })
    }

    const testSettings = type === "QUIZ" ? parseTestSettings(body) : {}
    if (typeof testSettings === "string") {
      return NextResponse.json({ message: testSettings }, { status: 400 })
    }

    const section = await prisma.section.findFirst({ where: { id: sectionId, courseId } })
    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })

    const lessonCount = await prisma.lesson.count({ where: { sectionId } })

    const lesson = await prisma.lesson.create({
      data: {
        sectionId,
        title: title.trim(),
        type,
        description: description?.trim() ?? null,
        isFree,
        releaseAt,
        ...testSettings,
        order: lessonCount + 1,
        assets: {
          create: assets.map((asset, i) => ({
            type: asset.type,
            title: asset.title,
            description: asset.description ?? null,
            fileUrl: asset.fileUrl,
            fileName: asset.fileName,
            fileSize: asset.fileSize ?? null,
            duration: asset.duration ?? null,
            mimeType: asset.mimeType ?? null,
            order: i,
          })),
        },
      },
      include: { assets: true },
    })

    // Notify enrolled students when a new lesson is added to a published course
    // — unless it is being held back for a later release, when telling them now
    // would point at a lesson they cannot open yet.
    if (course.status === "PUBLISHED" && isReleased(lesson)) {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        select: { studentId: true },
      })
      const studentIds = enrollments.map((e) => e.studentId)
      void createNotifications(
        studentIds,
        "NEW_LESSON",
        "New lesson available",
        `"${title.trim()}" has been added to "${course.title}"`,
        `/student/lessons?courseId=${courseId}`,
      )
    }

    return NextResponse.json({ lesson }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/courses/[id]/lessons]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
