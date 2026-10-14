import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"

/** Lets an open tab ask whether its login is still the account's current one. */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ ok: true })
}
