"use client"

import Link from "next/link"
import { useState } from "react"
import {
  Ticket, Search, Bug, Sparkles, Lightbulb, HelpCircle,
  Clock, CheckCircle2, AlertCircle, RefreshCw, ChevronRight,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Pagination } from "@/components/ui/pagination"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { format } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketItem = {
  id: string
  title: string
  type: "BUG" | "FEATURE" | "SUGGESTION" | "OTHER"
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"
  createdAt: string
  submitter: { id: string; name: string; email: string; role: string }
  assignedTo: { id: string; name: string } | null
  _count: { comments: number; attachments: number }
}

type TicketsData = {
  tickets: TicketItem[]
  total: number
  page: number
  totalPages: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  BUG:        { label: "Bug",        icon: Bug,          color: "bg-rose-50 text-rose-700 border-rose-200" },
  FEATURE:    { label: "Feature",    icon: Sparkles,     color: "bg-violet-50 text-violet-700 border-violet-200" },
  SUGGESTION: { label: "Suggestion", icon: Lightbulb,    color: "bg-amber-50 text-amber-700 border-amber-200" },
  OTHER:      { label: "Other",      icon: HelpCircle,   color: "bg-blue-50 text-blue-700 border-blue-200" },
}

const STATUS_CONFIG = {
  OPEN:        { label: "Open",        icon: AlertCircle,   color: "bg-rose-50 text-rose-700 border-rose-200" },
  IN_PROGRESS: { label: "In Progress", icon: Clock,         color: "bg-amber-50 text-amber-700 border-amber-200" },
  RESOLVED:    { label: "Resolved",    icon: CheckCircle2,  color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CLOSED:      { label: "Closed",      icon: CheckCircle2,  color: "bg-muted text-muted-foreground border-muted" },
}

const PRIORITY_CONFIG = {
  LOW:    { label: "Low",    color: "bg-muted text-muted-foreground border-muted" },
  MEDIUM: { label: "Medium", color: "bg-blue-50 text-blue-700 border-blue-200" },
  HIGH:   { label: "High",   color: "bg-amber-50 text-amber-700 border-amber-200" },
  URGENT: { label: "Urgent", color: "bg-rose-50 text-rose-700 border-rose-200" },
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function TicketRow({ ticket, basePath }: { ticket: TicketItem; basePath: string }) {
  const type = TYPE_CONFIG[ticket.type]
  const status = STATUS_CONFIG[ticket.status]
  const priority = PRIORITY_CONFIG[ticket.priority]
  const TypeIcon = type.icon
  const StatusIcon = status.icon
  const initials = ticket.submitter.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

  return (
    <Link
      href={`${basePath}/tickets/${ticket.id}`}
      className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors border-b last:border-b-0 group"
    >
      {/* Type icon */}
      <div className={`rounded-lg border p-2 shrink-0 ${type.color}`}>
        <TypeIcon className="size-3.5" />
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
          {ticket.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
          <span>{format(new Date(ticket.createdAt), "dd MMM yyyy")}</span>
          {ticket._count.comments > 0 && <span>{ticket._count.comments} comment{ticket._count.comments !== 1 ? "s" : ""}</span>}
          {ticket._count.attachments > 0 && <span>{ticket._count.attachments} file{ticket._count.attachments !== 1 ? "s" : ""}</span>}
        </div>
      </div>

      {/* Submitter */}
      <div className="hidden md:flex items-center gap-2 shrink-0 w-40">
        <Avatar className="size-6 shrink-0">
          <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{ticket.submitter.name}</p>
          <p className="text-[10px] text-muted-foreground truncate capitalize">{ticket.submitter.role.toLowerCase()}</p>
        </div>
      </div>

      {/* Badges */}
      <div className="hidden lg:flex items-center gap-2 shrink-0">
        <Badge variant="outline" className={`text-[10px] ${priority.color}`}>{priority.label}</Badge>
        <Badge variant="outline" className={`text-[10px] gap-1 ${status.color}`}>
          <StatusIcon className="size-2.5" />
          {status.label}
        </Badge>
      </div>

      <ChevronRight className="size-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
    </Link>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * The support desk ticket queue. Rendered under both /admin and /support —
 * `basePath` keeps the detail links inside whichever dashboard the staff
 * member is signed into.
 */
export function TicketsDesk({ basePath = "/admin" }: { basePath?: string } = {}) {
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [type, setType] = useState("all")
  const [priority, setPriority] = useState("all")
  const [page, setPage] = useState(1)

  const debouncedQ = useDebounce(q)

  const params = new URLSearchParams()
  if (debouncedQ) params.set("q", debouncedQ)
  if (status !== "all") params.set("status", status)
  if (type !== "all") params.set("type", type)
  if (priority !== "all") params.set("priority", priority)
  params.set("page", String(page))

  const { data, loading, refetch } = useFetch<TicketsData>(
    `/api/tickets?${params.toString()}`,
    { errorMessage: "Could not load tickets" },
  )

  function resetFilters(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(1) }
  }

  const openCount = data?.tickets.filter((t) => t.status === "OPEN").length ?? 0

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-2xl bg-primary p-8 text-primary-foreground relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="absolute -right-4 top-16 size-28 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <Ticket className="size-5 text-primary-foreground/70" />
            <p className="text-sm font-medium text-primary-foreground/70">Admin Panel</p>
          </div>
          <h1 className="text-3xl font-black tracking-tight mb-2">Feedback & Tickets</h1>
          <p className="text-primary-foreground/80">
            Review bug reports, feature requests, and suggestions from users.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-50">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search tickets…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1) }}
                className="pl-9"
              />
            </div>

            <Select value={type} onValueChange={resetFilters(setType)}>
              <SelectTrigger className="w-35">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="BUG">Bug</SelectItem>
                <SelectItem value="FEATURE">Feature</SelectItem>
                <SelectItem value="SUGGESTION">Suggestion</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={resetFilters(setStatus)}>
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

            <Select value={priority} onValueChange={resetFilters(setPriority)}>
              <SelectTrigger className="w-32.5">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {data && (
        <div className="flex gap-4 text-sm flex-wrap">
          <span className="text-muted-foreground">
            <strong className="text-foreground">{data.total}</strong> ticket{data.total !== 1 ? "s" : ""}
          </span>
          {openCount > 0 && (
            <span className="text-rose-600 flex items-center gap-1">
              <AlertCircle className="size-3.5" />
              <strong>{openCount}</strong> open on this page
            </span>
          )}
        </div>
      )}

      {/* List */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="border-b py-3 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Ticket className="size-4 text-primary" /> Ticket List
          </CardTitle>
        </CardHeader>

        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="size-8 rounded-lg bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-muted rounded animate-pulse w-2/3" />
                  <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : data?.tickets.length ? (
          <div>
            {data.tickets.map((t) => <TicketRow key={t.id} ticket={t} basePath={basePath} />)}
          </div>
        ) : (
          <div className="py-16 text-center text-muted-foreground text-sm">
            No tickets found for the selected filters.
          </div>
        )}
      </Card>

      {data && data.totalPages > 1 && (
        <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />
      )}
    </div>
  )
}
