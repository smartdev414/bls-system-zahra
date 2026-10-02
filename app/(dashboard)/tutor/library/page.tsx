"use client"

/**
 * The resource library.
 *
 * Admins upload a level's materials once, in advance, filed by level — then,
 * when building a lesson or scheduling a class, the day's files are picked from
 * here instead of being uploaded on the day. Teachers browse and pick from the
 * same library; they do not add to it, so everyone works from one set of files.
 */

import { useMemo, useRef, useState } from "react"
import { Upload, Loader2, Trash2, Search, FolderOpen, CheckCircle2, AlertCircle, Captions, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useFetch } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"
import { uploadFile } from "@/lib/upload-file"
import { mediaSrc } from "@/lib/protected-media"
import { itemIcon, formatBytes } from "@/components/library/LibraryPicker"
import { parsePreparedCaptions, PREPARED_CAPTION_LIMIT, type LibraryItem } from "@/lib/library"
import { COURSE_LEVELS, levelColorSolid, levelLabel, type CourseLevel } from "@/lib/levels"

const ACCEPT =
  "video/mp4,video/webm,video/quicktime,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  ".ppt,.pptx,image/*,audio/mpeg,audio/wav"

type UploadRow = { key: string; name: string; status: "uploading" | "done" | "error"; error?: string }

/**
 * Captions written before class and sent into the live classroom with one
 * click from "Type caption" — so the tutor never stops signing to type them.
 */
function PreparedCaptionsCard() {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { data, loading } = useFetch<{ captions: string[] }>("/api/tutor/library/captions", {
    errorMessage: "Could not load prepared captions",
  })
  const saved = (data?.captions ?? []).join("\n")
  const value = draft ?? saved
  const count = parsePreparedCaptions(value).length

  async function save() {
    setSaving(true)
    try {
      const res = await fetch("/api/tutor/library/captions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captions: parsePreparedCaptions(value) }),
      })
      if (!res.ok) throw new Error()
      const body = await res.json() as { captions: string[] }
      setDraft(body.captions.join("\n"))
      toast.success("Prepared captions saved")
    } catch {
      toast.error("Could not save prepared captions")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Captions className="size-4 text-primary" /> Prepared captions
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            One per line. In class, open <span className="font-medium">Type caption</span> and click one to show it
            at the bottom of everyone&apos;s screen.
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={saving || loading || draft === null || value === saved}>
          {saving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Save className="size-3.5 mr-1.5" />}
          Save
        </Button>
      </div>
      <Textarea
        rows={6}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        disabled={loading && !data}
        placeholder={"Welcome to today's class\nPlease turn your cameras on\nPractise with your partner — signing only, no voices please\nWe'll take a 5 minute break"}
      />
      <p className="text-xs text-muted-foreground">{count} of {PREPARED_CAPTION_LIMIT}</p>
    </section>
  )
}

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

export default function TutorLibraryPage() {
  const { data, loading, refetch } = useFetch<{ items: LibraryItem[]; canManage: boolean }>("/api/tutor/library", {
    errorMessage: "Could not load the library",
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [query, setQuery] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)
  // Level new uploads are filed under, and the level the list is narrowed to.
  const [uploadLevel, setUploadLevel] = useState<CourseLevel | "">("")
  const [levelFilter, setLevelFilter] = useState<CourseLevel | "" | "NONE">("")

  // Only admins add to (and re-file) the school's library.
  const canManage = data?.canManage ?? false
  const busy = uploads.some((u) => u.status === "uploading")

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.items ?? []).filter(
      (i) =>
        (!q || i.title.toLowerCase().includes(q) || i.fileName.toLowerCase().includes(q)) &&
        (levelFilter === "" || (levelFilter === "NONE" ? i.level === null : i.level === levelFilter)),
    )
  }, [data, query, levelFilter])
  const schoolItems = items.filter((i) => i.source === "library" && i.shared)
  const ownItems = items.filter((i) => i.source === "library" && !i.shared)
  const usedItems = items.filter((i) => i.source === "used")

  function setRow(key: string, patch: Partial<UploadRow>) {
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)))
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) return
    const rows = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, status: "uploading" as const }))
    setUploads((prev) => [...rows, ...prev.filter((u) => u.status !== "done")])

    // One at a time: dropping a whole term's videos on café Wi-Fi is better
    // served by steady progress than by twenty uploads fighting.
    let added = 0
    for (const [i, file] of files.entries()) {
      const key = rows[i].key
      try {
        const uploaded = await uploadFile(file)
        const res = await fetch("/api/tutor/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: [uploaded], level: uploadLevel || null }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { message?: string }
          throw new Error(d.message ?? "Could not add to library")
        }
        added++
        setRow(key, { status: "done" })
      } catch (e) {
        setRow(key, { status: "error", error: e instanceof Error ? e.message : "Upload failed" })
      }
    }
    if (added > 0) {
      toast.success(added === 1 ? "File added to the library" : `${added} files added to the library`)
      void refetch()
    }
  }

  async function addUsedToLibrary(item: LibraryItem) {
    const res = await fetch("/api/tutor/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [item], level: uploadLevel || null }),
    })
    if (res.ok) void refetch()
    else toast.error("Could not add to library")
  }

  async function setLevel(item: LibraryItem, level: CourseLevel | null) {
    const res = await fetch(`/api/tutor/library/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    })
    if (res.ok) void refetch()
    else toast.error("Could not change the level")
  }

  async function remove(item: LibraryItem) {
    setRemoving(item.id)
    try {
      const res = await fetch(`/api/tutor/library/${item.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      void refetch()
    } catch {
      toast.error("Could not remove file")
    } finally {
      setRemoving(null)
    }
  }

  function renderRow(item: LibraryItem) {
    const Icon = itemIcon(item.assetType)
    return (
      <div key={item.fileUrl} className="flex items-center gap-3 rounded-xl border bg-card p-3 overflow-hidden">
        <div className="rounded-lg bg-primary/10 p-2 shrink-0">
          <Icon className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <a
            href={mediaSrc(item.fileUrl)}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold truncate block hover:underline"
            title={item.title}
          >
            {item.title}
          </a>
          <p className="text-xs text-muted-foreground truncate">
            {[item.assetType.toLowerCase(), formatBytes(item.fileSize), item.usedIn].filter(Boolean).join(" · ")}
          </p>
        </div>
        {item.source === "library" && (
          canManage && item.shared ? (
            <select
              value={item.level ?? ""}
              onChange={(e) => setLevel(item, (e.target.value || null) as CourseLevel | null)}
              className={cn(selectClass, "h-8 text-xs shrink-0")}
              aria-label={`Level for ${item.title}`}
            >
              <option value="">Any level</option>
              {COURSE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          ) : item.level ? (
            <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", levelColorSolid[item.level])}>
              {item.level}
            </span>
          ) : null
        )}
        {item.source === "library" ? (
          item.canRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-destructive hover:text-destructive"
              onClick={() => remove(item)}
              disabled={removing === item.id}
              title="Remove from library (lessons already using it keep it)"
              aria-label={`Remove ${item.title} from library`}
            >
              {removing === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            </Button>
          )
        ) : canManage ? (
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => addUsedToLibrary(item)}>
            Add to library
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Resource Library</h1>
        <p className="text-muted-foreground mt-1">
          {canManage
            ? "Upload the school's materials once, filed by level. Every teacher can then pick them into a lesson or a class."
            : "The school's materials, ready to pick when you schedule a class. Files are added by the school, so everyone teaches from the same set."}
        </p>
      </div>

      {/* Upload — admins only */}
      {canManage && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">File new uploads under</span>
            <select
              value={uploadLevel}
              onChange={(e) => setUploadLevel(e.target.value as CourseLevel | "")}
              className={selectClass}
              aria-label="Level for new uploads"
            >
              <option value="">Any level</option>
              {COURSE_LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (!busy) void handleFiles(e.dataTransfer.files) }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
              busy
                ? "opacity-60 cursor-wait border-muted"
                : "hover:border-primary hover:bg-primary/5 cursor-pointer border-muted-foreground/25",
            )}
          >
            {busy ? <Loader2 className="size-8 animate-spin text-primary" /> : <Upload className="size-8 text-muted-foreground" />}
            <div>
              <p className="text-sm font-semibold">{busy ? "Uploading…" : "Upload files"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Drag & drop or click — you can choose several at once. Videos, PDFs, Word, PowerPoint, images, audio.
              </p>
            </div>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files)
              e.target.value = ""
            }}
          />

          {uploads.length > 0 && (
            <ul className="flex flex-col gap-1">
              {uploads.map((u) => (
                <li key={u.key} className="flex items-center gap-2 text-xs">
                  {u.status === "uploading" && <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />}
                  {u.status === "done" && <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />}
                  {u.status === "error" && <AlertCircle className="size-3.5 text-destructive shrink-0" />}
                  <span className="truncate">{u.name}</span>
                  {u.error && <span className="text-destructive shrink-0">— {u.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Captions are a teacher's own, typed for their classes */}
      {data && !canManage && <PreparedCaptionsCard />}

      {/* Files */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search files" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as CourseLevel | "" | "NONE")}
          className={selectClass}
          aria-label="Filter by level"
        >
          <option value="">All levels</option>
          {COURSE_LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
          <option value="NONE">No level</option>
        </select>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center min-h-40">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <FolderOpen className="size-10" />
          {query || levelFilter
            ? "No files match your search."
            : canManage
            ? "The library is empty. Upload files above to get started."
            : "The library is empty. The school adds files here for you to use."}
        </div>
      ) : (
        <>
          {schoolItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                School library ({schoolItems.length})
              </p>
              {schoolItems.map(renderRow)}
            </section>
          )}
          {ownItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Files you added earlier ({ownItems.length})
              </p>
              <p className="text-xs text-muted-foreground -mt-1">
                Only you can see these. You can still pick them, or remove the ones you no longer need.
              </p>
              {ownItems.map(renderRow)}
            </section>
          )}
          {usedItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Already used in lessons and sessions ({usedItems.length})
              </p>
              <p className="text-xs text-muted-foreground -mt-1">
                {canManage
                  ? "These can be picked too. Add one to the library to keep it with the school's other materials."
                  : "These can be picked too."}
              </p>
              {usedItems.map(renderRow)}
            </section>
          )}
        </>
      )}
    </div>
  )
}
