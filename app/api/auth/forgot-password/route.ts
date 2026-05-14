import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import prisma from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { passwordResetEmail } from "@/lib/email-templates"
import { withAudit } from "@/lib/audit"

const RESET_EXPIRY_MINUTES = 60

// Always returns 200 so attackers can't probe which emails exist.
async function handlePOST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string }

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { message: "Email is required" },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, passwordHash: true },
    })
    console.log('user ============>', user);
    // Only issue a token for users with a password (skip OAuth-only accounts).
    if (user && user.passwordHash) {
      // Invalidate any outstanding tokens so only the latest one works.
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      })

      const token = crypto.randomBytes(32).toString("hex")
      const expiresAt = new Date(Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000)

      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      })

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        `${req.nextUrl.protocol}//${req.nextUrl.host}`
      const resetUrl = `${baseUrl}/reset-password/${token}`

      const { subject, html } = passwordResetEmail(
        user.name,
        resetUrl,
        RESET_EXPIRY_MINUTES
      )
      try {
        await sendEmail(user.email, subject, html)
      } catch (err) {
        console.error("[forgot-password] sendEmail failed", err)
      }
    }

    return NextResponse.json({
      message:
        "If an account exists for that email, a password reset link has been sent.",
    })
  } catch (err) {
    console.error("[POST /api/auth/forgot-password]", err)
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    )
  }
}

export const POST = withAudit(handlePOST)
