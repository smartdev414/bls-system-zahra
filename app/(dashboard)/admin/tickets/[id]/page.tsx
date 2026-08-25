"use client"

import { TicketDetail } from "@/components/tickets/ticket-detail-page"

export default function AdminTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <TicketDetail params={params} basePath="/admin" />
}
