import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { releasedLessons } from "@/lib/lesson-release"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const type = req.nextUrl.searchParams.get("type")?.toUpperCase() ?? ""

    type ResourceAssetType = "PDF" | "DOCUMENT" | "IMAGE" | "AUDIO"
    const resourceTypes: ResourceAssetType[] = ["PDF", "DOCUMENT", "IMAGE", "AUDIO"]

    // All non-VIDEO, non-SUBTITLE assets from lessons in courses the student is enrolled in
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: session.sub },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            sections: {
              orderBy: { order: "asc" },
              include: {
                lessons: {
                  where: releasedLessons(),
                  orderBy: { order: "asc" },
                  include: {
                    assets: {
                      where: {
                        type: type
                          ? { equals: type as ResourceAssetType }
                          : { in: resourceTypes },
                        ...(q ? {
                          OR: [
                            { title: { contains: q, mode: "insensitive" } },
                            { fileName: { contains: q, mode: "insensitive" } },
                          ],
                        } : {}),
                      },
                      orderBy: { order: "asc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    const resources = enrollments.flatMap((enrollment) =>
      enrollment.course.sections.flatMap((section) =>
        section.lessons.flatMap((lesson) =>
          lesson.assets.map((asset) => ({
            id: asset.id,
            type: asset.type,
            title: asset.title,
            description: asset.description,
            fileUrl: asset.fileUrl,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            mimeType: asset.mimeType,
            courseId: enrollment.course.id,
            courseTitle: enrollment.course.title,
            lessonId: lesson.id,
            lessonTitle: lesson.title,
          }))
        )
      )
    )

    return NextResponse.json({ resources, total: resources.length })
  } catch (err) {
    console.error("[GET /api/student/resources]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
