import { redirect } from "next/navigation"
import { getAccountSession, dashboardPath } from "@/lib/auth"
import { StudentPendingApproval } from "@/components/student-pending-approval"
import { subscriptionUrl } from "@/lib/subscription-link"

export const metadata = { title: "Your account" }

/**
 * Where a student who signed up on their own waits for staff to approve them —
 * and where a student whose courses have all finished is kept (lib/course-closing.ts).
 */
export default async function PendingApprovalPage() {
  const found = await getAccountSession()
  if (!found) redirect("/login")
  if (found.state === "ok") redirect(dashboardPath(found.session.role))

  return (
    <StudentPendingApproval
      userName={found.session.name}
      state={found.state}
      // A finished student is sent on to the school's subscription options.
      subscriptionUrl={found.state === "finished" ? await subscriptionUrl() : null}
    />
  )
}
