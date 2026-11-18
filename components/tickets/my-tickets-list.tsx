"use client"

import Link from "next/link"
import { useState } from "react"
import {
  Ticket, Search, Bug, Sparkles, Lightbulb, HelpCircle,
  Clock, CheckCircle2, AlertCircle, ChevronRight, MessageSquare,
  Paperclip, RefreshCw, Plus,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Pagination } from "@/components/ui/pagination"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { format } from "date-fns"

export type TicketItem = {
  id: string
  title: string
  type: "BUG" | "FEATURE" | "SUGGESTION" | "OTHER"
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"
  createdAt: string
  updatedAt: string
  _count: { comments: number; attachments: number }
}

type TicketsData = {
  tickets: TicketItem[]
  total: number
  page: number
  totalPages: number
}

export const TYPE_CONFIG = {
  BUG:        { label: "Bug",        icon: Bug,          color: "bg-rose-50 text-rose-700 border-rose-200" },
  FEATURE:    { label: "Feature",    icon: Sparkles,     color: "bg-violet-50 text-violet-700 border-violet-200" },
  SUGGESTION: { label: "Suggestion", icon: Lightbulb,    color: "bg-amber-50 text-amber-700 border-amber-200" },
  OTHER:      { label: "Other",      icon: HelpCircle,   color: "bg-blue-50 text-blue-700 border-blue-200" },
}

export const STATUS_CONFIG = {
  OPEN:        { label: "Open",        icon: AlertCircle,  color: "bg-rose-50 text-rose-700 border-rose-200" },
  IN_PROGRESS: { label: "In Progress", icon: Clock,        color: "bg-amber-50 text-amber-700 border-amber-200" },
  RESOLVED:    { label: "Resolved",    icon: CheckCircle2, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CLOSED:      { label: "Closed",      icon: CheckCircle2, color: "bg-muted text-muted-foreground border-muted" },
}

function TicketRow({ ticket, basePath }: { ticket: TicketItem; basePath: string }) {
  const type = TYPE_CONFIG[ticket.type]
  const status = STATUS_CONFIG[ticket.status]
  const TypeIcon = type.icon
  const StatusIcon = status.icon
  const hasUpdate = ticket.status === "RESOLVED" || ticket.status === "IN_PROGRESS"

  return (
    <Link
      href={`${basePath}/${ticket.id}`}
      className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors border-b last:border-b-0 group"
    >
      {/* Type icon */}
      <div className={`rounded-lg border p-2 shrink-0 ${type.color}`}>
        <TypeIcon className="size-3.5" />
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
            {ticket.title}
          </p>
          {hasUpdate && (
            <span className="size-1.5 rounded-full bg-primary shrink-0" title="Updated" />
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
          <span>{format(new Date(ticket.createdAt), "dd MMM yyyy")}</span>
          {ticket._count.comments > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3" />
              {ticket._count.comments}
            </span>
          )}
          {ticket._count.attachments > 0 && (
            <span className="flex items-center gap-1">
              <Paperclip className="size-3" />
              {ticket._count.attachments}
            </span>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <Badge variant="outline" className={`text-[0.625rem] gap-1 ${status.color}`}>
          <StatusIcon className="size-2.5" />
          {status.label}
        </Badge>
      </div>

      <ChevronRight className="size-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
    </Link>
  )
}

type Props = {
  /** e.g. "/student/tickets" or "/tutor/tickets" */
  basePath: string
}

export function MyTicketsList({ basePath }: Props) {
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)

  const debouncedQ = useDebounce(q)

  const params = new URLSearchParams()
  if (debouncedQ) params.set("q", debouncedQ)
  if (status !== "all") params.set("status", status)
  params.set("page", String(page))

  const { data, loading, refetch } = useFetch<TicketsData>(
    `/api/tickets?${params.toString()}`,
    { errorMessage: "Could not load tickets" },
  )

  const openCount = data?.tickets.filter((t) => t.status === "OPEN").length ?? 0
  const resolvedCount = data?.tickets.filter((t) => t.status === "RESOLVED").length ?? 0

  return (
    <div className="flex flex-col gap-6">
      {/* Header banner */}
      <div className="hero-banner rounded-2xl bg-primary p-8 text-primary-foreground relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="absolute -right-4 top-16 size-28 rounded-full bg-white/5" />
        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Ticket className="size-5 text-primary-foreground/70" />
              <p className="text-sm font-medium text-primary-foreground/70">Support</p>
            </div>
            <h1 className="text-3xl font-black tracking-tight mb-1">My Tickets</h1>
            <p className="text-primary-foreground/80 text-sm">
              Track your bug reports, feature requests, and suggestions.
            </p>
          </div>
          {/* Stats */}
          {data && (
            <div className="flex gap-3 shrink-0">
              <div className="rounded-xl bg-white/10 px-4 py-2.5 text-center min-w-16">
                <p className="text-2xl font-black">{data.total}</p>
                <p className="text-[0.6875rem] text-primary-foreground/70 mt-0.5">Total</p>
              </div>
              {openCount > 0 && (
                <div className="rounded-xl bg-white/10 px-4 py-2.5 text-center min-w-16">
                  <p className="text-2xl font-black">{openCount}</p>
                  <p className="text-[0.6875rem] text-primary-foreground/70 mt-0.5">Open</p>
                </div>
              )}
              {resolvedCount > 0 && (
                <div className="rounded-xl bg-white/10 px-4 py-2.5 text-center min-w-16">
                  <p className="text-2xl font-black">{resolvedCount}</p>
                  <p className="text-[0.6875rem] text-primary-foreground/70 mt-0.5">Resolved</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search your tickets…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>

        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-35">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* List */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="border-b py-3 px-5 flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Ticket className="size-4 text-primary" />
            {data ? `${data.total} ticket${data.total !== 1 ? "s" : ""}` : "Tickets"}
          </CardTitle>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Plus className="size-3" />
            Use the <span className="font-semibold text-primary">Feedback</span> button to submit a new ticket
          </p>
        </CardHeader>

        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="size-8 rounded-lg bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-muted rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : data?.tickets.length ? (
          <div>
            {data.tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} basePath={basePath} />
            ))}
          </div>
        ) : (
          <div className="py-16 flex flex-col items-center gap-3 text-center px-6">
            <div className="size-14 rounded-full bg-muted flex items-center justify-center">
              <Ticket className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold">No tickets yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                {status !== "all"
                  ? "No tickets match this filter."
                  : 'Use the "Feedback" button at the bottom of the screen to submit a bug report, feature request, or suggestion.'}
              </p>
            </div>
          </div>
        )}
      </Card>

      {data && data.totalPages > 1 && (
        <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />
      )}
    </div>
  )
}
