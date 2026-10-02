import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { courseTeachScope } from "@/lib/permissions"
import { COURSE_LEVELS, type CourseLevel } from "@/lib/levels"
import { assetTypeFromMime, LIBRARY_ASSET_TYPES, type LibraryAssetType, type LibraryItem } from "@/lib/library"

/**
 * The resource library, for picking files into lessons and sessions.
 *
 * The school keeps one library: admins upload the material once, filed by
 * level, and every teacher picks from it — nobody uploads the same handout
 * twice and the office knows what is being taught from. Returned first are the
 * library files (the school's, plus any a tutor uploaded themselves before the
 * library was shared), followed by files already attached to a lesson on a
 * course they teach or to one of their live sessions — those live at stable
 * storage URLs too, so reusing one needs no re-upload.
 */

/** Rows scanned per "used" source before deduplication. */
const USED_SCAN_LIMIT = 300

function parseLevel(value: unknown): CourseLevel | null {
  return COURSE_LEVELS.includes(value as CourseLevel) ? (value as CourseLevel) : null
}

async function handleGET(_req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
    const isAdmin = session.role === "ADMIN"

    const [files, lessonAssets, sessionResources] = await Promise.all([
      prisma.libraryFile.findMany({
        // The school's library is whatever the admins uploaded. A tutor also
        // keeps the files they put in their own library earlier.
        where: isAdmin
          ? { tutor: { role: "ADMIN" } }
          : { OR: [{ tutor: { role: "ADMIN" } }, { tutorId: session.sub }] },
        orderBy: { createdAt: "desc" },
        include: { tutor: { select: { role: true } } },
      }),
      prisma.lessonAsset.findMany({
        // Includes the courses a tutor is put on, so the school's lesson files
        // are pickable into their classes without uploading them again.
        where: { lesson: { section: { course: courseTeachScope(session) } } },
        orderBy: { createdAt: "desc" },
        take: USED_SCAN_LIMIT,
        include: { lesson: { select: { title: true } } },
      }),
      prisma.liveSessionResource.findMany({
        where: {
          session: { tutorId: session.sub },
          // The prep card's internal marker row is not a file.
          title: { not: "__presentation__" },
        },
        orderBy: { createdAt: "desc" },
        take: USED_SCAN_LIMIT,
        include: { session: { select: { title: true } } },
      }),
    ])

    const seen = new Set<string>()
    const items: LibraryItem[] = []

    for (const f of files) {
      if (seen.has(f.fileUrl)) continue
      seen.add(f.fileUrl)
      const shared = f.tutor.role === "ADMIN"
      items.push({
        id: f.id,
        source: "library",
        shared,
        // Admins curate the school's library; a tutor may only tidy away their own.
        canRemove: isAdmin ? shared : f.tutorId === session.sub,
        level: f.level,
        title: f.title,
        fileUrl: f.fileUrl,
        fileName: f.fileName,
        fileSize: f.fileSize,
        mimeType: f.mimeType,
        assetType: f.assetType,
        presentationUrl: f.presentationUrl,
        presentationMimeType: f.presentationMimeType,
        usedIn: null,
        createdAt: f.createdAt.toISOString(),
      })
    }

    for (const a of lessonAssets) {
      if (seen.has(a.fileUrl)) continue
      seen.add(a.fileUrl)
      items.push({
        id: a.id,
        source: "used",
        shared: false,
        canRemove: false,
        level: null,
        title: a.fileName,
        fileUrl: a.fileUrl,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        assetType: a.type,
        presentationUrl: null,
        presentationMimeType: null,
        usedIn: `Lesson: ${a.lesson.title}`,
        createdAt: a.createdAt.toISOString(),
      })
    }

    for (const r of sessionResources) {
      if (seen.has(r.fileUrl)) continue
      seen.add(r.fileUrl)
      items.push({
        id: r.id,
        source: "used",
        shared: false,
        canRemove: false,
        level: null,
        title: r.fileName,
        fileUrl: r.fileUrl,
        fileName: r.fileName,
        fileSize: r.fileSize,
        mimeType: r.mimeType,
        assetType: assetTypeFromMime(r.mimeType),
        presentationUrl: r.presentationUrl,
        presentationMimeType: r.presentationMimeType,
        usedIn: r.session?.title ? `Session: ${r.session.title}` : "Live session",
        createdAt: r.createdAt.toISOString(),
      })
    }

    // `canManage` drives the page: without it the library is browse-and-pick only.
    return NextResponse.json({ items, canManage: isAdmin })
  } catch (err) {
    console.error("[GET /api/tutor/library]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

type IncomingFile = {
  title?: string
  fileUrl: string
  fileName: string
  fileSize?: number | null
  mimeType?: string | null
  assetType: string
  presentationUrl?: string | null
  presentationMimeType?: string | null
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    // Only admins add to the library, so there is one set of material and the
    // office knows exactly what is in it.
    if (session.role !== "ADMIN") {
      return NextResponse.json(
        { message: "The library is managed by the school. Ask an admin to add this file." },
        { status: 403 },
      )
    }

    const body = await req.json() as { files?: IncomingFile[]; level?: string | null }
    const files = Array.isArray(body.files) ? body.files : []
    if (files.length === 0) {
      return NextResponse.json({ message: "No files to add" }, { status: 400 })
    }

    for (const f of files) {
      if (!f.fileUrl || !f.fileName) {
        return NextResponse.json({ message: "Each file needs fileUrl and fileName" }, { status: 400 })
      }
      if (!LIBRARY_ASSET_TYPES.includes(f.assetType as LibraryAssetType)) {
        return NextResponse.json({ message: `Unknown file type "${f.assetType}"` }, { status: 400 })
      }
    }

    const level = parseLevel(body.level)

    // Adding a file that is already in the library is a no-op, not an error.
    const result = await prisma.libraryFile.createMany({
      data: files.map((f) => ({
        tutorId: session.sub,
        title: f.title?.trim() || f.fileName,
        fileUrl: f.fileUrl,
        fileName: f.fileName,
        fileSize: f.fileSize ?? null,
        mimeType: f.mimeType ?? null,
        assetType: f.assetType as LibraryAssetType,
        presentationUrl: f.presentationUrl ?? null,
        presentationMimeType: f.presentationMimeType ?? null,
        level,
      })),
      skipDuplicates: true,
    })

    return NextResponse.json({ added: result.count }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/library]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
