import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { cleanStatesForUrls } from "@/lib/background-clean"

/**
 * Where background replacement stands for a list of stored video URLs (see
 * lib/background-clean.ts). A POST only because the list can be long; it
 * changes nothing. Polled by the lesson and sign screens, so not audited.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
    const { urls } = await req.json() as { urls?: unknown }
    if (!Array.isArray(urls) || urls.length > 500 || urls.some((u) => typeof u !== "string")) {
      return NextResponse.json({ message: "urls must be a list of up to 500 strings" }, { status: 400 })
    }
    return NextResponse.json({ states: await cleanStatesForUrls(urls as string[]) })
  } catch (err) {
    console.error("[POST /api/upload/clean-background/status]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
