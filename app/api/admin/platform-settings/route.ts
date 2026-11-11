import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { requireCapability } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { setStudentApprovalRequired, studentApprovalRequired } from "@/lib/account-approval"
import { cleanSubscriptionUrl, setSubscriptionUrl, subscriptionUrl } from "@/lib/subscription-link"

// GET /api/admin/platform-settings — the platform-wide switches on Admin Settings
async function handleGET() {
  try {
    const denied = requireCapability(await getSession(), "settings.manage")
    if (denied) return denied
    const [approval, subscription] = await Promise.all([studentApprovalRequired(), subscriptionUrl()])
    return NextResponse.json({ studentApprovalRequired: approval, subscriptionUrl: subscription })
  } catch (err) {
    console.error("[GET /api/admin/platform-settings]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/admin/platform-settings — { studentApprovalRequired?: boolean, subscriptionUrl?: string | null }
async function handlePUT(req: NextRequest) {
  try {
    const denied = requireCapability(await getSession(), "settings.manage")
    if (denied) return denied

    const body = (await req.json()) as { studentApprovalRequired?: unknown; subscriptionUrl?: unknown }
    if (body.studentApprovalRequired !== undefined && typeof body.studentApprovalRequired !== "boolean") {
      return NextResponse.json({ message: "studentApprovalRequired must be true or false" }, { status: 400 })
    }
    const url = body.subscriptionUrl === undefined ? undefined : cleanSubscriptionUrl(body.subscriptionUrl)
    if (body.subscriptionUrl !== undefined && url === undefined) {
      return NextResponse.json({ message: "That isn't a web address — it should look like www.example.com/subscribe" }, { status: 400 })
    }
    if (typeof body.studentApprovalRequired === "boolean") await setStudentApprovalRequired(body.studentApprovalRequired)
    if (url !== undefined) await setSubscriptionUrl(url)

    const [approval, subscription] = await Promise.all([studentApprovalRequired(), subscriptionUrl()])
    return NextResponse.json({ studentApprovalRequired: approval, subscriptionUrl: subscription })
  } catch (err) {
    console.error("[PUT /api/admin/platform-settings]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
