"use client"

/**
 * Pick files from the tutor's resource library instead of uploading them again.
 *
 * Hands back the same `UploadedFile` shape a fresh upload produces, so every
 * screen that already accepts an upload accepts a picked file with no other
 * change: the stored file is shared, and only its reference is copied.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  Search, FileText, Video, Image as ImageIcon, Music, Check, Loader2, FolderOpen,
} from "lucide-react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFetch } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"
import type { UploadedFile } from "@/components/ui/file-upload"
import type { LibraryAssetType, LibraryItem } from "@/lib/library"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (files: UploadedFile[]) => void
  /** Only these kinds of file can be picked (e.g. videos for a video lesson). */
  allowedTypes?: readonly LibraryAssetType[]
  /** Files already attached where the picker was opened, shown as such. */
  attachedUrls?: readonly string[]
}

export function itemIcon(assetType: string) {
  if (assetType === "VIDEO") return Video
  if (assetType === "IMAGE") return ImageIcon
  if (assetType === "AUDIO") return Music
  return FileText
}

export function formatBytes(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function toUploadedFile(item: LibraryItem): UploadedFile {
  return {
    fileUrl: item.fileUrl,
    fileName: item.fileName,
    fileSize: item.fileSize ?? 0,
    mimeType: item.mimeType ?? "",
    assetType: item.assetType,
    presentationUrl: item.presentationUrl ?? undefined,
    presentationMimeType: item.presentationMimeType ?? undefined,
  }
}

export function LibraryPicker({ open, onOpenChange, ...rest }: Props) {
  // The body mounts each time the dialog opens, so every opening starts with an
  // empty selection and a fresh list — files may have been added in another tab.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PickerBody onOpenChange={onOpenChange} {...rest} />}
    </Dialog>
  )
}

function PickerBody({ onOpenChange, onPick, allowedTypes, attachedUrls = [] }: Omit<Props, "open">) {
  const { data, loading } = useFetch<{ items: LibraryItem[] }>("/api/tutor/library", {
    errorMessage: "Could not load your library",
  })
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const attached = useMemo(() => new Set(attachedUrls), [attachedUrls])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.items ?? []).filter((item) =>
      (!allowedTypes || allowedTypes.includes(item.assetType)) &&
      (!q || item.title.toLowerCase().includes(q) || item.fileName.toLowerCase().includes(q)),
    )
  }, [data, query, allowedTypes])

  const libraryItems = items.filter((i) => i.source === "library")
  const usedItems = items.filter((i) => i.source === "used")

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  function confirm() {
    const byUrl = new Map(items.map((i) => [i.fileUrl, i]))
    const picked = [...selected].flatMap((url) => {
      const item = byUrl.get(url)
      return item ? [toUploadedFile(item)] : []
    })
    onPick(picked)
    onOpenChange(false)
  }

  function renderItem(item: LibraryItem) {
    const Icon = itemIcon(item.assetType)
    const isAttached = attached.has(item.fileUrl)
    const isSelected = selected.has(item.fileUrl)
    return (
      <button
        key={item.fileUrl}
        type="button"
        disabled={isAttached}
        onClick={() => toggle(item.fileUrl)}
        aria-pressed={isSelected}
        className={cn(
          "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors overflow-hidden",
          isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
          isAttached && "opacity-50 cursor-not-allowed",
        )}
      >
        <div className="rounded-lg bg-primary/10 p-2 shrink-0">
          <Icon className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" title={item.title}>{item.title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {[
              item.assetType.toLowerCase(),
              formatBytes(item.fileSize),
              item.usedIn,
              isAttached ? "Already added" : null,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div
          className={cn(
            "size-5 shrink-0 rounded-md border flex items-center justify-center",
            isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30",
          )}
          aria-hidden
        >
          {isSelected && <Check className="size-3.5" />}
        </div>
      </button>
    )
  }

  return (
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose from library</DialogTitle>
          <DialogDescription>
            Pick files you&apos;ve already uploaded. They&apos;re added without uploading again.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search files"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-4 max-h-[50vh] overflow-y-auto -mx-1 px-1">
          {loading && !data ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <FolderOpen className="size-8" />
              {query ? "No files match your search." : "No files here yet."}
              <Link href="/tutor/library" className="text-primary font-medium hover:underline">
                Upload files to your library
              </Link>
            </div>
          ) : (
            <>
              {libraryItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Library</p>
                  {libraryItems.map(renderItem)}
                </div>
              )}
              {usedItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Used in your lessons and sessions
                  </p>
                  {usedItems.map(renderItem)}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/tutor/library">Manage library</Link>
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={confirm} disabled={selected.size === 0}>
              {selected.size > 1 ? `Add ${selected.size} files` : "Add file"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
  )
}
