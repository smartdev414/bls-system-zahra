import { getSession } from "@/lib/auth"
import { MyTicketDetail } from "@/components/tickets/my-ticket-detail"

export default async function StudentTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  return (
    <MyTicketDetail
      params={params}
      basePath="/student/tickets"
      userId={session?.sub}
    />
  )
}
