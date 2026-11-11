"use client"

import { useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { CheckCircle2, GraduationCap, Loader2, LogIn, RefreshCw, Search, ShieldAlert, Users, XCircle } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Pagination } from "@/components/ui/pagination"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { FAILURE_LABEL, LOGIN_METHOD_LABEL, agoLabel, deviceOf } from "@/lib/engagement"

type LoginRow = {
  id: string
  createdAt: string
  email: string
  success: boolean
  method: string
  failureReason: string | null
  client: string
  ip: string | null
  userAgent: string | null
  user: { id: string; name: string; role: string } | null
}

type Data = {
  events: LoginRow[]
  total: number
  page: number
  totalPages: number
  stats: { loginsToday: number; failedToday: number; peopleSignedInWeek: number; studentsActiveWeek: number; studentsTotal: number }
}

const ROLE_COLORS: Record<string, string> = {
  STUDENT: "bg-blue-50 text-blue-600 border-blue-200",
  TUTOR: "bg-violet-50 text-violet-600 border-violet-200",
  SUPPORT: "bg-teal-50 text-teal-600 border-teal-200",
  ADMIN: "bg-rose-50 text-rose-600 border-rose-200",
}

function Tile({ icon: Icon, label, value, tone }: { icon: typeof LogIn; label: string; value: string | number; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className={`rounded-lg p-2 shrink-0 ${tone}`}><Icon className="size-4" /></div>
      <div className="min-w-0">
        <p className="text-xl font-black leading-none tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  )
}

export default function LoginActivityPage() {
  const [query, setQuery] = useState("")
  const [result, setResult] = useState("all")
  const [role, setRole] = useState("all")
  const [page, setPage] = useState(1)
  const q = useDebounce(query)

  const params = new URLSearchParams({ page: String(page) })
  if (q) params.set("q", q)
  if (result !== "all") params.set("result", result)
  if (role !== "all") params.set("role", role)

  const { data, loading, refetch } = useFetch<Data>(`/api/admin/login-activity?${params}`, {
    errorMessage: "Could not load sign-ins",
  })
  const s = data?.stats

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <LogIn className="size-6 text-primary" /> Login activity
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Every sign-in to the website and the phone app, including failed attempts.</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void refetch()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Tile icon={LogIn} label="Sign-ins in the last 24 hours" value={s.loginsToday} tone="bg-sky-50 text-sky-600" />
          <Tile icon={ShieldAlert} label="Failed sign-ins in the last 24 hours" value={s.failedToday} tone={s.failedToday > 0 ? "bg-red-50 text-red-600" : "bg-muted text-muted-foreground"} />
          <Tile icon={Users} label="People who signed in this week" value={s.peopleSignedInWeek} tone="bg-violet-50 text-violet-600" />
          <Tile icon={GraduationCap} label="Students on the platform this week" value={`${s.studentsActiveWeek} / ${s.studentsTotal}`} tone="bg-emerald-50 text-emerald-600" />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Name or email…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            className="pl-8 h-8 w-56 text-sm"
          />
        </div>
        <Select value={result} onValueChange={(v) => { setResult(v); setPage(1) }}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All attempts</SelectItem>
            <SelectItem value="success">Successful</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={(v) => { setRole(v); setPage(1) }}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="STUDENT">Students</SelectItem>
            <SelectItem value="TUTOR">Tutors</SelectItem>
            <SelectItem value="SUPPORT">Support</SelectItem>
            <SelectItem value="ADMIN">Admins</SelectItem>
          </SelectContent>
        </Select>
        {data && <span className="text-xs text-muted-foreground ml-auto">{data.total} attempt{data.total === 1 ? "" : "s"}</span>}
      </div>

      <Card className="shadow-sm overflow-hidden py-0 gap-0">
        {loading && !data ? (
          <div className="flex justify-center py-16"><Loader2 className="size-7 animate-spin text-primary" /></div>
        ) : !data?.events.length ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No sign-ins match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left">
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Who</th>
                  <th className="px-4 py-2">Result</th>
                  <th className="px-4 py-2">Device</th>
                  <th className="px-4 py-2">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.events.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <p className="text-xs font-medium">{format(new Date(e.createdAt), "dd MMM yyyy HH:mm")}</p>
                      <p className="text-[11px] text-muted-foreground">{agoLabel(e.createdAt)}</p>
                    </td>
                    <td className="px-4 py-2.5 min-w-48">
                      {e.user ? (
                        <div className="flex flex-col gap-0.5">
                          {e.user.role === "STUDENT" ? (
                            <Link href={`/admin/students/${e.user.id}`} className="text-xs font-medium hover:underline">{e.user.name}</Link>
                          ) : (
                            <span className="text-xs font-medium">{e.user.name}</span>
                          )}
                          <span className="text-[11px] text-muted-foreground">{e.email}</span>
                          <Badge variant="outline" className={`text-[10px] w-fit ${ROLE_COLORS[e.user.role] ?? ""}`}>{e.user.role}</Badge>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium">{e.email || "—"}</span>
                          <span className="text-[11px] text-muted-foreground">No account</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {e.success ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                          <CheckCircle2 className="size-3.5" /> {LOGIN_METHOD_LABEL[e.method] ?? e.method}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-red-600">
                          <XCircle className="size-3.5" /> {FAILURE_LABEL[e.failureReason ?? ""] ?? "Failed"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap" title={e.userAgent ?? undefined}>
                      {deviceOf(e.userAgent, e.client)}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.totalPages > 1 && (
        <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} className="mt-2" />
      )}
    </div>
  )
}
