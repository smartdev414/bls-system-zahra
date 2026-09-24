"use client"

/**
 * The tutor's resource library.
 *
 * Upload a level's materials once, in advance — then, when building a lesson or
 * scheduling a class, pick the day's files from here instead of uploading them
 * on the day. Several files can be dropped at once.
 */

import { useMemo, useRef, useState } from "react"
import { Upload, Loader2, Trash2, Search, FolderOpen, CheckCircle2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFetch } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"
import { uploadFile } from "@/lib/upload-file"
import { itemIcon, formatBytes } from "@/components/library/LibraryPicker"
import type { LibraryItem } from "@/lib/library"

const ACCEPT =
  "video/mp4,video/webm,video/quicktime,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  ".ppt,.pptx,image/*,audio/mpeg,audio/wav"

type UploadRow = { key: string; name: string; status: "uploading" | "done" | "error"; error?: string }

export default function TutorLibraryPage() {
  const { data, loading, refetch } = useFetch<{ items: LibraryItem[] }>("/api/tutor/library", {
    errorMessage: "Could not load your library",
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [query, setQuery] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)

  const busy = uploads.some((u) => u.status === "uploading")

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.items ?? []).filter(
      (i) => !q || i.title.toLowerCase().includes(q) || i.fileName.toLowerCase().includes(q),
    )
  }, [data, query])
  const libraryItems = items.filter((i) => i.source === "library")
  const usedItems = items.filter((i) => i.source === "used")

  function setRow(key: string, patch: Partial<UploadRow>) {
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)))
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) return
    const rows = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, status: "uploading" as const }))
    setUploads((prev) => [...rows, ...prev.filter((u) => u.status !== "done")])

    // One at a time: a tutor dropping a whole term's videos on café Wi-Fi is
    // better served by steady progress than by twenty uploads fighting.
    let added = 0
    for (const [i, file] of files.entries()) {
      const key = rows[i].key
      try {
        const uploaded = await uploadFile(file)
        const res = await fetch("/api/tutor/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: [uploaded] }),
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
      toast.success(added === 1 ? "File added to your library" : `${added} files added to your library`)
      void refetch()
    }
  }

  async function addUsedToLibrary(item: LibraryItem) {
    const res = await fetch("/api/tutor/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [item] }),
    })
    if (res.ok) void refetch()
    else toast.error("Could not add to library")
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
            href={item.fileUrl}
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
        {item.source === "library" ? (
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
        ) : (
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => addUsedToLibrary(item)}>
            Add to library
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Resource Library</h1>
        <p className="text-muted-foreground mt-1">
          Upload your materials once, then pick them when you add a lesson or schedule a class.
        </p>
      </div>

      {/* Upload */}
      <div className="flex flex-col gap-2">
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

      {/* Files */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search files" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center min-h-40">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <FolderOpen className="size-10" />
          {query ? "No files match your search." : "Your library is empty. Upload files above to get started."}
        </div>
      ) : (
        <>
          {libraryItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                In your library ({libraryItems.length})
              </p>
              {libraryItems.map(renderRow)}
            </section>
          )}
          {usedItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Already used in your lessons and sessions ({usedItems.length})
              </p>
              <p className="text-xs text-muted-foreground -mt-1">
                These can be picked too. Add one to the library to keep it with your other materials.
              </p>
              {usedItems.map(renderRow)}
            </section>
          )}
        </>
      )}
    </div>
  )
}
