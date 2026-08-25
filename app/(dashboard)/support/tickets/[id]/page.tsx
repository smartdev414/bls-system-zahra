"use client"

import { TicketDetail } from "@/components/tickets/ticket-detail-page"

export default function SupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <TicketDetail params={params} basePath="/support" />
}
