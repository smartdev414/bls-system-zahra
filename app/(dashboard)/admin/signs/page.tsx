"use client"

import { useState } from "react"
import { useRememberedState } from "@/hooks/use-remembered-state"
import Link from "next/link"
import {
  Library, Plus, Pencil, Trash2, Loader2, ListPlus, Camera, Upload,
  Search, Filter, Video, Check, X, Database, Image as ImageIcon, PlayCircle, Tags,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload"
import { CameraRecorder } from "@/components/ui/camera-recorder"
import { cn } from "@/lib/utils"
import { useFetch, usePostCallback, usePatchCallback, useDeleteCallback } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { Pagination } from "@/components/ui/pagination"
import { COURSE_LEVELS, levelColor, type CourseLevel } from "@/lib/levels"
import { VideoCleanBadge } from "@/components/ui/video-clean-badge"
import { ProtectedVideo } from "@/components/ui/protected-video"

// ─── Types ────────────────────────────────────────────────────────────────────

type Sign = {
  id: string
  word: string
  category: string
  level: CourseLevel
  description: string
  handshape: string
  usage: string
  showLevel: boolean
  showHandshape: boolean
  showUsage: boolean
  videoUrl: string | null
  imageUrl: string | null
  // What students wrote when asking for this sign.
  studentContext?: string
}

type SignsData = { signs: Sign[]; total: number; totalPages: number; page: number; categories: string[] }

const blank = (): Omit<Sign, "id"> => ({
  word: "", category: "", level: "L1", description: "",
  handshape: "", usage: "", videoUrl: null, imageUrl: null,
  showLevel: true, showHandshape: true, showUsage: true,
})

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSignsPage() {
  const [query, setQuery] = useRememberedState("query", "")
  const [categoryFilter, setCategoryFilter] = useRememberedState("categoryFilter", "all")
  const [levelFilter, setLevelFilter] = useRememberedState("levelFilter", "all")
  const [page, setPage] = useRememberedState("page", 1)
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [form, setForm] = useState(blank())

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)
  if (categoryFilter !== "all") params.set("category", categoryFilter)
  if (levelFilter !== "all") params.set("level", levelFilter)
  params.set("page", String(page))

  const { data, loading, refetch } = useFetch<SignsData>(`/api/admin/signs?${params.toString()}`, {
    errorMessage: "Could not load signs",
  })

  // Words students asked for, waiting at the top of Record videos.
  const { data: requestData } = useFetch<{ open: number }>("/api/admin/sign-requests")
  const openRequests = requestData?.open ?? 0

  const { execute: create, loading: creating } = usePostCallback<{ sign: Sign }, Omit<Sign, "id">>(
    "/api/admin/signs",
    {
      successMessage: "Sign added",
      errorMessage: "Could not add sign",
      onSuccess: () => { setCreateOpen(false); setForm(blank()); refetch() },
    }
  )

  const { execute: seed, loading: seeding } = usePostCallback<{ message: string }, Record<never, never>>(
    "/api/admin/signs/seed",
    {
      successMessage: (d) => (d as { message: string }).message,
      errorMessage: "Could not seed dictionary",
      onSuccess: () => refetch(),
    }
  )

  // Only a dictionary with no signs at all offers the starter set — not a
  // search or filter that happens to match nothing.
  const emptyDictionary = !debouncedQuery && categoryFilter === "all" && levelFilter === "all" && data?.total === 0

  function handleCategoryChange(value: string) {
    setCategoryFilter(value)
    setPage(1)
  }

  function handleLevelChange(value: string) {
    setLevelFilter(value)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Library className="size-6 text-primary" /> BSL Dictionary
          </h1>
          <p className="text-muted-foreground mt-1">
            {loading ? "\u00A0" : `${data?.total ?? 0} sign${data?.total !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {emptyDictionary && (
            <Button variant="outline" disabled={seeding} onClick={() => seed({})}>
              <Database className="size-4 mr-1.5" />
              {seeding ? "Seeding..." : "Seed defaults"}
            </Button>
          )}
          <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
            <Tags className="size-4 mr-1.5" /> Categories
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/signs/record">
              <Video className="size-4 mr-1.5" /> Record videos
              {openRequests > 0 && (
                <Badge className="ml-1.5 h-5 bg-amber-500 px-1.5 text-[11px] hover:bg-amber-500">
                  {openRequests} asked for
                </Badge>
              )}
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <ListPlus className="size-4 mr-1.5" /> Bulk add
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1.5" /> Add Sign
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search signs..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-44">
            <Filter className="size-3.5 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {data?.categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={levelFilter} onValueChange={handleLevelChange}>
          <SelectTrigger className="w-40">
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

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data?.signs.length ? (
        <div className="flex flex-col gap-2">
          {data.signs.map((sign) => (
            <SignRow key={sign.id} sign={sign} categories={data.categories} onMutated={refetch} />
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Library className="size-10 text-muted-foreground" />
            <p className="font-semibold">No signs found</p>
            {emptyDictionary ? (
              <p className="text-sm text-muted-foreground">Click &quot;Seed defaults&quot; to load the starter dictionary.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Try adjusting your filters.</p>
            )}
          </CardContent>
        </Card>
      )}

      {data && data.totalPages > 1 && (
        <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} className="mt-2" />
      )}

      {/* Create dialog */}
      <SignDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setForm(blank()) }}
        title="Add Sign"
        form={form}
        setForm={setForm}
        onSubmit={() => create(form)}
        loading={creating}
        categories={data?.categories ?? []}
      />

      <BulkAddDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        categories={data?.categories ?? []}
        onAdded={refetch}
      />

      {/* Mounted only while open so the counts are fresh each time. */}
      {categoriesOpen && (
        <CategoriesDialog
          onClose={() => setCategoriesOpen(false)}
          onChanged={(from) => {
            // The filtered category may no longer exist.
            if (categoryFilter === from) handleCategoryChange("all")
            else refetch()
          }}
        />
      )}
    </div>
  )
}

// ─── Categories dialog ────────────────────────────────────────────────────────

type CategoryCount = { name: string; count: number }

function CategoriesDialog({
  onClose, onChanged,
}: {
  onClose: () => void
  onChanged: (from: string) => void
}) {
  const { data, loading, refetch } = useFetch<{ categories: CategoryCount[] }>(
    "/api/admin/signs/categories",
    { errorMessage: "Could not load categories" }
  )
  const categories = data?.categories ?? []

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Rename a category, or give it the name of another one to merge them.
          Deleting a category moves its signs into another one.
        </p>
        {loading && !data ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col divide-y border rounded-lg">
            {categories.map((c) => (
              <CategoryRow
                key={c.name}
                category={c}
                others={categories.filter((o) => o.name !== c.name).map((o) => o.name)}
                onChanged={() => { refetch(); onChanged(c.name) }}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CategoryRow({
  category, others, onChanged,
}: {
  category: CategoryCount
  others: string[]
  onChanged: () => void
}) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view")
  const [name, setName] = useState(category.name)
  const [target, setTarget] = useState("")

  const { execute: move, loading } = usePatchCallback<
    { updated: number; to: string; merged: boolean },
    { from: string; to: string }
  >("/api/admin/signs/categories", {
    successMessage: (d) =>
      mode === "delete"
        ? `"${category.name}" deleted · ${d.updated} sign${d.updated !== 1 ? "s" : ""} moved to "${d.to}"`
        : d.merged
          ? `Merged into "${d.to}"`
          : `Renamed to "${d.to}"`,
    errorMessage: "Could not update the category",
    onSuccess: () => { setMode("view"); onChanged() },
  })

  const signs = `${category.count} sign${category.count !== 1 ? "s" : ""}`

  if (mode === "rename") {
    const trimmed = name.trim()
    const mergeInto = others.find((o) => o.toLowerCase() === trimmed.toLowerCase())
    const submit = () => { if (trimmed && trimmed !== category.name) move({ from: category.name, to: trimmed }) }
    return (
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm flex-1"
            autoFocus
            list="sign-category-names"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
              if (e.key === "Escape") { setMode("view"); setName(category.name) }
            }}
          />
          <datalist id="sign-category-names">
            {others.map((o) => <option key={o} value={o} />)}
          </datalist>
          <Button size="icon" className="size-8" disabled={loading || !trimmed || trimmed === category.name} onClick={submit}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="size-8" onClick={() => { setMode("view"); setName(category.name) }}>
            <X className="size-3.5" />
          </Button>
        </div>
        {mergeInto && (
          <p className="text-xs text-muted-foreground">
            {signs} will be merged into <span className="font-medium text-foreground">{mergeInto}</span>.
          </p>
        )}
      </div>
    )
  }

  if (mode === "delete") {
    return (
      <div className="flex flex-col gap-2 px-3 py-2.5 bg-destructive/5">
        <p className="text-sm">
          Delete <span className="font-medium">{category.name}</span> and move its {signs} to:
        </p>
        <div className="flex items-center gap-2">
          {/* Opens straight away: the bin alone looked like it did nothing until a category was picked. */}
          <Select value={target} onValueChange={setTarget} defaultOpen>
            <SelectTrigger className="h-8 text-sm flex-1 bg-background"><SelectValue placeholder="Choose a category" /></SelectTrigger>
            <SelectContent position="popper">
              {others.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 bg-destructive text-white hover:bg-destructive/90"
            disabled={!target || loading}
            onClick={() => move({ from: category.name, to: target })}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : "Delete"}
          </Button>
          <Button size="icon" variant="ghost" className="size-8" onClick={() => { setMode("view"); setTarget("") }}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-sm font-medium flex-1 min-w-0 truncate">{category.name}</span>
      <span className="text-xs text-muted-foreground shrink-0">{signs}</span>
      <Button size="icon" variant="ghost" className="size-8" title="Rename or merge" onClick={() => setMode("rename")}>
        <Pencil className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 text-destructive hover:text-destructive"
        title="Delete"
        disabled={!others.length}
        onClick={() => setMode("delete")}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

// ─── Bulk add dialog ──────────────────────────────────────────────────────────

function BulkAddDialog({
  open, onClose, categories, onAdded,
}: {
  open: boolean
  onClose: () => void
  categories: string[]
  onAdded: () => void
}) {
  const [text, setText] = useState("")
  const [category, setCategory] = useState("")
  const [level, setLevel] = useState<CourseLevel>("L1")
  // Most dictionary words fit any level, so the level is hidden from students unless ticked.
  const [showLevel, setShowLevel] = useState(false)

  const words = text.split("\n").map((w) => w.trim()).filter(Boolean)

  const { execute: add, loading } = usePostCallback<
    { created: number; skipped: number },
    { words: string[]; category: string; level: CourseLevel; showLevel: boolean }
  >("/api/admin/signs/bulk", {
    successMessage: (d) =>
      `${d.created} sign${d.created !== 1 ? "s" : ""} added` +
      (d.skipped ? `, ${d.skipped} already in the dictionary` : ""),
    errorMessage: "Could not add the signs",
    // Category, level and its tick box are kept: the next list is usually another batch of the same.
    onSuccess: () => { setText(""); onClose(); onAdded() },
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk add signs</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">
            Paste a list of words, one per line. They are added without a video, ready to be
            recorded one after another under <span className="font-medium text-foreground">Record videos</span>.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Category *</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Greetings"
                list="bulk-sign-categories"
              />
              <datalist id="bulk-sign-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel label="Level *" shown={showLevel} onShownChange={setShowLevel} />
              <Select value={level} onValueChange={(v) => setLevel(v as CourseLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COURSE_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Words *</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Hello\nThank you\nPlease"}
              rows={10}
              className="max-h-[40vh]"
            />
            <p className="text-xs text-muted-foreground">
              {words.length} word{words.length !== 1 ? "s" : ""} · words already in the dictionary are left as they are
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="size-4 mr-1.5" /> Cancel
          </Button>
          <Button
            disabled={!words.length || !category.trim() || loading}
            onClick={() => add({ words, category: category.trim(), level, showLevel })}
          >
            {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Check className="size-4 mr-1.5" />}
            {loading ? "Adding..." : `Add ${words.length || ""} sign${words.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Sign row ─────────────────────────────────────────────────────────────────

function SignRow({ sign, categories, onMutated }: { sign: Sign; categories: string[]; onMutated: () => void }) {
  const [editOpen, setEditOpen] = useState(false)
  const [playOpen, setPlayOpen] = useState(false)
  const [form, setForm] = useState<Omit<Sign, "id">>({ ...sign })

  const { execute: update, loading: updating } = usePatchCallback<{ sign: Sign }, Partial<Sign>>(
    `/api/admin/signs/${sign.id}`,
    {
      successMessage: "Sign updated",
      errorMessage: "Could not update sign",
      onSuccess: () => { setEditOpen(false); onMutated() },
    }
  )

  const { execute: remove, loading: removing } = useDeleteCallback(
    `/api/admin/signs/${sign.id}`,
    {
      successMessage: "Sign deleted",
      errorMessage: "Could not delete sign",
      onSuccess: () => onMutated(),
    }
  )

  return (
    <>
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            {/* Thumbnail */}
            {sign.videoUrl ? (
              <button
                type="button"
                onClick={() => setPlayOpen(true)}
                aria-label={`Play video for ${sign.word}`}
                title="Play video"
                className="group relative shrink-0 size-12 rounded-lg bg-primary/10 overflow-hidden flex items-center justify-center cursor-pointer transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {sign.imageUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sign.imageUrl} alt={sign.word} className="size-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <PlayCircle className="size-5 text-white" />
                    </span>
                  </>
                ) : (
                  <PlayCircle className="size-5 text-primary transition-transform group-hover:scale-110" />
                )}
              </button>
            ) : (
              <div className="shrink-0 size-12 rounded-lg bg-primary/10 overflow-hidden flex items-center justify-center">
                {sign.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sign.imageUrl} alt={sign.word} className="size-full object-cover" />
                ) : (
                  <Library className="size-5 text-primary" />
                )}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <p className="font-semibold">{sign.word}</p>
                <Badge variant="outline" className={`text-[10px] ${levelColor[sign.level]}`}>
                  {sign.level}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">{sign.category}</Badge>
                {sign.videoUrl && (
                  <Badge variant="outline" className="text-[10px] gap-1 bg-violet-50 text-violet-700 border-violet-200">
                    <Video className="size-2.5" /> Video
                  </Badge>
                )}
                <VideoCleanBadge url={sign.videoUrl} />
                {sign.imageUrl && (
                  <Badge variant="outline" className="text-[10px] gap-1 bg-sky-50 text-sky-700 border-sky-200">
                    <ImageIcon className="size-2.5" /> Image
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1">{sign.description}</p>
              {sign.handshape && (
                <p className="text-xs text-muted-foreground mt-0.5">Handshape: {sign.handshape}</p>
              )}
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="icon" variant="ghost" className="size-8"
                onClick={() => {
                  // Not saved until the admin has read it: students see the description.
                  setForm({ ...sign, description: sign.description || (sign.studentContext ?? "") })
                  setEditOpen(true)
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon" variant="ghost"
                className="size-8 text-destructive hover:text-destructive"
                disabled={removing}
                onClick={() => remove()}
              >
                {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {sign.videoUrl && (
        <Dialog open={playOpen} onOpenChange={setPlayOpen}>
          <DialogContent className="sm:max-w-xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="pr-8">{sign.word}</DialogTitle>
            </DialogHeader>
            <ProtectedVideo
              src={sign.videoUrl}
              controls
              autoPlay
              allowDownload
              className="w-full rounded-xl max-h-[65vh] object-contain bg-black"
              poster={sign.imageUrl ?? undefined}
            />
          </DialogContent>
        </Dialog>
      )}

      <SignDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Sign"
        form={form}
        setForm={setForm}
        onSubmit={() => update(form)}
        loading={updating}
        categories={categories}
        descriptionFromStudent={!sign.description && !!form.description && form.description === sign.studentContext}
      />
    </>
  )
}

// ─── Category picker ──────────────────────────────────────────────────────────

const NEW_CATEGORY = "__new__"

// A list of the existing categories, so a requested sign can be moved out of
// "Requested" in one click; "New category…" swaps in a box to type one.
function CategoryPicker({
  value, categories, onChange,
}: {
  value: string
  categories: string[]
  onChange: (v: string) => void
}) {
  const options = [...new Set([...categories, ...(value.trim() ? [value] : [])])]
    .sort((a, b) => a.localeCompare(b))
  const [typing, setTyping] = useState(options.length === 0)

  if (typing) {
    return (
      <div className="flex gap-1.5">
        <Input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Greetings"
        />
        {options.length > 0 && (
          <Button
            type="button" size="icon" variant="ghost" className="shrink-0"
            title="Pick from the list"
            onClick={() => { setTyping(false); if (!categories.includes(value)) onChange("") }}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => {
        if (v === NEW_CATEGORY) { onChange(""); setTyping(true) } else onChange(v)
      }}
    >
      <SelectTrigger><SelectValue placeholder="Choose a category" /></SelectTrigger>
      <SelectContent>
        {options.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        <SelectItem value={NEW_CATEGORY}>
          <span className="flex items-center gap-1.5"><Plus className="size-3.5" /> New category…</span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

// ─── Shared sign form dialog ──────────────────────────────────────────────────

function SignDialog({
  open, onClose, title, form, setForm, onSubmit, loading, categories, descriptionFromStudent,
}: {
  open: boolean
  onClose: () => void
  title: string
  form: Omit<Sign, "id">
  setForm: (f: Omit<Sign, "id">) => void
  onSubmit: () => void
  loading: boolean
  categories: string[]
  descriptionFromStudent?: boolean
}) {
  const set = (key: keyof Omit<Sign, "id">, value: string | boolean | null) =>
    setForm({ ...form, [key]: value })

  const [videoMode, setVideoMode] = useState<"upload" | "record">("upload")

  const valid = form.word.trim() && form.category.trim()

  // Track uploaded file objects so we can show the FileUpload "uploaded" state
  const videoUploaded: UploadedFile | null = form.videoUrl
    ? { fileUrl: form.videoUrl, fileName: form.videoUrl.split("/").pop() ?? "video", fileSize: 0, mimeType: "video/mp4", assetType: "VIDEO" }
    : null
  const imageUploaded: UploadedFile | null = form.imageUrl
    ? { fileUrl: form.imageUrl, fileName: form.imageUrl.split("/").pop() ?? "image", fileSize: 0, mimeType: "image/jpeg", assetType: "IMAGE" }
    : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {/* Core fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Word *</Label>
              <Input value={form.word} onChange={(e) => set("word", e.target.value)} placeholder="e.g. Hello" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Category *</Label>
              <CategoryPicker
                key={open ? "open" : "closed"}
                value={form.category}
                categories={categories}
                onChange={(v) => set("category", v)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel
                label="Level *"
                shown={form.showLevel}
                onShownChange={(v) => set("showLevel", v)}
              />
              <Select value={form.level} onValueChange={(v) => set("level", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COURSE_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel
                label="Handshape"
                shown={form.showHandshape}
                onShownChange={(v) => set("showHandshape", v)}
              />
              <Input value={form.handshape} onChange={(e) => set("handshape", e.target.value)} placeholder="e.g. Open hand" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="How to perform this sign"
              rows={3}
            />
            {descriptionFromStudent && (
              <p className="text-xs text-muted-foreground">Copied from what the student wrote. Correct it, then save.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel
              label="Usage"
              shown={form.showUsage}
              onShownChange={(v) => set("showUsage", v)}
            />
            <Input value={form.usage} onChange={(e) => set("usage", e.target.value)} placeholder="e.g. Used as a general greeting" />
          </div>

          {/* Video upload */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Sign Video (optional)</Label>
              {!videoUploaded && (
                <div className="flex rounded-lg border p-0.5">
                  {([
                    { mode: "upload", label: "Upload", icon: Upload },
                    { mode: "record", label: "Record", icon: Camera },
                  ] as const).map(({ mode, label, icon: Icon }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setVideoMode(mode)}
                      aria-pressed={videoMode === mode}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        videoMode === mode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="size-3.5" /> {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {videoMode === "record" && !videoUploaded ? (
              <CameraRecorder
                onUploaded={(f) => set("videoUrl", f.fileUrl)}
                disabled={loading}
                highDefinition
                silent
              />
            ) : (
              <FileUpload
                accept="video/mp4,video/webm,video/quicktime"
                label="Upload sign video"
                uploaded={videoUploaded}
                onUploaded={(f) => set("videoUrl", f.fileUrl)}
                onRemove={() => set("videoUrl", null)}
                disabled={loading}
              />
            )}
          </div>

          {/* Image upload */}
          <div className="flex flex-col gap-1.5">
            <Label>Sign Image (optional)</Label>
            <FileUpload
              accept="image/jpeg,image/png,image/webp"
              label="Upload sign image"
              uploaded={imageUploaded}
              onUploaded={(f) => set("imageUrl", f.fileUrl)}
              onRemove={() => set("imageUrl", null)}
              disabled={loading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="size-4 mr-1.5" /> Cancel
          </Button>
          <Button disabled={!valid || loading} onClick={onSubmit}>
            {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Check className="size-4 mr-1.5" />}
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// A field label with a "Students" tick box: unticked keeps the detail off the
// student dictionary while admins and tutors still see it. The tick box sits
// right beside its own label and names the field, so in two-column rows it
// can't be mistaken for the neighbouring field's.
function FieldLabel({
  label, shown, onShownChange,
}: {
  label: string
  shown: boolean
  onShownChange: (shown: boolean) => void
}) {
  const field = label.replace(/\s*\*$/, "").toLowerCase()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Label>{label}</Label>
      <label
        className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
        title={shown ? `Students can see the ${field}` : `The ${field} is hidden from students`}
      >
        <Checkbox checked={shown} onCheckedChange={(v) => onShownChange(v === true)} />
        Show {field} to students
      </label>
    </div>
  )
}
