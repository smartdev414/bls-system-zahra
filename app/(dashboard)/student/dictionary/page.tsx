"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Search, Library, PlayCircle, BookOpen, Loader2, Filter, Image as ImageIcon, Star, Layers, CalendarDays } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { Pagination } from "@/components/ui/pagination"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { COURSE_LEVELS, levelColor, type CourseLevel } from "@/lib/levels"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Sign = {
  id: string
  word: string
  category: string
  level: CourseLevel
  description: string
  videoUrl: string | null
  imageUrl: string | null
  handshape: string
  usage: string
  showLevel?: boolean
  /** Starred by this student — in "My signs". */
  saved?: boolean
}

type DictionaryData = {
  signs: Sign[]
  total: number
  totalPages: number
  page: number
  categories: string[]
  savedCount?: number
}

function buildUrl(q: string, category: string, level: string, page: number, savedOnly: boolean) {
  const params = new URLSearchParams()
  if (savedOnly) params.set("saved", "1")
  if (q) params.set("q", q)
  if (category && category !== "all") params.set("category", category)
  if (level && level !== "all") params.set("level", level)
  params.set("page", String(page))
  return `/api/dictionary?${params.toString()}`
}

// ─── Card thumbnail ───────────────────────────────────────────────────────────

function SignThumbnail({ sign, size = "md" }: { sign: Sign; size?: "md" | "lg" }) {
  const cls = size === "lg"
    ? "w-full aspect-video rounded-xl object-cover"
    : "size-full object-cover"

  if (sign.videoUrl) {
    return (
      <div className={`bg-primary/10 flex items-center justify-center ${size === "lg" ? "aspect-video w-full rounded-xl" : "size-full"}`}>
        <PlayCircle className={size === "lg" ? "size-12 text-primary" : "size-8 text-primary"} />
      </div>
    )
  }
  if (sign.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sign.imageUrl}
        alt={sign.word}
        className={`${cls} select-none pointer-events-none`}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
      />
    )
  }
  return (
    <div className={`bg-primary/10 flex items-center justify-center ${size === "lg" ? "aspect-video w-full rounded-xl" : "size-full"}`}>
      <BookOpen className={size === "lg" ? "size-12 text-primary" : "size-8 text-primary"} />
    </div>
  )
}

// ─── Star ─────────────────────────────────────────────────────────────────────

/** One tap adds the sign to "My signs", or takes it off again. */
function StarButton({ saved, word, onToggle, className }: {
  saved: boolean
  word: string
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${word} from my signs` : `Add ${word} to my signs`}
      title={saved ? "Remove from my signs" : "Add to my signs"}
      className={cn(
        "flex size-10 items-center justify-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <Star className={cn("size-5", saved ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DictionaryPage() {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [level, setLevel] = useState("all")
  const [page, setPage] = useState(1)
  const [selectedSign, setSelectedSign] = useState<Sign | null>(null)
  // "All signs" or "My signs" — the ones this student starred.
  const [tab, setTab] = useState<"all" | "mine">("all")

  const debouncedQuery = useDebounce(query)

  const url = buildUrl(debouncedQuery, category, level, page, tab === "mine")
  const { data, loading, mutate } = useFetch<DictionaryData>(url, {
    errorMessage: "Could not load dictionary",
  })
  const savedCount = data?.savedCount ?? 0

  // The star changes straight away; it goes back if the server says no. An
  // unstarred sign stays on "My signs" until the list is next loaded, so a
  // slip of the thumb can be undone where it happened.
  function setStar(sign: Sign, saved: boolean) {
    const apply = (value: boolean) => {
      mutate((d) => d && {
        ...d,
        signs: d.signs.map((s) => (s.id === sign.id ? { ...s, saved: value } : s)),
        savedCount: (d.savedCount ?? 0) + (value ? 1 : -1),
      })
      setSelectedSign((s) => (s?.id === sign.id ? { ...s, saved: value } : s))
    }
    apply(saved)
    fetch(`/api/dictionary/${sign.id}/save`, { method: saved ? "POST" : "DELETE" })
      .then((res) => { if (!res.ok) throw new Error() })
      .catch(() => {
        apply(!saved)
        toast.error(saved ? "Could not add the sign to your list" : "Could not take the sign off your list")
      })
  }

  function handleTabChange(value: string) {
    setTab(value === "mine" ? "mine" : "all")
    setPage(1)
  }

  function handleCategoryChange(value: string) {
    setCategory(value)
    setPage(1)
  }

  function handleLevelChange(value: string) {
    setLevel(value)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Library className="size-6 text-primary" />
            BSL Dictionary
          </h1>
          <p className="text-muted-foreground mt-1">
            Search and learn British Sign Language signs.
          </p>
        </div>
        <Button asChild className="sm:self-auto">
          <Link href="/student/dictionary/this-week">
            <CalendarDays className="size-4 mr-1.5" /> Practise this week&apos;s signs
          </Link>
        </Button>
      </div>

      {/* All signs / My signs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="all">All signs</TabsTrigger>
            <TabsTrigger value="mine" className="gap-1.5">
              <Star className="size-3.5" /> My signs{savedCount > 0 ? ` (${savedCount})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "mine" && savedCount > 0 && (
          <Button variant="outline" asChild>
            <Link href="/student/dictionary/flashcards">
              <Layers className="size-4 mr-1.5" /> Practise
            </Link>
          </Button>
        )}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search signs, categories..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2">
          <Select value={category} onValueChange={handleCategoryChange}>
            <SelectTrigger className="w-40">
              <Filter className="size-3.5 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {data?.categories.map((c) => (
                <SelectItem key={c} value={c.toLowerCase()}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={level} onValueChange={handleLevelChange}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {COURSE_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results count */}
      {!loading && data && (
        <p className="text-sm text-muted-foreground -mt-2">
          {data.total} sign{data.total !== 1 ? "s" : ""} found
          {debouncedQuery ? ` for "${debouncedQuery}"` : ""}
        </p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data?.signs.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {data.signs.map((sign) => (
            <div key={sign.id} className="relative">
              <button
                onClick={() => setSelectedSign(sign)}
                className="group w-full h-full text-left rounded-2xl border bg-background hover:border-primary hover:shadow-md transition-all overflow-hidden"
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-primary/10 overflow-hidden group-hover:opacity-90 transition-opacity">
                  <SignThumbnail sign={sign} />
                </div>

                <div className="p-3">
                  <p className="font-bold text-sm leading-snug">{sign.word}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{sign.category}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {sign.showLevel !== false && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-4 px-1.5 ${levelColor[sign.level]}`}
                      >
                        {sign.level}
                      </Badge>
                    )}
                    {sign.videoUrl && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-1 bg-violet-50 text-violet-700 border-violet-200">
                        <PlayCircle className="size-2.5" /> Video
                      </Badge>
                    )}
                    {!sign.videoUrl && sign.imageUrl && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-1 bg-sky-50 text-sky-700 border-sky-200">
                        <ImageIcon className="size-2.5" /> Image
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
              <StarButton
                saved={!!sign.saved}
                word={sign.word}
                onToggle={() => setStar(sign, !sign.saved)}
                className="absolute top-1.5 right-1.5 bg-background/90 shadow-sm hover:bg-background"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 text-center">
          <div className="rounded-full bg-muted p-6">
            <Search className="size-8 text-muted-foreground" />
          </div>
          {tab === "mine" && !debouncedQuery && category === "all" && level === "all" ? (
            <div>
              <p className="font-semibold">No signs in your list yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                Tap the <Star className="inline size-3.5 -mt-0.5" /> on any sign to add it here, then practise them with flashcards.
              </p>
            </div>
          ) : (
            <div>
              <p className="font-semibold">No signs found</p>
              <p className="text-sm text-muted-foreground mt-1">Try adjusting your search or filters.</p>
            </div>
          )}
          {(debouncedQuery || category !== "all" || level !== "all") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("")
                setCategory("all")
                setLevel("all")
                setPage(1)
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} />
      )}

      {/* Sign detail dialog */}
      <Dialog open={!!selectedSign} onOpenChange={(isOpen) => !isOpen && setSelectedSign(null)}>
        <DialogContent className="max-w-md max-h-[90vh]">
          <DialogHeader className="flex-row items-center gap-1 space-y-0 pr-8">
            <DialogTitle className="text-2xl font-black min-w-0 break-words">{selectedSign?.word}</DialogTitle>
            {selectedSign && (
              <StarButton
                saved={!!selectedSign.saved}
                word={selectedSign.word}
                onToggle={() => setStar(selectedSign, !selectedSign.saved)}
                className="shrink-0 hover:bg-muted"
              />
            )}
          </DialogHeader>

          {selectedSign && (
            <div className="space-y-4 overflow-y-auto -mx-1 px-1" style={{ maxHeight: "calc(90vh - 6rem)" }}>
              {/* Video or image */}
              <div className="rounded-xl overflow-hidden bg-primary/10">
                {selectedSign.videoUrl ? (
                  <ProtectedVideo
                    src={selectedSign.videoUrl}
                    controls
                    // Opening a word plays it straight away, over and over, so
                    // nobody has to press play — the way the flashcards work.
                    autoPlay
                    loop
                    playsInline
                    // Signs have no sound; this also silences any older upload that has some.
                    // (Muted is also what lets the browser start it by itself.)
                    muted
                    className="w-full rounded-xl max-h-[45vh] object-contain bg-black"
                    poster={selectedSign.imageUrl ?? undefined}
                  />
                ) : selectedSign.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedSign.imageUrl}
                    alt={selectedSign.word}
                    className="w-full rounded-xl object-contain max-h-[45vh] select-none pointer-events-none"
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                ) : (
                  <div className="aspect-video flex flex-col items-center justify-center gap-2 text-primary">
                    <PlayCircle className="size-12" />
                    <p className="text-xs font-medium">Media coming soon</p>
                  </div>
                )}
              </div>

              {/* Metadata */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{selectedSign.category}</Badge>
                {selectedSign.showLevel !== false && (
                  <Badge variant="outline" className={levelColor[selectedSign.level]}>
                    {selectedSign.level}
                  </Badge>
                )}
              </div>

              {/* Description */}
              {selectedSign.description && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">How to sign</p>
                  <p className="text-sm text-foreground leading-relaxed">{selectedSign.description}</p>
                </div>
              )}

              {/* Handshape */}
              {selectedSign.handshape && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Handshape</p>
                  <p className="text-sm">{selectedSign.handshape}</p>
                </div>
              )}

              {/* Usage */}
              {selectedSign.usage && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Usage example</p>
                  <p className="text-sm text-muted-foreground">{selectedSign.usage}</p>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setSelectedSign(null)}
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
