import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { EgressClient, EncodedFileOutput, S3Upload } from "livekit-server-sdk"
import { createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"

function egressClient() {
  return new EgressClient(
    process.env.LIVEKIT_WS_URL!.replace(/^wss?/, "https"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

async function startEgress(roomName: string, sessionId: string): Promise<string | null> {
  try {
    const s3Upload = new S3Upload({
      accessKey: process.env.AWS_ACCESS_KEY_ID!,
      secret: process.env.AWS_SECRET_ACCESS_KEY!,
      bucket: process.env.AWS_S3_BUCKET!,
      region: process.env.AWS_REGION ?? "eu-west-2",
    })
    const fileOutput = new EncodedFileOutput({
      filepath: `recordings/${sessionId}.mp4`,
      output: { case: "s3", value: s3Upload },
    })
    const info = await egressClient().startRoomCompositeEgress(roomName, { file: fileOutput })
    return info.egressId
  } catch (e) {
    console.error("[egress] startEgress failed", e)
    return null
  }
}

async function stopEgress(egressId: string): Promise<void> {
  try {
    await egressClient().stopEgress(egressId)
  } catch (e) {
    console.error("[egress] stopEgress failed", e)
  }
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

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, tutorId: session.sub },
      include: {
        course: { select: { id: true, title: true } },
        attendances: {
          include: {
            student: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
    })

    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    return NextResponse.json({
      session: {
        id: liveSession.id,
        title: liveSession.title,
        description: liveSession.description,
        scheduledAt: liveSession.scheduledAt.toISOString(),
        durationMins: liveSession.durationMins,
        roomName: liveSession.roomName,
        maxStudents: liveSession.maxStudents,
        status: liveSession.status,
        startedAt: liveSession.startedAt?.toISOString() ?? null,
        endedAt: liveSession.endedAt?.toISOString() ?? null,
        course: liveSession.course,
        attendances: liveSession.attendances.map((a) => ({
          studentId: a.studentId,
          studentName: a.student.name,
          studentEmail: a.student.email,
          joinedAt: a.joinedAt?.toISOString() ?? null,
          leftAt: a.leftAt?.toISOString() ?? null,
        })),
      },
    })
  } catch (err) {
    console.error("[GET /api/tutor/sessions/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePATCH(
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
    const existing = await prisma.liveSession.findFirst({ where: { id, tutorId: session.sub } })
    if (!existing) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const body = await req.json() as {
      status?: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
      title?: string
      description?: string
      scheduledAt?: string
      durationMins?: number
      maxStudents?: number | null
      visibility?: "PUBLIC" | "INVITE_ONLY"
      invitedStudentIds?: string[]
    }

    const data: Record<string, unknown> = {}
    if (body.title) data.title = body.title.trim()
    if (body.description !== undefined) data.description = body.description?.trim() ?? null
    if (body.scheduledAt) data.scheduledAt = new Date(body.scheduledAt)
    if (body.durationMins) data.durationMins = body.durationMins
    if (body.maxStudents !== undefined) data.maxStudents = body.maxStudents
    if (body.visibility) data.visibility = body.visibility
    if (body.status) {
      data.status = body.status
      if (body.status === "LIVE" && !existing.startedAt) {
        data.startedAt = new Date()
        const egressId = await startEgress(existing.roomName, id)
        if (egressId) {
          data.egressId = egressId
          data.recordingKey = `recordings/${id}.mp4`
        }
      }
      if (body.status === "COMPLETED" && !existing.endedAt) {
        data.endedAt = new Date()
        if (existing.egressId) {
          await stopEgress(existing.egressId)
          // Set recordingUrl optimistically — webhook will confirm once upload finishes
          const key = existing.recordingKey ?? `recordings/${id}.mp4`
          data.recordingKey = key
          data.recordingUrl  = key
        }
      }
    }

    const updated = await prisma.liveSession.update({ where: { id }, data })

    // Sync invites when invitedStudentIds is provided
    if (body.invitedStudentIds !== undefined && body.visibility === "INVITE_ONLY") {
      await prisma.liveSessionInvite.deleteMany({ where: { sessionId: id } })
      if (body.invitedStudentIds.length > 0) {
        await prisma.liveSessionInvite.createMany({
          data: body.invitedStudentIds.map((studentId) => ({ sessionId: id, studentId })),
          skipDuplicates: true,
        })
      }
    }

    // Notify students on critical status transitions
    if (body.status === "LIVE" || body.status === "CANCELLED") {
      // Gather the relevant audience: invited students (INVITE_ONLY) or enrolled students (PUBLIC)
      const audienceIds = existing.visibility === "INVITE_ONLY"
        ? (await prisma.liveSessionInvite.findMany({
            where: { sessionId: id },
            select: { studentId: true },
          })).map((i) => i.studentId)
        : existing.courseId
          ? (await prisma.enrollment.findMany({
              where: { courseId: existing.courseId },
              select: { studentId: true },
            })).map((e) => e.studentId)
          : []

      if (audienceIds.length > 0) {
        if (body.status === "LIVE") {
          void createNotifications(
            audienceIds,
            "SESSION_STARTED",
            "Live session has started!",
            `"${existing.title}" is now live — join now`,
            `/student/classroom`,
          )
        } else if (body.status === "CANCELLED") {
          void createNotifications(
            audienceIds,
            "SESSION_CANCELLED",
            "Live session cancelled",
            `"${existing.title}" has been cancelled`,
            `/student/classroom`,
          )
        }
      }
    }

    return NextResponse.json({ session: updated })
  } catch (err) {
    console.error("[PATCH /api/tutor/sessions/[id]]", err)
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
    const existing = await prisma.liveSession.findFirst({ where: { id, tutorId: session.sub } })
    if (!existing) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    // Notify audience before deleting
    const audienceIds = existing.visibility === "INVITE_ONLY"
      ? (await prisma.liveSessionInvite.findMany({
          where: { sessionId: id },
          select: { studentId: true },
        })).map((i) => i.studentId)
      : existing.courseId
        ? (await prisma.enrollment.findMany({
            where: { courseId: existing.courseId },
            select: { studentId: true },
          })).map((e) => e.studentId)
        : []

    if (audienceIds.length > 0) {
      void createNotifications(
        audienceIds,
        "SESSION_DELETED",
        "Live session removed",
        `"${existing.title}" has been removed by the tutor`,
        `/student/classroom`,
      )
    }

    await prisma.liveSession.delete({ where: { id } })
    return NextResponse.json({ message: "Session deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/sessions/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
