"use client"

/**
 * Pick signs from the dictionary to build a test from — the school's signs,
 * already filmed and named, instead of uploading and typing them again.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Check, Library, Loader2, Search } from "lucide-react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { useFetch } from "@/hooks/use-fetch"
import { COURSE_LEVELS, levelLabel, type CourseLevel } from "@/lib/levels"
import { cn } from "@/lib/utils"

export type DictionarySign = {
  id: string
  word: string
  category: string
  level: CourseLevel
  videoUrl: string | null
  imageUrl: string | null
}

type Page = { signs: DictionarySign[]; page: number; totalPages: number; total: number; categories: string[] }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (signs: DictionarySign[]) => void
  /** One sign (for a question's clip) or several (to make questions from). */
  multiple?: boolean
  /** What the picked signs will become, under the title. */
  description?: string
  /** Level to start on — the test's own. */
  initialLevel?: CourseLevel | null
}

export function DictionaryPicker({ open, onOpenChange, ...rest }: Props) {
  // Mounted on each opening, so it starts with nothing picked.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PickerBody onOpenChange={onOpenChange} {...rest} />}
    </Dialog>
  )
}

function SignThumb({ sign }: { sign: DictionarySign }) {
  if (sign.imageUrl) return <img src={sign.imageUrl} alt="" className="w-full h-full object-contain" />
  if (sign.videoUrl) {
    return <ProtectedVideo src={sign.videoUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
  }
  return <span className="text-[10px] text-muted-foreground px-1 text-center">No video or picture</span>
}

function PickerBody({ onOpenChange, onPick, multiple = true, description, initialLevel }: Omit<Props, "open">) {
  const dictionaryHref = usePathname()?.startsWith("/admin") ? "/admin/signs" : "/tutor/dictionary"
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [level, setLevel] = useState<CourseLevel | "">(initialLevel ?? "")
  const [category, setCategory] = useState("")
  const [page, setPage] = useState(1)
  // Pages already loaded for this search, so "Show more" adds to the list.
  const [signs, setSigns] = useState<DictionarySign[]>([])
  // Kept by id across searches: pick some greetings, search colours, pick more.
  const [picked, setPicked] = useState<Map<string, DictionarySign>>(new Map())

  // Searching starts once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  // Only signs with a video or picture can be a question.
  const params = new URLSearchParams({ page: String(page), withMedia: "1" })
  if (search) params.set("q", search)
  if (level) params.set("level", level)
  if (category) params.set("category", category)
  const { data, loading } = useFetch<Page>(`/api/dictionary?${params}`, {
    errorMessage: "Could not load the dictionary",
    onSuccess: (d) => setSigns((current) => (d.page === 1 ? d.signs : [...current, ...d.signs])),
  })

  function resetTo(change: () => void) {
    change()
    setPage(1)
  }

  const usable = (sign: DictionarySign) => !!(sign.videoUrl || sign.imageUrl)

  function toggle(sign: DictionarySign) {
    if (!usable(sign)) return
    if (!multiple) {
      onPick([sign])
      onOpenChange(false)
      return
    }
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(sign.id)) next.delete(sign.id)
      else next.set(sign.id, sign)
      return next
    })
  }

  const shownUsable = signs.filter(usable)
  const allShownPicked = shownUsable.length > 0 && shownUsable.every((s) => picked.has(s.id))
  function toggleAllShown() {
    setPicked((prev) => {
      const next = new Map(prev)
      for (const sign of shownUsable) {
        if (allShownPicked) next.delete(sign.id)
        else next.set(sign.id, sign)
      }
      return next
    })
  }

  function confirm() {
    onPick([...picked.values()])
    onOpenChange(false)
  }

  const selectClass =
    "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{multiple ? "Add signs from the dictionary" : "Choose a sign"}</DialogTitle>
        <DialogDescription>
          {description ?? "Pick signs from the school's dictionary."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search signs"
            value={query}
            autoFocus
            onChange={(e) => resetTo(() => setQuery(e.target.value))}
          />
        </div>
        <div className="flex gap-2">
          <select
            value={level}
            onChange={(e) => resetTo(() => setLevel(e.target.value as CourseLevel | ""))}
            className={cn(selectClass, "flex-1 sm:flex-none")}
            aria-label="Filter by level"
          >
            <option value="">All levels</option>
            {COURSE_LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
          </select>
          <select
            value={category}
            onChange={(e) => resetTo(() => setCategory(e.target.value))}
            className={cn(selectClass, "flex-1 sm:flex-none sm:max-w-44")}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {(data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {multiple && shownUsable.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {data?.total ?? 0} sign{data?.total === 1 ? "" : "s"} with a video.{" "}
            <Link href={dictionaryHref} className="text-primary hover:underline">Signs still to be filmed</Link> are not shown.
          </span>
          <button type="button" className="font-medium text-primary hover:underline" onClick={toggleAllShown}>
            {allShownPicked ? "Unselect these" : `Select all ${shownUsable.length} shown`}
          </button>
        </div>
      )}

      <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
        {loading && signs.length === 0 ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : signs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Library className="size-8" />
            {search || level || category
              ? "No signs with a video match your search."
              : "No signs in the dictionary have a video yet."}
            <Link href={dictionaryHref} className="text-primary font-medium hover:underline">Open the dictionary</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {signs.map((sign) => {
              const isPicked = picked.has(sign.id)
              const canPick = usable(sign)
              return (
                <button
                  key={sign.id}
                  type="button"
                  disabled={!canPick}
                  aria-pressed={multiple ? isPicked : undefined}
                  onClick={() => toggle(sign)}
                  className={cn(
                    "relative flex flex-col rounded-xl border text-left overflow-hidden transition-colors",
                    isPicked ? "border-primary ring-1 ring-primary bg-primary/5" : "hover:bg-muted/50",
                    !canPick && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <div className="aspect-video bg-muted flex items-center justify-center pointer-events-none">
                    <SignThumb sign={sign} />
                  </div>
                  <div className="px-2 py-1.5 min-w-0">
                    <p className="text-sm font-semibold truncate">{sign.word}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{sign.category} · {levelLabel[sign.level]}</p>
                  </div>
                  {multiple && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1.5 right-1.5 size-5 rounded-md border flex items-center justify-center bg-background",
                        isPicked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40",
                      )}
                    >
                      {isPicked && <Check className="size-3.5" />}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        {data && data.page < data.totalPages && (
          <div className="flex justify-center pt-3">
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => setPage((p) => p + 1)}>
              {loading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null} Show more
            </Button>
          </div>
        )}
      </div>

      {multiple && (
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={confirm} disabled={picked.size === 0}>
            {picked.size === 0 ? "Add signs" : `Add ${picked.size} sign${picked.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      )}
    </DialogContent>
  )
}
