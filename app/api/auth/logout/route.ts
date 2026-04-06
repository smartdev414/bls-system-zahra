import { NextResponse } from "next/server"
import { clearSessionCookie } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleDELETE() {
  const res = NextResponse.json({ message: "Logged out" })
  clearSessionCookie(res)
  return res
}

export const DELETE = withAudit(handleDELETE)
