import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

/**
 * Every presentation this tutor has ever put in front of a class, newest first.
 *
 * The classroom's slide panel used to list only the current session's own
 * materials, which meant a deck taught last week did not exist as far as the
 * panel was concerned: the tutor had to go back out to their computer, find the
 * folder again and upload the same file a second time. That is the search they
 * were doing over and over.
 *
 * Presentation files live at stable public storage URLs, so a deck registered
 * against any of this tutor's sessions can be presented from any other one
 * without re-uploading a byte.
 */

/** Rows scanned before deduplication. Generous — a busy tutor re-presents the
 *  same handful of decks, so the distinct count is far lower than the row
 *  count, and this is a single indexed read. */
const SCAN_LIMIT = 200

/** Distinct presentations returned. Beyond this the panel's search is the
 *  better tool, and the list stops being a shortcut. */
const RESULT_LIMIT = 40

type RecentPresentation = {
  id: string
  fileName: string
  url: string
  mimeType: string
  totalPages: number | null
  selectedPages: number[] | null
  sessionId: string
  sessionTitle: string | null
  createdAt: string
}

async function handleGET(_req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const rows = await prisma.liveSessionResource.findMany({
      where: {
        // Scoped to sessions this tutor owns. A co-tutor invited to one lesson
        // does not thereby get a copy of the host's whole back catalogue.
        session: { tutorId: session.sub },
        // The internal marker row the prep card writes is not a library item.
        title: { not: "__presentation__" },
      },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        mimeType: true,
        presentationUrl: true,
        presentationMimeType: true,
        totalPages: true,
        selectedPages: true,
        sessionId: true,
        createdAt: true,
        session: { select: { title: true } },
      },
    })

    const seen = new Set<string>()
    const presentations: RecentPresentation[] = []

    for (const row of rows) {
      // A PowerPoint is stored twice: the original for students to download and
      // a converted PDF for the classroom. The PDF is what gets presented.
      const url = row.presentationUrl ?? row.fileUrl
      const mimeType = row.presentationUrl
        ? (row.presentationMimeType ?? "application/pdf")
        : (row.mimeType ?? "")

      if (!url) continue
      // Only what the classroom can actually put on the stage.
      if (mimeType !== "application/pdf" && !mimeType.startsWith("video/")) continue
      if (seen.has(url)) continue
      seen.add(url)

      presentations.push({
        id: row.id,
        // Show the deck under its own name, not the converted PDF's.
        fileName: row.fileName.replace(/\.pptx?$/i, ".pdf"),
        url,
        mimeType,
        totalPages: row.totalPages ?? null,
        selectedPages: Array.isArray(row.selectedPages)
          ? (row.selectedPages as number[])
          : null,
        sessionId: row.sessionId,
        sessionTitle: row.session?.title ?? null,
        createdAt: row.createdAt.toISOString(),
      })

      if (presentations.length >= RESULT_LIMIT) break
    }

    return NextResponse.json({ presentations })
  } catch (err) {
    console.error("[GET /api/tutor/presentations/recent]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
