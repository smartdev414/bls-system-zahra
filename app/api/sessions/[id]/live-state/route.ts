import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@/app/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { assertCanAccessSession } from "@/lib/session-access"
import { recorderSessionId } from "@/lib/recorder-pass"

// ─── /api/sessions/[id]/live-state ───────────────────────────────────────────
// The classroom stage (slides / video) as last published by the tutor.
//
// The LiveKit data channel only delivers "from now on", so a student who joins
// late — or reloads while the tutor's own tab is reloading too — has nobody to
// ask what is on screen. The tutor writes this row on every start / navigate /
// stop; everyone else reads it on mount and on reconnect.

type StageState = {
  active: boolean
  kind: "slides" | "video" | null
  url: string | null
  page: number
  totalPages: number
  selectedPages: number[]
  videoPlaying: boolean
  videoTime: number
  updatedAt: number
}

function serialize(row: {
  active: boolean
  kind: string | null
  url: string | null
  page: number
  totalPages: number
  selectedPages: Prisma.JsonValue | null
  videoPlaying: boolean
  videoTime: number
  updatedAt: Date
}): StageState {
  const selected = Array.isArray(row.selectedPages)
    ? row.selectedPages.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
    : []

  return {
    active: row.active,
    kind: row.kind === "slides" || row.kind === "video" ? row.kind : null,
    url: row.url,
    page: row.page,
    totalPages: row.totalPages,
    selectedPages: selected,
    videoPlaying: row.videoPlaying,
    videoTime: row.videoTime,
    updatedAt: row.updatedAt.getTime(),
  }
}

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params
    const auth = await getSession()
    if (auth) {
      const access = await assertCanAccessSession(auth, sessionId)
      if (access.error) return access.error
    } else if ((await recorderSessionId()) !== sessionId) {
      // The class recorder may read what is on this class's stage, nothing else.
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    const row = await prisma.liveSessionPresentation.findUnique({ where: { sessionId } })

    return NextResponse.json({ state: row ? serialize(row) : null })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/live-state]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getSession()
    if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id: sessionId } = await params
    const access = await assertCanAccessSession(auth, sessionId)
    if (access.error) return access.error
    // Only whoever is teaching drives the stage. Students read this endpoint.
    if (!access.isTutor) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const body = await req.json() as {
      active?: unknown
      kind?: unknown
      url?: unknown
      page?: unknown
      totalPages?: unknown
      selectedPages?: unknown
      videoPlaying?: unknown
      videoTime?: unknown
    }

    const active = body.active === true
    const kind = body.kind === "slides" || body.kind === "video" ? body.kind : null
    const url = typeof body.url === "string" && body.url.length > 0 ? body.url : null

    // An "active" stage without a source is meaningless — reject rather than
    // storing a record that would blank out every student that reads it.
    if (active && (!kind || !url)) {
      return NextResponse.json({ message: "kind and url are required when active" }, { status: 400 })
    }
    if (url && url.length > 2048) {
      return NextResponse.json({ message: "url too long" }, { status: 400 })
    }

    const page = Number.isInteger(body.page) && (body.page as number) > 0 ? body.page as number : 1
    const totalPages =
      Number.isInteger(body.totalPages) && (body.totalPages as number) >= 0 ? body.totalPages as number : 0
    const selectedPages = Array.isArray(body.selectedPages)
      ? body.selectedPages.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 2000)
      : []
    const videoPlaying = body.videoPlaying === true
    const videoTime =
      typeof body.videoTime === "number" && Number.isFinite(body.videoTime) && body.videoTime >= 0
        ? body.videoTime
        : 0

    const data = {
      active,
      kind,
      url,
      page,
      totalPages,
      selectedPages: selectedPages as Prisma.InputJsonValue,
      videoPlaying,
      videoTime,
    }

    const row = await prisma.liveSessionPresentation.upsert({
      where: { sessionId },
      create: { sessionId, ...data },
      update: data,
    })

    return NextResponse.json({ state: serialize(row) })
  } catch (err) {
    console.error("[PUT /api/sessions/[id]/live-state]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
