import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { COURSE_LEVELS, type CourseLevel } from "@/lib/levels"

type RouteContext = { params: Promise<{ fileId: string }> }

/**
 * Which library files this person may change: admins look after the school's
 * library (any admin's uploads); a tutor only the files they added themselves.
 */
function manageableFiles(session: { role: string; sub: string }) {
  return session.role === "ADMIN" ? { tutor: { role: "ADMIN" as const } } : { tutorId: session.sub }
}

/** Re-file a library file under another level, or rename it. Admins only. */
async function handlePATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { fileId } = await params
    const body = await req.json() as { level?: string | null; title?: string }

    const data: { level?: CourseLevel | null; title?: string } = {}
    if (body.level !== undefined) {
      if (body.level !== null && !COURSE_LEVELS.includes(body.level as CourseLevel)) {
        return NextResponse.json({ message: "Unknown level" }, { status: 400 })
      }
      data.level = body.level as CourseLevel | null
    }
    if (body.title?.trim()) data.title = body.title.trim()

    const { count } = await prisma.libraryFile.updateMany({
      where: { id: fileId, ...manageableFiles(session) },
      data,
    })
    if (count === 0) return NextResponse.json({ message: "File not found" }, { status: 404 })

    return NextResponse.json({ message: "Library file updated" })
  } catch (err) {
    console.error("[PATCH /api/tutor/library/[fileId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

/**
 * Remove a file from the library. The stored file itself is left alone: lessons
 * and sessions that picked it hold their own reference to the same URL.
 */
async function handleDELETE(_req: Request, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { fileId } = await params
    const { count } = await prisma.libraryFile.deleteMany({
      where: { id: fileId, ...manageableFiles(session) },
    })
    if (count === 0) return NextResponse.json({ message: "File not found" }, { status: 404 })

    return NextResponse.json({ message: "Removed from library" })
  } catch (err) {
    console.error("[DELETE /api/tutor/library/[fileId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
