"use client"

/**
 * Student resources: the extra practice material students find in folders on
 * their Resources page — YouTube videos, exam samples, slides to read,
 * worksheets, useful websites. Each item is an uploaded file or a pasted link,
 * and can be kept to one level.
 */

import { useState } from "react"
import {
  FolderOpen, Plus, Loader2, Pencil, Trash2, PlayCircle, GraduationCap, Presentation,
  PencilLine, Link2, FileText, ExternalLink, Upload,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload"
import { useFetch } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"
import { mediaSrc } from "@/lib/protected-media"
import { COURSE_LEVELS, levelColor, levelLabel, type CourseLevel } from "@/lib/levels"
import {
  FOLDER_INFO, STUDENT_RESOURCE_FOLDERS, youtubeThumbnail,
  type StudentResourceFolder, type StudentResourceItem,
} from "@/lib/student-resources"

const FOLDER_LOOK: Record<StudentResourceFolder, { icon: LucideIcon; gradient: string; soft: string }> = {
  VIDEO_LESSONS: { icon: PlayCircle,    gradient: "from-rose-500 to-red-600",       soft: "bg-rose-100 text-rose-700" },
  EXAM_SAMPLES:  { icon: GraduationCap, gradient: "from-amber-400 to-orange-500",   soft: "bg-amber-100 text-amber-800" },
  SLIDES:        { icon: Presentation,  gradient: "from-sky-500 to-blue-600",       soft: "bg-sky-100 text-sky-700" },
  PRACTICE:      { icon: PencilLine,    gradient: "from-emerald-500 to-teal-600",   soft: "bg-emerald-100 text-emerald-700" },
  LINKS:         { icon: Link2,         gradient: "from-fuchsia-500 to-purple-600", soft: "bg-fuchsia-100 text-fuchsia-700" },
}

const ACCEPT =
  "video/mp4,video/webm,video/quicktime,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  ".ppt,.pptx,image/*,audio/mpeg,audio/wav"

type Draft = {
  id: string | null
  folder: StudentResourceFolder
  title: string
  description: string
  level: CourseLevel | "ALL"
  source: "file" | "link"
  link: string
  file: UploadedFile | null
  /** What is saved now, when editing — kept unless replaced. */
  existing: StudentResourceItem | null
}

function newDraft(folder: StudentResourceFolder): Draft {
  return {
    id: null, folder, title: "", description: "", level: "ALL",
    source: folder === "VIDEO_LESSONS" || folder === "LINKS" ? "link" : "file",
    link: "", file: null, existing: null,
  }
}

function editDraft(item: StudentResourceItem): Draft {
  return {
    id: item.id, folder: item.folder, title: item.title, description: item.description ?? "",
    level: item.level ?? "ALL", source: item.isLink ? "link" : "file",
    link: item.isLink ? item.url : "", file: null, existing: item,
  }
}

export default function AdminStudentResourcesPage() {
  const [filter, setFilter] = useState<StudentResourceFolder | "ALL">("ALL")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const { data, loading, refetch } = useFetch<{ items: StudentResourceItem[] }>("/api/admin/student-resources", {
    errorMessage: "Could not load student resources",
  })
  const items = data?.items ?? []
  const shown = filter === "ALL" ? items : items.filter((i) => i.folder === filter)
  const count = (f: StudentResourceFolder) => items.filter((i) => i.folder === f).length

  async function save() {
    if (!draft) return
    const body: Record<string, unknown> = {
      folder: draft.folder,
      title: draft.title,
      description: draft.description,
      level: draft.level === "ALL" ? null : draft.level,
    }
    if (draft.source === "link") {
      if (draft.link.trim() && draft.link.trim() !== draft.existing?.url) body.link = draft.link
      else if (!draft.existing?.isLink) return toast.error("Paste a link")
    } else {
      if (draft.file) body.file = draft.file
      else if (!draft.existing || draft.existing.isLink) return toast.error("Upload a file")
    }
    setSaving(true)
    try {
      const res = await fetch(draft.id ? `/api/admin/student-resources/${draft.id}` : "/api/admin/student-resources", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(json.message ?? "Could not save")
      toast.success(draft.id ? "Saved" : "Added — students can see it now")
      setDraft(null)
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  async function remove(item: StudentResourceItem) {
    if (!window.confirm(`Remove “${item.title}” from students' resources?`)) return
    const res = await fetch(`/api/admin/student-resources/${item.id}`, { method: "DELETE" })
    if (res.ok) { toast.success("Removed"); refetch() } else toast.error("Could not remove it")
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <FolderOpen className="size-6 text-primary" /> Student resources
          </h1>
          <p className="text-muted-foreground mt-1">
            Videos, exam samples and files for students to practise with outside class. They appear in folders on every student&apos;s Resources page.
          </p>
        </div>
        <Button onClick={() => setDraft(newDraft(filter === "ALL" ? "VIDEO_LESSONS" : filter))}>
          <Plus className="size-4 mr-1" /> Add resource
        </Button>
      </div>

      {/* Folder chips: what is in each, and a filter. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STUDENT_RESOURCE_FOLDERS.map((f) => {
          const look = FOLDER_LOOK[f]
          const Icon = look.icon
          const active = filter === f
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(active ? "ALL" : f)}
              className={cn(
                "relative overflow-hidden rounded-xl p-4 text-left text-white bg-gradient-to-br shadow-sm transition-all",
                "hover:-translate-y-0.5 hover:shadow-md",
                look.gradient,
                active ? "ring-4 ring-offset-2 ring-primary/50" : filter !== "ALL" && "opacity-60",
              )}
            >
              <Icon aria-hidden className="absolute -right-3 -bottom-3 size-16 opacity-15" />
              <Icon className="size-5" />
              <p className="mt-2 font-bold leading-tight">{FOLDER_INFO[f].label}</p>
              <p className="text-xs text-white/85">{count(f)} item{count(f) !== 1 ? "s" : ""}</p>
            </button>
          )
        })}
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="size-8 animate-spin text-primary" /></div>
      ) : shown.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
            <FolderOpen className="size-10 text-muted-foreground" />
            <p className="font-semibold">Nothing here yet</p>
            <p className="text-sm text-muted-foreground">Add a YouTube video, an exam paper or some slides for students to practise with.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((item) => {
            const look = FOLDER_LOOK[item.folder]
            const Icon = item.isLink ? (youtubeThumbnail(item.url) || item.mimeType?.startsWith("video/") ? PlayCircle : Link2) : FileText
            const thumb = youtubeThumbnail(item.url)
            return (
              <Card key={item.id} className="shadow-sm">
                <CardContent className="p-4 flex items-center gap-4">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- YouTube's own still
                    <img src={thumb} alt="" className="w-24 aspect-video rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className={cn("rounded-xl p-3 shrink-0", look.soft)}><Icon className="size-6" /></div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className={cn("text-[0.625rem] border-transparent", look.soft)}>{FOLDER_INFO[item.folder].label}</Badge>
                      <Badge variant="outline" className={cn("text-[0.625rem]", item.level && levelColor[item.level])}>
                        {item.level ? levelLabel[item.level] : "All levels"}
                      </Badge>
                    </div>
                    <p className="font-semibold text-sm leading-snug truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.description || item.fileName || item.url}</p>
                  </div>
                  <div className="flex shrink-0">
                    <Button asChild size="icon" variant="ghost" className="size-8" title="Open">
                      <a href={item.isLink ? item.url : mediaSrc(item.url)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-4" />
                      </a>
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" title="Edit" onClick={() => setDraft(editDraft(item))}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8 text-destructive" title="Remove" onClick={() => remove(item)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o && !saving) setDraft(null) }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit resource" : "Add a resource"}</DialogTitle>
            <DialogDescription>Students see it straight away in the folder you choose.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Folder</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {STUDENT_RESOURCE_FOLDERS.map((f) => {
                    const look = FOLDER_LOOK[f]
                    const Icon = look.icon
                    const on = draft.folder === f
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setDraft({ ...draft, folder: f })}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors text-left",
                          on ? "border-primary bg-primary/5" : "border-transparent bg-muted/60 hover:bg-muted",
                        )}
                      >
                        <span className={cn("rounded-md p-1", look.soft)}><Icon className="size-4" /></span>
                        {FOLDER_INFO[f].label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="sr-title">Title</Label>
                <Input id="sr-title" value={draft.title} maxLength={200}
                  placeholder="e.g. Level 2 receptive exam — sample 1"
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="sr-desc">Note for students <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea id="sr-desc" rows={2} value={draft.description} maxLength={1000}
                  placeholder="What to do with it"
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Who sees it</Label>
                <Select value={draft.level} onValueChange={(v) => setDraft({ ...draft, level: v as Draft["level"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Every student</SelectItem>
                    {COURSE_LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>Students on {levelLabel[l]} courses</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <div className="inline-flex self-start rounded-lg bg-muted p-1 text-sm">
                  {(["link", "file"] as const).map((s) => (
                    <button key={s} type="button"
                      onClick={() => setDraft({ ...draft, source: s })}
                      className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium",
                        draft.source === s ? "bg-background shadow-sm" : "text-muted-foreground")}>
                      {s === "link" ? <><Link2 className="size-4" /> Paste a link</> : <><Upload className="size-4" /> Upload a file</>}
                    </button>
                  ))}
                </div>
                {draft.source === "link" ? (
                  <div className="flex flex-col gap-1.5">
                    <Input value={draft.link} placeholder="https://www.youtube.com/watch?v=…"
                      onChange={(e) => setDraft({ ...draft, link: e.target.value })} />
                    <p className="text-xs text-muted-foreground">
                      YouTube and Vimeo videos play right on the page. Any other website opens in a new tab.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <FileUpload
                      accept={ACCEPT}
                      label="Upload a PDF, slides, document, image, audio or video"
                      uploaded={draft.file}
                      onUploaded={(file) => setDraft((d) => d && ({ ...d, file, title: d.title || file.fileName.replace(/\.[^.]+$/, "") }))}
                      onRemove={() => setDraft({ ...draft, file: null })}
                    />
                    {draft.existing && !draft.existing.isLink && !draft.file && (
                      <p className="text-xs text-muted-foreground">Keeping {draft.existing.fileName ?? "the current file"} unless you upload another.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !draft?.title.trim()}>
              {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
              {draft?.id ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
