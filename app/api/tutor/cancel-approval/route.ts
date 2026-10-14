import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession, signToken, setSessionCookie, PENDING_PATH } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { notifyStaffOfSignup, studentApprovalRequired } from "@/lib/account-approval"

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

  // Convert tutor to student: delete tutor profile and change role. They were
  // never approved, so they join the student waiting list like any new sign-up
  // — otherwise "sign up as a tutor, then switch" would skip approval.
  const pending = await studentApprovalRequired()
  await prisma.$transaction([
    prisma.tutorProfile.delete({ where: { userId: user.id } }),
    prisma.user.update({
      where: { id: user.id },
      data: { role: "STUDENT", status: pending ? "PENDING" : "ACTIVE" },
    }),
  ])
  if (pending) void notifyStaffOfSignup({ ...user, role: "STUDENT" })

  // Issue a new session token with the updated role
  const token = await signToken({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: "STUDENT",
  })

  const res = NextResponse.json({ redirectTo: pending ? PENDING_PATH : "/student" })
  setSessionCookie(res, token)
  return res
}

export const POST = withAudit(handlePOST)
