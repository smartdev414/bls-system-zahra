import { getSession } from "@/lib/auth"
import { MyTicketDetail } from "@/components/tickets/my-ticket-detail"

export default async function TutorTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  return (
    <MyTicketDetail
      params={params}
      basePath="/tutor/tickets"
      userId={session?.sub}
    />
  )
}
