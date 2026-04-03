"use client"

import { useState } from "react"
import { Tag, Plus, Pencil, Trash2, Loader2, BookOpen, Check, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useFetch, usePostCallback, usePatchCallback, useDeleteCallback } from "@/hooks/use-fetch"

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = {
  id: string
  name: string
  slug: string
  courseCount: number
}

type CategoriesData = { categories: Category[] }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminCategoriesPage() {
  const [newName, setNewName] = useState("")

  const { data, loading, refetch } = useFetch<CategoriesData>("/api/admin/categories", {
    errorMessage: "Could not load categories",
  })

  const { execute: create, loading: creating } = usePostCallback<
    { category: Category },
    { name: string }
  >("/api/admin/categories", {
    successMessage: "Category created",
    errorMessage: "Could not create category",
    onSuccess: () => { setNewName(""); refetch() },
  })

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Tag className="size-6 text-primary" /> Categories
        </h1>
        <p className="text-muted-foreground mt-1">Organise courses into categories.</p>
      </div>

      {/* Create */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="size-4 text-primary" /> New Category
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create({ name: newName }) }}
            className="flex gap-2"
          >
            <Input
              placeholder="Category name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <><Plus className="size-4 mr-1.5" /> Add</>}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="size-4 text-primary" /> All Categories
            {data && (
              <Badge variant="secondary" className="ml-1">{data.categories.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-7 animate-spin text-primary" />
            </div>
          ) : data?.categories.length ? (
            <div className="divide-y">
              {data.categories.map((cat) => (
                <CategoryRow key={cat.id} category={cat} onMutated={refetch} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-10">
              No categories yet. Add one above.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Category row — owns its own mutation hooks ───────────────────────────────

function CategoryRow({ category, onMutated }: { category: Category; onMutated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(category.name)

  const { execute: rename, loading: renaming } = usePatchCallback<
    { category: Category },
    { name: string }
  >(`/api/admin/categories/${category.id}`, {
    successMessage: "Category renamed",
    errorMessage: "Could not rename category",
    onSuccess: () => { setEditing(false); onMutated() },
  })

  const { execute: remove, loading: removing } = useDeleteCallback(
    `/api/admin/categories/${category.id}`,
    {
      successMessage: "Category deleted",
      errorMessage: "Could not delete category",
      onSuccess: () => onMutated(),
    }
  )

  if (editing) {
    return (
      <div className="flex items-center gap-3 px-5 py-3">
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="flex-1 h-8 text-sm"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && editName.trim()) rename({ name: editName })
            if (e.key === "Escape") { setEditing(false); setEditName(category.name) }
          }}
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-emerald-600"
          disabled={renaming || !editName.trim()}
          onClick={() => rename({ name: editName })}
        >
          {renaming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => { setEditing(false); setEditName(category.name) }}
        >
          <X className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <div className="rounded-lg bg-primary/10 p-2 shrink-0">
        <Tag className="size-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{category.name}</p>
        <p className="text-xs text-muted-foreground">/{category.slug}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="secondary" className="gap-1 text-xs">
          <BookOpen className="size-3" /> {category.courseCount}
        </Badge>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => { setEditing(true); setEditName(category.name) }}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-destructive hover:text-destructive"
          disabled={removing || category.courseCount > 0}
          title={category.courseCount > 0 ? "Remove courses first" : "Delete"}
          onClick={() => remove()}
        >
          {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}
