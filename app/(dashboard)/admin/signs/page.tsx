"use client"

import { useState } from "react"
import {
  Library, Plus, Pencil, Trash2, Loader2,
  Search, Filter, Video, Check, X, Database,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { useFetch, usePostCallback, usePatchCallback, useDeleteCallback } from "@/hooks/use-fetch"

// ─── Types ────────────────────────────────────────────────────────────────────

type Sign = {
  id: string
  word: string
  category: string
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
  description: string
  handshape: string
  usage: string
  videoUrl: string | null
  imageUrl: string | null
}

type SignsData = { signs: Sign[]; total: number; categories: string[] }

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-100 text-emerald-700 border-emerald-200",
  INTERMEDIATE: "bg-amber-100 text-amber-700 border-amber-200",
  ADVANCED: "bg-rose-100 text-rose-700 border-rose-200",
}

const blank = (): Omit<Sign, "id"> => ({
  word: "", category: "", level: "BEGINNER", description: "",
  handshape: "", usage: "", videoUrl: null, imageUrl: null,
})

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSignsPage() {
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(blank())

  const { data, loading, refetch } = useFetch<SignsData>("/api/admin/signs", {
    errorMessage: "Could not load signs",
  })

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

  const filtered = (data?.signs ?? []).filter((s) => {
    const matchQ = !query ||
      s.word.toLowerCase().includes(query.toLowerCase()) ||
      s.category.toLowerCase().includes(query.toLowerCase())
    const matchCat = categoryFilter === "all" || s.category === categoryFilter
    return matchQ && matchCat
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Library className="size-6 text-primary" /> BSL Dictionary
          </h1>
          <p className="text-muted-foreground mt-1">
            {loading ? "\u00A0" : `${data?.total ?? 0} signs in the dictionary`}
          </p>
        </div>
        <div className="flex gap-2">
          {data?.total === 0 && (
            <Button variant="outline" disabled={seeding} onClick={() => seed({})}>
              <Database className="size-4 mr-1.5" />
              {seeding ? "Seeding..." : "Seed defaults"}
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1.5" /> Add Sign
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search signs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
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
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="flex flex-col gap-2">
          {filtered.map((sign) => (
            <SignRow key={sign.id} sign={sign} onMutated={refetch} />
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Library className="size-10 text-muted-foreground" />
            <p className="font-semibold">No signs found</p>
            {data?.total === 0 && (
              <p className="text-sm text-muted-foreground">Click "Seed defaults" to load the starter dictionary.</p>
            )}
          </CardContent>
        </Card>
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
      />
    </div>
  )
}

// ─── Sign row ─────────────────────────────────────────────────────────────────

function SignRow({ sign, onMutated }: { sign: Sign; onMutated: () => void }) {
  const [editOpen, setEditOpen] = useState(false)
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
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <p className="font-semibold">{sign.word}</p>
                <Badge variant="outline" className={`text-[10px] ${levelColor[sign.level]}`}>
                  {sign.level.charAt(0) + sign.level.slice(1).toLowerCase()}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">{sign.category}</Badge>
                {sign.videoUrl && (
                  <Badge variant="outline" className="text-[10px] gap-1 bg-violet-50 text-violet-700 border-violet-200">
                    <Video className="size-2.5" /> Video
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1">{sign.description}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Handshape: {sign.handshape}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="icon" variant="ghost" className="size-8"
                onClick={() => { setForm({ ...sign }); setEditOpen(true) }}
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

      <SignDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Sign"
        form={form}
        setForm={setForm}
        onSubmit={() => update(form)}
        loading={updating}
      />
    </>
  )
}

// ─── Shared sign form dialog ──────────────────────────────────────────────────

function SignDialog({
  open, onClose, title, form, setForm, onSubmit, loading,
}: {
  open: boolean
  onClose: () => void
  title: string
  form: Omit<Sign, "id">
  setForm: (f: Omit<Sign, "id">) => void
  onSubmit: () => void
  loading: boolean
}) {
  const set = (key: keyof Omit<Sign, "id">, value: string | null) =>
    setForm({ ...form, [key]: value })

  const valid = form.word.trim() && form.category.trim() && form.description.trim() &&
    form.handshape.trim() && form.usage.trim()

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Word *</Label>
              <Input value={form.word} onChange={(e) => set("word", e.target.value)} placeholder="e.g. Hello" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Category *</Label>
              <Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Greetings" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Level *</Label>
              <Select value={form.level} onValueChange={(v) => set("level", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BEGINNER">Beginner</SelectItem>
                  <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
                  <SelectItem value="ADVANCED">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Handshape *</Label>
              <Input value={form.handshape} onChange={(e) => set("handshape", e.target.value)} placeholder="e.g. Open hand" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description *</Label>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="How to perform this sign"
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Usage *</Label>
            <Input value={form.usage} onChange={(e) => set("usage", e.target.value)} placeholder="e.g. Used as a general greeting" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Video URL (optional)</Label>
            <Input
              value={form.videoUrl ?? ""}
              onChange={(e) => set("videoUrl", e.target.value || null)}
              placeholder="https://..."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Image URL (optional)</Label>
            <Input
              value={form.imageUrl ?? ""}
              onChange={(e) => set("imageUrl", e.target.value || null)}
              placeholder="https://..."
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
