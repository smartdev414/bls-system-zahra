import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { requireCapability } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { setStudentApprovalRequired, studentApprovalRequired } from "@/lib/account-approval"

// GET /api/admin/platform-settings — the platform-wide switches on Admin Settings
async function handleGET() {
  try {
    const denied = requireCapability(await getSession(), "settings.manage")
    if (denied) return denied
    return NextResponse.json({ studentApprovalRequired: await studentApprovalRequired() })
  } catch (err) {
    console.error("[GET /api/admin/platform-settings]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/admin/platform-settings — { studentApprovalRequired: boolean }
async function handlePUT(req: NextRequest) {
  try {
    const denied = requireCapability(await getSession(), "settings.manage")
    if (denied) return denied

    const body = (await req.json()) as { studentApprovalRequired?: unknown }
    if (typeof body.studentApprovalRequired !== "boolean") {
      return NextResponse.json({ message: "studentApprovalRequired must be true or false" }, { status: 400 })
    }
    await setStudentApprovalRequired(body.studentApprovalRequired)
    return NextResponse.json({ studentApprovalRequired: body.studentApprovalRequired })
  } catch (err) {
    console.error("[PUT /api/admin/platform-settings]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
