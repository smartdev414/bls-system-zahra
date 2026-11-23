"use client"

/**
 * Resources: everything a student can practise with outside class, in folders.
 *
 * The school's own folders (videos, exam samples, slides, practice, links) are
 * filled by admins on /admin/student-resources. Two more fill themselves: the
 * files attached to lessons on the student's courses, and handouts from their
 * classes. "All files" holds the lot.
 */

import { useState } from "react"
import { useRememberedState } from "@/hooks/use-remembered-state"
import {
  FolderOpen, Search, FileText, Image as ImageIcon, Music, Loader2, BookOpen, CalendarDays,
  PlayCircle, Video, GraduationCap, Presentation, PencilLine, Link2, Files, ArrowLeft,
  ExternalLink, Download, Play, X, Eye, Paperclip,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { EmbeddedVideo } from "@/components/ui/embedded-video"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"
import { mediaSrc } from "@/lib/protected-media"
import { parseVideoLink } from "@/lib/video-link"
import { levelColor, levelLabel } from "@/lib/levels"
import {
  FOLDER_INFO, STUDENT_RESOURCE_FOLDERS, youtubeThumbnail,
  type StudentResourceAttachment, type StudentResourceFolder, type StudentResourceItem,
} from "@/lib/student-resources"

// ─── Types ────────────────────────────────────────────────────────────────────

type LessonResource = {
  id: string
  type: "PDF" | "DOCUMENT" | "IMAGE" | "AUDIO"
  title: string
  description: string | null
  fileUrl: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  allowDownload: boolean
  courseId: string
  courseTitle: string
  lessonId: string
  lessonTitle: string
}

type ResourcesData = { resources: LessonResource[]; total: number; library?: StudentResourceItem[] }

type Handout = {
  id: string
  title: string
  fileUrl: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  session: { id: string; title: string; scheduledAt: string; course: { title: string } | null; tutor: { name: string } }
}

type FolderKey = StudentResourceFolder | "COURSE_FILES" | "HANDOUTS"

/** One thing in a folder, whichever list it came from. */
type Entry = {
  key: string
  folder: FolderKey
  title: string
  /** Where it's from: a course and lesson, a class, or the school's note. */
  subtitle: string | null
  description: string | null
  url: string
  /** "embed" = YouTube/Vimeo, "video" = an uploaded video, "link" = a web page. */
  kind: "embed" | "video" | "file" | "link"
  fileType: "PDF" | "DOCUMENT" | "IMAGE" | "AUDIO" | "VIDEO" | "LINK"
  fileSize: number | null
  level: StudentResourceItem["level"]
  createdAt: string | null
  /** A lesson file its teacher keeps view-only: the card opens this lesson instead of the file. */
  viewInLesson?: string
  /** Further files that go with it, e.g. the answers to an exam video. */
  attachments: StudentResourceAttachment[]
}

/** What the player is showing: an entry, and which of its videos. */
type Playing = { entry: Entry; url: string; kind: "embed" | "video"; title: string }

// ─── Look ─────────────────────────────────────────────────────────────────────

const FOLDER_LOOK: Record<FolderKey | "ALL", { label: string; blurb: string; icon: LucideIcon; gradient: string; soft: string }> = {
  ALL:           { label: "All files", blurb: "Everything in one place", icon: Files,
                   gradient: "from-slate-700 to-slate-900", soft: "bg-slate-100 text-slate-700" },
  VIDEO_LESSONS: { ...FOLDER_INFO.VIDEO_LESSONS, icon: PlayCircle,
                   gradient: "from-rose-500 to-red-600", soft: "bg-rose-100 text-rose-700" },
  EXAM_SAMPLES:  { ...FOLDER_INFO.EXAM_SAMPLES, icon: GraduationCap,
                   gradient: "from-amber-400 to-orange-500", soft: "bg-amber-100 text-amber-800" },
  SLIDES:        { ...FOLDER_INFO.SLIDES, icon: Presentation,
                   gradient: "from-sky-500 to-blue-600", soft: "bg-sky-100 text-sky-700" },
  PRACTICE:      { ...FOLDER_INFO.PRACTICE, icon: PencilLine,
                   gradient: "from-emerald-500 to-teal-600", soft: "bg-emerald-100 text-emerald-700" },
  LINKS:         { ...FOLDER_INFO.LINKS, icon: Link2,
                   gradient: "from-fuchsia-500 to-purple-600", soft: "bg-fuchsia-100 text-fuchsia-700" },
  COURSE_FILES:  { label: "Course files", blurb: "Files from your lessons", icon: BookOpen,
                   gradient: "from-indigo-500 to-violet-600", soft: "bg-indigo-100 text-indigo-700" },
  HANDOUTS:      { label: "Class handouts", blurb: "Shared in your live classes", icon: CalendarDays,
                   gradient: "from-cyan-500 to-teal-500", soft: "bg-cyan-100 text-cyan-700" },
}

const FOLDER_ORDER: FolderKey[] = [...STUDENT_RESOURCE_FOLDERS, "COURSE_FILES", "HANDOUTS"]

const TYPE_LOOK: Record<Entry["fileType"], { label: string; icon: LucideIcon; className: string }> = {
  PDF:      { label: "PDF",      icon: FileText,  className: "bg-rose-50 text-rose-700 border-rose-200" },
  DOCUMENT: { label: "Document", icon: FileText,  className: "bg-blue-50 text-blue-700 border-blue-200" },
  IMAGE:    { label: "Image",    icon: ImageIcon, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  AUDIO:    { label: "Audio",    icon: Music,     className: "bg-violet-50 text-violet-700 border-violet-200" },
  VIDEO:    { label: "Video",    icon: Video,     className: "bg-red-50 text-red-700 border-red-200" },
  LINK:     { label: "Website",  icon: Link2,     className: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200" },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function typeFromMime(mimeType: string | null): Entry["fileType"] {
  if (mimeType === "application/pdf") return "PDF"
  if (mimeType?.startsWith("image/")) return "IMAGE"
  if (mimeType?.startsWith("audio/")) return "AUDIO"
  if (mimeType?.startsWith("video/")) return "VIDEO"
  return "DOCUMENT"
}

function libraryEntry(r: StudentResourceItem): Entry {
  const embed = r.isLink && parseVideoLink(r.url) !== null
  const fileType = r.isLink ? (embed ? "VIDEO" : "LINK") : typeFromMime(r.mimeType)
  return {
    key: `lib-${r.id}`,
    folder: r.folder,
    title: r.title,
    subtitle: null,
    description: r.description,
    url: r.url,
    kind: embed ? "embed" : r.isLink ? "link" : fileType === "VIDEO" ? "video" : "file",
    fileType,
    fileSize: r.fileSize,
    level: r.level,
    createdAt: r.createdAt,
    attachments: r.attachments ?? [],
  }
}

function lessonEntry(r: LessonResource): Entry {
  return {
    key: `asset-${r.id}`,
    folder: "COURSE_FILES",
    title: r.title,
    subtitle: `${r.courseTitle} · ${r.lessonTitle}`,
    description: r.description,
    url: r.fileUrl,
    kind: "file",
    fileType: r.type,
    fileSize: r.fileSize,
    level: null,
    createdAt: null,
    viewInLesson: r.allowDownload ? undefined : `/student/lessons/${r.lessonId}`,
    attachments: [],
  }
}

function handoutEntry(h: Handout): Entry {
  const fileType = typeFromMime(h.mimeType)
  const day = new Date(h.session.scheduledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  return {
    key: `handout-${h.id}`,
    folder: "HANDOUTS",
    title: h.title,
    subtitle: `${h.session.title} · ${day}`,
    description: null,
    url: h.fileUrl,
    kind: fileType === "VIDEO" ? "video" : "file",
    fileType,
    fileSize: h.fileSize,
    level: null,
    createdAt: h.session.scheduledAt,
    attachments: [],
  }
}

function matches(e: Entry, q: string) {
  if (!q) return true
  return [e.title, e.subtitle, e.description, ...e.attachments.map((a) => a.title)]
    .some((s) => s?.toLowerCase().includes(q))
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const [query, setQuery] = useRememberedState("query", "")
  const [openFolder, setOpenFolder] = useRememberedState<FolderKey | "ALL" | null>("folder", null)
  const [playing, setPlaying] = useState<Playing | null>(null)
  const q = useDebounce(query).trim().toLowerCase()

  const { data, loading } = useFetch<ResourcesData>("/api/student/resources", {
    errorMessage: "Could not load resources",
  })
  const { data: handoutData, loading: handoutsLoading } = useFetch<{ handouts: Handout[] }>("/api/student/handouts", {
    errorMessage: false,
  })

  const all: Entry[] = [
    ...(data?.library ?? []).map(libraryEntry),
    ...(data?.resources ?? []).map(lessonEntry),
    ...(handoutData?.handouts ?? []).map(handoutEntry),
  ]
  const counts = new Map<FolderKey, number>()
  for (const e of all) counts.set(e.folder, (counts.get(e.folder) ?? 0) + 1)

  const isLoading = loading || handoutsLoading
  const folderEntries = (f: FolderKey | "ALL") => all.filter((e) => f === "ALL" || e.folder === f)
  // A folder that has since emptied (or a stale remembered one) falls back to the grid.
  const current = openFolder && (openFolder === "ALL" || counts.get(openFolder)) ? openFolder : null
  const shown = q ? all.filter((e) => matches(e, q)) : current ? folderEntries(current) : []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <FolderOpen className="size-6 text-primary" /> Resources
          </h1>
          <p className="text-muted-foreground mt-1">
            {isLoading ? " " : `${all.length} item${all.length !== 1 ? "s" : ""} to help you practise outside class`}
          </p>
        </div>
        <div className="relative sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search all resources…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : all.length === 0 ? (
        <EmptyState text="Videos, exam samples and files for practice will appear here." />
      ) : q ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {shown.length} result{shown.length !== 1 ? "s" : ""} for “{query.trim()}”
          </h2>
          {shown.length ? <EntryGrid entries={shown} showFolder onPlay={setPlaying} /> : <EmptyState text="Nothing matches that search." />}
        </section>
      ) : current ? (
        <section className="flex flex-col gap-5">
          <FolderBanner folder={current} count={shown.length} onBack={() => setOpenFolder(null)} />
          <EntryGrid entries={shown} showFolder={current === "ALL"} onPlay={setPlaying} />
        </section>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          <FolderTile folder="ALL" count={all.length} onOpen={() => setOpenFolder("ALL")} />
          {FOLDER_ORDER.filter((f) => counts.get(f)).map((f) => (
            <FolderTile key={f} folder={f} count={counts.get(f) ?? 0} onOpen={() => setOpenFolder(f)} />
          ))}
        </div>
      )}

      <Dialog open={!!playing} onOpenChange={(o) => { if (!o) setPlaying(null) }}>
        <DialogContent className="sm:max-w-4xl p-0 overflow-hidden gap-0">
          <DialogTitle className="px-5 pt-4 pb-3 text-base pr-12">
            {playing?.entry.title}
            {playing && playing.title !== playing.entry.title && (
              <span className="text-muted-foreground font-normal"> · {playing.title}</span>
            )}
          </DialogTitle>
          {playing && (
            <div className="bg-black aspect-video">
              {playing.kind === "embed" ? (
                <EmbeddedVideo key={playing.url} url={playing.url} autoPlay className="size-full" />
              ) : (
                <ProtectedVideo key={playing.url} src={playing.url} controls autoPlay playsInline className="size-full" />
              )}
            </div>
          )}
          {playing?.entry.description && (
            <p className="px-5 pt-3 text-sm text-muted-foreground whitespace-pre-line">{playing.entry.description}</p>
          )}
          {playing && playing.entry.attachments.length > 0 && (
            <div className="px-5 py-3">
              <Attachments
                entry={playing.entry}
                current={playing.url}
                onPlay={setPlaying}
                includeMain={playing.entry.kind === "embed" || playing.entry.kind === "video"}
              />
            </div>
          )}
          {playing && !playing.entry.attachments.length && <div className="h-2" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function FolderTile({ folder, count, onOpen }: { folder: FolderKey | "ALL"; count: number; onOpen: () => void }) {
  const look = FOLDER_LOOK[folder]
  const Icon = look.icon
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative overflow-hidden rounded-2xl p-5 text-left text-white shadow-md bg-gradient-to-br",
        "min-h-36 sm:min-h-44 flex flex-col justify-between transition-all duration-200",
        "hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
        look.gradient,
      )}
    >
      {/* Big faint icon behind, for a bit of depth. */}
      <Icon aria-hidden className="absolute -right-5 -bottom-5 size-32 opacity-15 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6" />
      <div className="flex items-start justify-between gap-2">
        <span className="rounded-xl bg-white/20 p-2.5 backdrop-blur-sm">
          <Icon className="size-6 sm:size-7" />
        </span>
        <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-xs font-bold tabular-nums">{count}</span>
      </div>
      <div className="relative">
        <p className="text-lg sm:text-xl font-black leading-tight">{look.label}</p>
        <p className="text-xs sm:text-sm text-white/85 mt-0.5">{look.blurb}</p>
      </div>
    </button>
  )
}

function FolderBanner({ folder, count, onBack }: { folder: FolderKey | "ALL"; count: number; onBack: () => void }) {
  const look = FOLDER_LOOK[folder]
  const Icon = look.icon
  return (
    <div className="flex flex-col gap-3">
      <Button variant="ghost" size="sm" className="self-start -ml-2" onClick={onBack}>
        <ArrowLeft className="size-4 mr-1" /> All folders
      </Button>
      <div className={cn("relative overflow-hidden rounded-2xl p-5 sm:p-6 text-white bg-gradient-to-br shadow-md", look.gradient)}>
        <Icon aria-hidden className="absolute -right-4 -bottom-6 size-36 opacity-15" />
        <div className="relative flex items-center gap-4">
          <span className="rounded-xl bg-white/20 p-3"><Icon className="size-7" /></span>
          <div>
            <h2 className="text-xl sm:text-2xl font-black leading-tight">{look.label}</h2>
            <p className="text-sm text-white/85">{count} item{count !== 1 ? "s" : ""} · {look.blurb}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The entry's main video, ready for the player. */
function mainVideo(e: Entry): Playing {
  return { entry: e, url: e.url, kind: e.kind === "embed" ? "embed" : "video", title: e.title }
}

function isVideoAttachment(a: StudentResourceAttachment) {
  return a.mimeType?.startsWith("video/") ?? /\.(mp4|webm|mov|m4v)$/i.test(a.fileName ?? a.url)
}

/**
 * The extra files on a card (e.g. the answers to an exam video): videos play
 * in the page's player, other files open in a new tab.
 */
function Attachments({ entry, current, onPlay, includeMain = false }: {
  entry: Entry
  current?: string
  onPlay: (p: Playing) => void
  /** In the player: list the main video too, to go back to it. */
  includeMain?: boolean
}) {
  const chip = "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
        <Paperclip className="size-3" /> Also with this
      </p>
      <div className="flex flex-wrap gap-1.5">
        {includeMain && (
          <button type="button" onClick={() => onPlay(mainVideo(entry))}
            className={cn(chip, current === entry.url ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
            <Play className="size-3 shrink-0" /> <span className="truncate">{entry.title}</span>
          </button>
        )}
        {entry.attachments.map((a, i) => {
          const type = TYPE_LOOK[typeFromMime(a.mimeType)]
          if (isVideoAttachment(a)) {
            return (
              <button key={`${a.url}-${i}`} type="button"
                onClick={() => onPlay({ entry, url: a.url, kind: "video", title: a.title })}
                className={cn(chip, current === a.url ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                <Play className="size-3 shrink-0" /> <span className="truncate">{a.title}</span>
              </button>
            )
          }
          const Icon = type.icon
          return (
            <a key={`${a.url}-${i}`} href={mediaSrc(a.url)} target="_blank" rel="noopener noreferrer"
              className={cn(chip, "hover:bg-muted")}>
              <Icon className="size-3 shrink-0" /> <span className="truncate">{a.title}</span>
              {a.fileSize ? <span className="text-muted-foreground shrink-0">{formatBytes(a.fileSize)}</span> : null}
            </a>
          )
        })}
      </div>
    </div>
  )
}

function EntryGrid({ entries, showFolder, onPlay }: { entries: Entry[]; showFolder: boolean; onPlay: (p: Playing) => void }) {
  const videos = entries.filter((e) => e.kind === "embed" || e.kind === "video")
  const others = entries.filter((e) => e.kind !== "embed" && e.kind !== "video")
  return (
    <div className="flex flex-col gap-5">
      {videos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((e) => <VideoCard key={e.key} entry={e} showFolder={showFolder} onPlay={onPlay} />)}
        </div>
      )}
      {others.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {others.map((e) => <FileCard key={e.key} entry={e} showFolder={showFolder} onPlay={onPlay} />)}
        </div>
      )}
    </div>
  )
}

function Tags({ entry, showFolder }: { entry: Entry; showFolder: boolean }) {
  const type = TYPE_LOOK[entry.fileType]
  const folder = FOLDER_LOOK[entry.folder]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className={cn("text-[0.625rem]", type.className)}>{type.label}</Badge>
      {showFolder && <Badge variant="outline" className={cn("text-[0.625rem] border-transparent", folder.soft)}>{folder.label}</Badge>}
      {entry.level && <Badge variant="outline" className={cn("text-[0.625rem]", levelColor[entry.level])}>{levelLabel[entry.level]}</Badge>}
    </div>
  )
}

function VideoCard({ entry, showFolder, onPlay }: { entry: Entry; showFolder: boolean; onPlay: (p: Playing) => void }) {
  const thumb = youtubeThumbnail(entry.url)
  return (
    <Card className="group overflow-hidden p-0 gap-0 shadow-sm transition-all hover:shadow-lg hover:-translate-y-0.5 h-full">
      <button type="button" onClick={() => onPlay(mainVideo(entry))} className="text-left flex flex-col">
        <div className="relative aspect-video bg-gradient-to-br from-slate-800 to-slate-950">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- YouTube's own still
            <img src={thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          ) : (
            <Video aria-hidden className="absolute inset-0 m-auto size-12 text-white/30" />
          )}
          <div className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/35" />
          <span className="absolute inset-0 m-auto flex size-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform group-hover:scale-110">
            <Play className="size-6 fill-current ml-0.5" />
          </span>
        </div>
        <CardContent className="p-4 flex flex-col gap-1.5">
          <Tags entry={entry} showFolder={showFolder} />
          <p className="font-semibold leading-snug line-clamp-2">{entry.title}</p>
          {(entry.subtitle || entry.description) && (
            <p className="text-xs text-muted-foreground line-clamp-2">{entry.subtitle ?? entry.description}</p>
          )}
        </CardContent>
      </button>
      {entry.attachments.length > 0 && (
        <div className="px-4 pb-4 -mt-1">
          <Attachments entry={entry} onPlay={onPlay} />
        </div>
      )}
    </Card>
  )
}

function FileCard({ entry, showFolder, onPlay }: { entry: Entry; showFolder: boolean; onPlay: (p: Playing) => void }) {
  const type = TYPE_LOOK[entry.fileType]
  const folder = FOLDER_LOOK[entry.folder]
  const Icon = entry.kind === "link" ? Link2 : type.icon
  const href = entry.viewInLesson ?? (entry.kind === "link" ? entry.url : mediaSrc(entry.url))
  const details = [entry.subtitle ?? entry.description, entry.fileSize ? formatBytes(entry.fileSize) : null].filter(Boolean).join(" · ")
  return (
    <Card className="group shadow-sm transition-all hover:shadow-md hover:border-primary h-full p-0 gap-0">
      <a href={href} target={entry.viewInLesson ? undefined : "_blank"} rel="noopener noreferrer">
        <CardContent className="p-4 flex items-center gap-4">
          <div className={cn("rounded-xl p-3 shrink-0 transition-transform group-hover:scale-105", folder.soft)}>
            <Icon className="size-6" />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <Tags entry={entry} showFolder={showFolder} />
            <p className="text-sm font-semibold leading-snug line-clamp-2">{entry.title}</p>
            {details && <p className="text-xs text-muted-foreground truncate">{details}</p>}
          </div>
          <span className="shrink-0 text-muted-foreground group-hover:text-primary">
            {entry.viewInLesson ? <Eye className="size-4" /> : entry.kind === "link" ? <ExternalLink className="size-4" /> : <Download className="size-4" />}
          </span>
        </CardContent>
      </a>
      {entry.attachments.length > 0 && (
        <div className="px-4 pb-4 -mt-1">
          <Attachments entry={entry} onPlay={onPlay} />
        </div>
      )}
    </Card>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-muted p-6">
          <FolderOpen className="size-10 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold text-lg">No resources found</p>
          <p className="text-sm text-muted-foreground mt-1">{text}</p>
        </div>
      </CardContent>
    </Card>
  )
}
