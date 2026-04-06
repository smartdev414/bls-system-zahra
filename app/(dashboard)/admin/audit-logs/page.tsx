"use client"

import { useState } from "react"
import {
  Activity, Search, AlertCircle, CheckCircle2,
  Clock, Shield, Loader2, ChevronDown, RefreshCw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Pagination } from "@/components/ui/pagination"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { format } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

type LogEntry = {
  id: string
  method: string
  path: string
  statusCode: number
  userId: string | null
  userRole: string | null
  userEmail: string | null
  ip: string | null
  userAgent: string | null
  durationMs: number
  errorMessage: string | null
  createdAt: string
}

type LogsData = {
  logs: LogEntry[]
  total: number
  page: number
  totalPages: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET:    "bg-blue-100 text-blue-700 border-blue-200",
  POST:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  PUT:    "bg-amber-100 text-amber-700 border-amber-200",
  PATCH:  "bg-amber-100 text-amber-700 border-amber-200",
  DELETE: "bg-rose-100 text-rose-700 border-rose-200",
}

const ROLE_COLORS: Record<string, string> = {
  STUDENT: "bg-blue-50 text-blue-600 border-blue-200",
  TUTOR:   "bg-violet-50 text-violet-600 border-violet-200",
  ADMIN:   "bg-rose-50 text-rose-600 border-rose-200",
}

function statusBadge(code: number) {
  if (code < 300) return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 tabular-nums">{code}</Badge>
  if (code < 400) return <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 tabular-nums">{code}</Badge>
  if (code < 500) return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 tabular-nums">{code}</Badge>
  return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 tabular-nums">{code}</Badge>
}

// ─── Expanded row ─────────────────────────────────────────────────────────────

function LogRow({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(log.createdAt), "dd MMM HH:mm:ss")}
        </td>
        <td className="px-4 py-3">
          <Badge variant="outline" className={`font-mono text-[11px] ${METHOD_COLORS[log.method] ?? ""}`}>
            {log.method}
          </Badge>
        </td>
        <td className="px-4 py-3 font-mono text-xs max-w-[280px] truncate text-foreground">
          {log.path}
        </td>
        <td className="px-4 py-3">{statusBadge(log.statusCode)}</td>
        <td className="px-4 py-3 text-xs">
          {log.userEmail ? (
            <span className="flex flex-col gap-0.5">
              <span className="font-medium truncate max-w-[160px]">{log.userEmail}</span>
              {log.userRole && (
                <Badge variant="outline" className={`text-[10px] w-fit ${ROLE_COLORS[log.userRole] ?? ""}`}>
                  {log.userRole}
                </Badge>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
          {log.durationMs} ms
        </td>
        <td className="px-4 py-3">
          {log.statusCode >= 500 ? (
            <AlertCircle className="size-4 text-rose-500" />
          ) : log.statusCode >= 400 ? (
            <AlertCircle className="size-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-500" />
          )}
        </td>
        <td className="px-4 py-3">
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </td>
      </tr>

      {expanded && (
        <tr className="bg-muted/20 border-b">
          <td colSpan={8} className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-xs">
              <div>
                <p className="text-muted-foreground font-medium mb-1">User ID</p>
                <p className="font-mono">{log.userId ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground font-medium mb-1">IP Address</p>
                <p className="font-mono">{log.ip ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground font-medium mb-1">Duration</p>
                <p className="font-mono">{log.durationMs} ms</p>
              </div>
              <div>
                <p className="text-muted-foreground font-medium mb-1">Timestamp</p>
                <p className="font-mono">{format(new Date(log.createdAt), "dd MMM yyyy HH:mm:ss 'UTC'")}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground font-medium mb-1">User Agent</p>
                <p className="font-mono text-[11px] break-all">{log.userAgent ?? "—"}</p>
              </div>
              {log.errorMessage && (
                <div className="col-span-3">
                  <p className="text-rose-600 font-medium mb-1">Error</p>
                  <pre className="font-mono text-[11px] whitespace-pre-wrap bg-rose-50 border border-rose-200 rounded p-3 text-rose-800">
                    {log.errorMessage}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const [pathFilter, setPathFilter] = useState("")
  const [methodFilter, setMethodFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)

  const debouncedPath = useDebounce(pathFilter)

  const params = new URLSearchParams()
  if (debouncedPath) params.set("path", debouncedPath)
  if (methodFilter !== "all") params.set("method", methodFilter)
  if (statusFilter !== "all") params.set("status", statusFilter)
  params.set("page", String(page))
  params.set("limit", "50")

  const { data, loading, refetch } = useFetch<LogsData>(
    `/api/admin/audit-logs?${params.toString()}`,
    { errorMessage: "Could not load audit logs" }
  )

  function handleFilterChange(setter: (v: string) => void) {
    return (value: string) => {
      setter(value)
      setPage(1)
    }
  }

  const errorCount = data?.logs.filter((l) => l.statusCode >= 500).length ?? 0

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-2xl bg-primary p-8 text-primary-foreground relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="absolute -right-4 top-16 size-28 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="size-5 text-primary-foreground/70" />
            <p className="text-sm font-medium text-primary-foreground/70">Admin Panel</p>
          </div>
          <h1 className="text-3xl font-black tracking-tight mb-2">API Audit Logs</h1>
          <p className="text-primary-foreground/80">
            Every API request made to the platform, who made it, and what happened.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Filter by path…"
                value={pathFilter}
                onChange={(e) => { setPathFilter(e.target.value); setPage(1) }}
                className="pl-9"
              />
            </div>

            <Select value={methodFilter} onValueChange={handleFilterChange(setMethodFilter)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={handleFilterChange(setStatusFilter)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="2xx">2xx Success</SelectItem>
                <SelectItem value="3xx">3xx Redirect</SelectItem>
                <SelectItem value="4xx">4xx Client error</SelectItem>
                <SelectItem value="5xx">5xx Server error</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary strip */}
      {data && (
        <div className="flex gap-4 text-sm flex-wrap">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="size-4" />
            <span><strong className="text-foreground">{data.total.toLocaleString()}</strong> total requests</span>
          </div>
          {errorCount > 0 && (
            <div className="flex items-center gap-2 text-rose-600">
              <AlertCircle className="size-4" />
              <span><strong>{errorCount}</strong> server errors on this page</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-4" />
            <span>Page {data.page} of {data.totalPages}</span>
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="border-b py-3 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="size-4 text-primary" /> Request Log
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Time</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Method</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Path</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">User</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Duration</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground"></th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-muted rounded animate-pulse w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data?.logs.length ? (
                data.logs.map((log) => <LogRow key={log.id} log={log} />)
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No logs found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />
      )}
    </div>
  )
}
