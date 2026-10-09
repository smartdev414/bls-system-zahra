import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { runpodBalance } from "@/lib/background-clean"

/**
 * Credit left on the RunPod account that runs background replacement (see
 * lib/background-clean.ts). Fetched by the header on every admin page, so not
 * audited.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  return NextResponse.json({ balance: await runpodBalance() })
}
