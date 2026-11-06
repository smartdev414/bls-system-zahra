"use client"

import { useRememberedState } from "@/hooks/use-remembered-state"
import {
  FolderOpen, Search, Download, FileText, Image, Music,
  Loader2, BookOpen, Filter, CalendarDays,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"

// ─── Types ────────────────────────────────────────────────────────────────────

type Resource = {
  id: string
  type: "PDF" | "DOCUMENT" | "IMAGE" | "AUDIO"
  title: string
  description: string | null
  fileUrl: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  courseId: string
  courseTitle: string
  lessonId: string
  lessonTitle: string
}

type ResourcesData = { resources: Resource[]; total: number }

type Handout = {
  id: string
  title: string
  fileUrl: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  session: { id: string; title: string; scheduledAt: string; course: { title: string } | null; tutor: { name: string } }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const typeConfig = {
  PDF:      { label: "PDF",      icon: FileText, className: "bg-rose-50 text-rose-700 border-rose-200" },
  DOCUMENT: { label: "Document", icon: FileText, className: "bg-blue-50 text-blue-700 border-blue-200" },
  IMAGE:    { label: "Image",    icon: Image,    className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  AUDIO:    { label: "Audio",    icon: Music,    className: "bg-violet-50 text-violet-700 border-violet-200" },
}

/** A handout's file, sorted into the same types as the filter. */
function handoutType(mimeType: string | null): Resource["type"] {
  if (mimeType === "application/pdf") return "PDF"
  if (mimeType?.startsWith("image/")) return "IMAGE"
  if (mimeType?.startsWith("audio/")) return "AUDIO"
  return "DOCUMENT"
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const [query, setQuery] = useRememberedState("query", "")
  const [typeFilter, setTypeFilter] = useRememberedState("typeFilter", "all")

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)
  if (typeFilter !== "all") params.set("type", typeFilter)

  const { data, loading } = useFetch<ResourcesData>(`/api/student/resources?${params.toString()}`, {
    errorMessage: "Could not load resources",
  })

  // Handouts from the student's classes, once each has opened.
  const { data: handoutData, loading: handoutsLoading } = useFetch<{ handouts: Handout[] }>("/api/student/handouts", {
    errorMessage: false,
  })
  const q = debouncedQuery.toLowerCase()
  const handouts = (handoutData?.handouts ?? []).filter((h) =>
    (typeFilter === "all" || typeFilter === handoutType(h.mimeType)) &&
    (!q || h.title.toLowerCase().includes(q) || h.session.title.toLowerCase().includes(q))
  )

  // Group by course
  const grouped = (data?.resources ?? []).reduce<Record<string, { courseTitle: string; resources: Resource[] }>>(
    (acc, r) => {
      if (!acc[r.courseId]) acc[r.courseId] = { courseTitle: r.courseTitle, resources: [] }
      acc[r.courseId].resources.push(r)
      return acc
    },
    {}
  )

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <FolderOpen className="size-6 text-primary" /> Resources
        </h1>
        <p className="text-muted-foreground mt-1">
          {loading ? "\u00A0" : (() => {
            const n = (data?.total ?? 0) + handouts.length
            return `${n} file${n !== 1 ? "s" : ""} from your courses and classes`
          })()}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by title, course or lesson…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <Filter className="size-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="PDF">PDF</SelectItem>
            <SelectItem value="DOCUMENT">Document</SelectItem>
            <SelectItem value="IMAGE">Image</SelectItem>
            <SelectItem value="AUDIO">Audio</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {handouts.length > 0 && (
        <section id="class-handouts">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <CalendarDays className="size-3.5" /> Class handouts
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {handouts.map((h) => (
              <a key={h.id} href={h.fileUrl} target="_blank" rel="noopener noreferrer" className="group">
                <Card className="shadow-sm hover:shadow-md hover:border-primary transition-all cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="rounded-xl bg-primary/10 p-3 shrink-0 group-hover:bg-primary/20 transition-colors">
                      <FileText className="size-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-snug truncate">{h.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {h.session.title} · {new Date(h.session.scheduledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {h.fileSize ? ` · ${formatBytes(h.fileSize)}` : ""}
                      </p>
                    </div>
                    <Button size="icon" variant="ghost" className="size-8 shrink-0 text-muted-foreground group-hover:text-primary" tabIndex={-1}>
                      <Download className="size-4" />
                    </Button>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </section>
      )}

      {loading || handoutsLoading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : Object.keys(grouped).length > 0 || handouts.length > 0 ? (
        <div className="flex flex-col gap-8">
          {Object.entries(grouped).map(([courseId, group]) => (
            <section key={courseId}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                <BookOpen className="size-3.5" /> {group.courseTitle}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.resources.map((resource) => {
                  const cfg = typeConfig[resource.type]
                  const Icon = cfg.icon
                  return (
                    <a
                      key={resource.id}
                      href={resource.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group"
                    >
                      <Card className="shadow-sm hover:shadow-md hover:border-primary transition-all cursor-pointer">
                        <CardContent className="p-4 flex items-center gap-4">
                          <div className="rounded-xl bg-primary/10 p-3 shrink-0 group-hover:bg-primary/20 transition-colors">
                            <Icon className="size-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Badge variant="outline" className={`text-[10px] ${cfg.className}`}>
                                {cfg.label}
                              </Badge>
                            </div>
                            <p className="text-sm font-semibold leading-snug truncate">{resource.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {resource.lessonTitle}
                              {resource.fileSize ? ` · ${formatBytes(resource.fileSize)}` : ""}
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 shrink-0 text-muted-foreground group-hover:text-primary"
                            tabIndex={-1}
                          >
                            <Download className="size-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    </a>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-muted p-6">
              <FolderOpen className="size-10 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-lg">No resources found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {query || typeFilter !== "all"
                  ? "Try adjusting your filters."
                  : "Supplementary materials from your enrolled courses will appear here."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
