import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { can, courseContentScope } from "@/lib/permissions"
import { isReleased, parseReleaseAt, releaseInSection } from "@/lib/lesson-release"
import { placeTest } from "@/lib/tests"
import { normalizeAssetUrl } from "@/lib/video-link"

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
      /** Tests only: the test from the test bank to put here. Its title is used. */
      testId?: string
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

    if (!sectionId || (type !== "QUIZ" && !title?.trim())) {
      return NextResponse.json({ message: "sectionId and title are required" }, { status: 400 })
    }

    const releaseAt = parseReleaseAt(body.releaseAt ?? null)
    if (releaseAt === undefined) {
      return NextResponse.json({ message: "Release date is not a valid date" }, { status: 400 })
    }

    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId },
      include: { lessons: { orderBy: { order: "asc" }, select: { releaseAt: true } } },
    })
    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })

    // A test is made in the test bank and only put here.
    if (type === "QUIZ") {
      const test = body.testId
        ? await prisma.test.findUnique({ where: { id: body.testId }, select: { id: true, title: true, description: true } })
        : null
      if (!test) return NextResponse.json({ message: "Choose a test from the test bank" }, { status: 400 })
      const lesson = await placeTest(test, { id: sectionId, course }, releaseAt)
      return NextResponse.json({ lesson }, { status: 201 })
    }

    const lesson = await prisma.lesson.create({
      data: {
        sectionId,
        title: title.trim(),
        type,
        description: description?.trim() ?? null,
        isFree,
        releaseAt: releaseInSection(section.lessons, releaseAt),
        order: section.lessons.length + 1,
        assets: {
          create: assets.map((asset, i) => ({
            type: asset.type,
            title: asset.title,
            description: asset.description ?? null,
            fileUrl: normalizeAssetUrl(asset.fileUrl),
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
