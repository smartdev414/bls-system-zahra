import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getAccountSession, getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    // A student waiting for approval can still read their own profile: the
    // mobile app loads it to learn it should show its waiting screen.
    const found = await getAccountSession()
    const session = found?.session
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        avatarUrl: true,
        bslLevel: true,
        createdAt: true,
        recordingOptOut: true,
        recordingOptOutByStaff: true,
        tutorProfile: { select: { bio: true, qualifications: true, isVerified: true } },
      },
    })

    if (!user) return NextResponse.json({ message: "User not found" }, { status: 404 })

    // Every course they were on has closed (lib/course-closing.ts): the app
    // shows its "your course has finished" screen, as the web does.
    return NextResponse.json({ user, courseFinished: found?.state === "finished" })
  } catch (err) {
    console.error("[GET /api/user/settings]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const body = await req.json() as {
      name?: string
      avatarUrl?: string | null
      bslLevel?: import("@/app/generated/prisma/client").CourseLevel | null
      bio?: string
      qualifications?: string[]
      /** A student's "leave my face out of class recordings". */
      recordingOptOut?: boolean
    }

    const { name, avatarUrl, bslLevel, bio, qualifications, recordingOptOut } = body

    if (typeof recordingOptOut === "boolean") {
      if (session.role !== "STUDENT") {
        return NextResponse.json({ message: "Only students are in class recordings" }, { status: 400 })
      }
      // Staff turned it on (usually a safeguarding case): only staff turn it off.
      if (!recordingOptOut) {
        const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { recordingOptOutByStaff: true } })
        if (me?.recordingOptOutByStaff) {
          return NextResponse.json(
            { message: "Your school has turned this on for you. Please speak to them to change it." },
            { status: 403 },
          )
        }
      }
    }

    const user = await prisma.user.update({
      where: { id: session.sub },
      data: {
        ...(name?.trim() && { name: name.trim() }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(bslLevel !== undefined && { bslLevel }),
        ...(typeof recordingOptOut === "boolean" && { recordingOptOut }),
      },
      select: {
        id: true, name: true, email: true, role: true, avatarUrl: true, bslLevel: true,
        recordingOptOut: true, recordingOptOutByStaff: true,
      },
    })

    // Update tutor profile if applicable
    if (session.role === "TUTOR" && (bio !== undefined || qualifications !== undefined)) {
      await prisma.tutorProfile.update({
        where: { userId: session.sub },
        data: {
          ...(bio !== undefined && { bio: bio.trim() }),
          ...(qualifications !== undefined && { qualifications }),
        },
      })
    }

    return NextResponse.json({ user })
  } catch (err) {
    console.error("[PUT /api/user/settings]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
