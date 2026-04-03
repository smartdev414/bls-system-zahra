import { NextResponse } from "next/server"
import { clearSessionCookie } from "@/lib/auth"

export async function DELETE() {
  const res = NextResponse.json({ message: "Logged out" })
  clearSessionCookie(res)
  return res
}
