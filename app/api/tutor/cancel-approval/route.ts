import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession, signToken, setSessionCookie } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handlePOST() {
  const session = await getSession()
  if (!session || session.role !== "TUTOR") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { tutorProfile: { select: { isVerified: true } } },
  })

  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 })
  }

  if (user.tutorProfile?.isVerified) {
    return NextResponse.json({ message: "Already verified — cannot cancel" }, { status: 400 })
  }

  // Convert tutor to student: delete tutor profile and change role
  await prisma.$transaction([
    prisma.tutorProfile.delete({ where: { userId: user.id } }),
    prisma.user.update({ where: { id: user.id }, data: { role: "STUDENT" } }),
  ])

  // Issue a new session token with the updated role
  const token = await signToken({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: "STUDENT",
  })

  const res = NextResponse.json({ redirectTo: "/student" })
  setSessionCookie(res, token)
  return res
}

export const POST = withAudit(handlePOST)
