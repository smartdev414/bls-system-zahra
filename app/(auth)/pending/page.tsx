import { redirect } from "next/navigation"
import { getAccountSession, dashboardPath } from "@/lib/auth"
import { StudentPendingApproval } from "@/components/student-pending-approval"

export const metadata = { title: "Waiting for approval" }

/** Where a student who signed up on their own waits for staff to approve them. */
export default async function PendingApprovalPage() {
  const found = await getAccountSession()
  if (!found) redirect("/login")
  if (found.state === "ok") redirect(dashboardPath(found.session.role))

  return <StudentPendingApproval userName={found.session.name} rejected={found.state === "rejected"} />
}
