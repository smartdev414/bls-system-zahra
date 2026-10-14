import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getAccountSession, getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    // A student waiting for approval can still read their own profile: the
    // mobile app loads it to learn it should show its waiting screen.
    const session = (await getAccountSession())?.session
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
        tutorProfile: { select: { bio: true, qualifications: true, isVerified: true } },
      },
    })

    if (!user) return NextResponse.json({ message: "User not found" }, { status: 404 })

    return NextResponse.json({ user })
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
    }

    const { name, avatarUrl, bslLevel, bio, qualifications } = body

    const user = await prisma.user.update({
      where: { id: session.sub },
      data: {
        ...(name?.trim() && { name: name.trim() }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(bslLevel !== undefined && { bslLevel }),
      },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, bslLevel: true },
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
