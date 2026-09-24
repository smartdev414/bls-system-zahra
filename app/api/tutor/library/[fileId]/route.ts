import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

/**
 * Remove a file from the library. The stored file itself is left alone: lessons
 * and sessions that picked it hold their own reference to the same URL.
 */
async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { fileId } = await params
    const { count } = await prisma.libraryFile.deleteMany({
      where: { id: fileId, tutorId: session.sub },
    })
    if (count === 0) return NextResponse.json({ message: "File not found" }, { status: 404 })

    return NextResponse.json({ message: "Removed from library" })
  } catch (err) {
    console.error("[DELETE /api/tutor/library/[fileId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const DELETE = withAudit(handleDELETE)
