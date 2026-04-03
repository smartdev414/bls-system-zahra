"use client"

import { useState, useCallback } from "react"
import { Search, Library, PlayCircle, BookOpen, Loader2, Filter } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
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

// ─── Types ────────────────────────────────────────────────────────────────────

type Sign = {
  id: string
  word: string
  category: string
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
  description: string
  videoUrl: string | null
  imageUrl: string | null
  handshape: string
  usage: string
}

type DictionaryData = {
  signs: Sign[]
  total: number
  categories: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-100 text-emerald-700 border-emerald-200",
  INTERMEDIATE: "bg-amber-100 text-amber-700 border-amber-200",
  ADVANCED: "bg-rose-100 text-rose-700 border-rose-200",
}

function buildUrl(q: string, category: string, level: string) {
  const params = new URLSearchParams()
  if (q) params.set("q", q)
  if (category && category !== "all") params.set("category", category)
  if (level && level !== "all") params.set("level", level)
  return `/api/dictionary?${params.toString()}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DictionaryPage() {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [level, setLevel] = useState("all")
  const [selectedSign, setSelectedSign] = useState<Sign | null>(null)
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const url = buildUrl(debouncedQuery, category, level)
  const { data, loading } = useFetch<DictionaryData>(url, {
    errorMessage: "Could not load dictionary",
  })

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value)
      if (debounceTimer) clearTimeout(debounceTimer)
      const t = setTimeout(() => setDebouncedQuery(value), 350)
      setDebounceTimer(t)
    },
    [debounceTimer]
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Library className="size-6 text-primary" />
          BSL Dictionary
        </h1>
        <p className="text-muted-foreground mt-1">
          Search and learn British Sign Language signs.
        </p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search signs..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2">
          <Select value={category} onValueChange={setCategory}>
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

          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="BEGINNER">Beginner</SelectItem>
              <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
              <SelectItem value="ADVANCED">Advanced</SelectItem>
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
              className="group text-left rounded-2xl border bg-background p-4 hover:border-primary hover:shadow-md transition-all"
            >
              {/* Thumbnail placeholder */}
              <div className="aspect-square rounded-xl bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                {sign.videoUrl ? (
                  <PlayCircle className="size-8 text-primary" />
                ) : (
                  <BookOpen className="size-8 text-primary" />
                )}
              </div>

              <p className="font-bold text-sm leading-snug">{sign.word}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sign.category}</p>

              <div className="mt-2">
                <Badge
                  variant="outline"
                  className={`text-[10px] h-4 px-1.5 ${levelColor[sign.level]}`}
                >
                  {sign.level.charAt(0) + sign.level.slice(1).toLowerCase()}
                </Badge>
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
                setDebouncedQuery("")
                setCategory("all")
                setLevel("all")
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Sign detail dialog */}
      <Dialog open={!!selectedSign} onOpenChange={(isOpen: boolean) => !isOpen && setSelectedSign(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">{selectedSign?.word}</DialogTitle>
          </DialogHeader>

          {selectedSign && (
            <div className="space-y-4">
              {/* Video/image placeholder */}
              <div className="aspect-video rounded-xl bg-primary/10 flex items-center justify-center">
                {selectedSign.videoUrl ? (
                  <video src={selectedSign.videoUrl} controls className="w-full h-full rounded-xl" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <PlayCircle className="size-12" />
                    <p className="text-xs font-medium">Video coming soon</p>
                  </div>
                )}
              </div>

              {/* Metadata */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{selectedSign.category}</Badge>
                <Badge variant="outline" className={levelColor[selectedSign.level]}>
                  {selectedSign.level.charAt(0) + selectedSign.level.slice(1).toLowerCase()}
                </Badge>
              </div>

              {/* Description */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">How to sign</p>
                <p className="text-sm text-foreground leading-relaxed">{selectedSign.description}</p>
              </div>

              {/* Handshape */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Handshape</p>
                <p className="text-sm">{selectedSign.handshape}</p>
              </div>

              {/* Usage */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Usage</p>
                <p className="text-sm text-muted-foreground">{selectedSign.usage}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
