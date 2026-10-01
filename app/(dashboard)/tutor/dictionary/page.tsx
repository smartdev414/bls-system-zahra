"use client"

import { useState } from "react"
import { Search, Library, PlayCircle, BookOpen, Loader2, Filter, Image as ImageIcon } from "lucide-react"
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
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { Pagination } from "@/components/ui/pagination"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { COURSE_LEVELS, levelColor, type CourseLevel } from "@/lib/levels"

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
}

type DictionaryData = {
  signs: Sign[]
  total: number
  totalPages: number
  page: number
  categories: string[]
}

function buildUrl(q: string, category: string, level: string, page: number) {
  const params = new URLSearchParams()
  if (q) params.set("q", q)
  if (category && category !== "all") params.set("category", category)
  if (level && level !== "all") params.set("level", level)
  params.set("page", String(page))
  return `/api/dictionary?${params.toString()}`
}

function SignThumbnail({ sign }: { sign: Sign }) {
  if (sign.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sign.imageUrl}
        alt={sign.word}
        className="size-full object-cover select-none pointer-events-none"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
      />
    )
  }
  return (
    <div className="size-full bg-primary/10 flex items-center justify-center">
      {sign.videoUrl
        ? <PlayCircle className="size-8 text-primary" />
        : <BookOpen className="size-8 text-primary" />
      }
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorDictionaryPage() {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [level, setLevel] = useState("all")
  const [page, setPage] = useState(1)
  const [selectedSign, setSelectedSign] = useState<Sign | null>(null)

  const debouncedQuery = useDebounce(query)

  const url = buildUrl(debouncedQuery, category, level, page)
  const { data, loading } = useFetch<DictionaryData>(url, {
    errorMessage: "Could not load dictionary",
  })

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
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Library className="size-6 text-primary" />
          BSL Dictionary
        </h1>
        <p className="text-muted-foreground mt-1">
          Reference library of British Sign Language signs. Use this alongside your lessons to verify signs.
        </p>
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
            <button
              key={sign.id}
              onClick={() => setSelectedSign(sign)}
              className="group text-left rounded-2xl border bg-background hover:border-primary hover:shadow-md transition-all overflow-hidden"
            >
              <div className="aspect-square overflow-hidden group-hover:opacity-90 transition-opacity">
                <SignThumbnail sign={sign} />
              </div>

              <div className="p-3">
                <p className="font-bold text-sm leading-snug">{sign.word}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{sign.category}</p>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-4 px-1.5 ${levelColor[sign.level]}`}
                  >
                    {sign.level}
                  </Badge>
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
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 text-center">
          <div className="rounded-full bg-muted p-6">
            <Search className="size-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">No signs found</p>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your search or filters.</p>
          </div>
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
          <DialogHeader>
            <DialogTitle className="text-2xl font-black pr-8">{selectedSign?.word}</DialogTitle>
          </DialogHeader>

          {selectedSign && (
            <div className="space-y-4 overflow-y-auto -mx-1 px-1" style={{ maxHeight: "calc(90vh - 6rem)" }}>
              {/* Video or image */}
              <div className="rounded-xl overflow-hidden bg-primary/10">
                {selectedSign.videoUrl ? (
                  <ProtectedVideo
                    src={selectedSign.videoUrl}
                    controls
                    allowDownload
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
                <Badge variant="outline" className={levelColor[selectedSign.level]}>
                  {selectedSign.level}
                </Badge>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">How to sign</p>
                <p className="text-sm text-foreground leading-relaxed">{selectedSign.description}</p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Handshape</p>
                <p className="text-sm">{selectedSign.handshape}</p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Usage example</p>
                <p className="text-sm text-muted-foreground">{selectedSign.usage}</p>
              </div>

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
