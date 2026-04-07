"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Award, Plus, Loader2, BookOpen, Users, CheckCircle2,
  MoreHorizontal, Pencil, Trash2, Archive, Eye,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFetch, usePostCallback } from "@/hooks/use-fetch"
import { toast } from "sonner"

type Program = {
  id: string
  title: string
  description: string | null
  level: string
  status: string
  price: number
  imageUrl: string | null
  stepCount: number
  enrollmentCount: number
  completedCount: number
  createdAt: string
}

type ProgramsData = { programs: Program[] }

const statusColor: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 border-amber-200",
  PUBLISHED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  ARCHIVED: "bg-muted text-muted-foreground",
}

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-50 text-emerald-700",
  INTERMEDIATE: "bg-amber-50 text-amber-700",
  ADVANCED: "bg-rose-50 text-rose-700",
}

export default function AdminCertificationsPage() {
  const { data, loading, refetch } = useFetch<ProgramsData>("/api/admin/certifications", {
    errorMessage: "Could not load certifications",
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [level, setLevel] = useState("BEGINNER")
  const [price, setPrice] = useState("0")

  const { execute: createProgram, loading: creating } = usePostCallback<
    { program: Program },
    object
  >("/api/admin/certifications", {
    successMessage: "Certification created",
    errorMessage: "Could not create certification",
    onSuccess: () => { setCreateOpen(false); setTitle(""); setDescription(""); refetch() },
  })

  async function handleStatusChange(id: string, status: string) {
    const res = await fetch(`/api/admin/certifications/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (res.ok) { refetch(); toast.success(`Status updated to ${status.toLowerCase()}`) }
    else toast.error("Could not update status")
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/certifications/${id}`, { method: "DELETE" })
    if (res.ok) { refetch(); toast.success("Deleted") }
    else {
      const err = await res.json() as { message?: string }
      toast.error(err.message ?? "Could not delete")
    }
  }

  const programs = data?.programs ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Award className="size-6 text-primary" /> Certifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Create and manage certification programs</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="size-4" /> New Program
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : programs.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <Card key={p.id} className="overflow-hidden border-0 bg-card">
              <CardContent className="p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={`text-[10px] ${statusColor[p.status]}`}>
                        {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                      </Badge>
                      <Badge variant="secondary" className={`text-[10px] ${levelColor[p.level]}`}>
                        {p.level.charAt(0) + p.level.slice(1).toLowerCase()}
                      </Badge>
                    </div>
                    <Link href={`/admin/certifications/${p.id}`} className="font-bold text-sm hover:text-primary transition-colors">
                      {p.title}
                    </Link>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7 shrink-0">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/certifications/${p.id}`}><Pencil className="size-3.5 mr-2" /> Edit</Link>
                      </DropdownMenuItem>
                      {p.status === "DRAFT" && (
                        <DropdownMenuItem onClick={() => handleStatusChange(p.id, "PUBLISHED")}>
                          <Eye className="size-3.5 mr-2" /> Publish
                        </DropdownMenuItem>
                      )}
                      {p.status === "PUBLISHED" && (
                        <DropdownMenuItem onClick={() => handleStatusChange(p.id, "ARCHIVED")}>
                          <Archive className="size-3.5 mr-2" /> Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="size-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {p.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                )}

                <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-2 border-t">
                  <span className="flex items-center gap-1"><BookOpen className="size-3" /> {p.stepCount} steps</span>
                  <span className="flex items-center gap-1"><Users className="size-3" /> {p.enrollmentCount} enrolled</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="size-3" /> {p.completedCount} completed</span>
                </div>

                {p.price > 0 && (
                  <p className="text-xs font-bold text-primary">£{(p.price / 100).toFixed(2)}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="rounded-full bg-muted p-5 mb-4">
            <Award className="size-8 text-muted-foreground" />
          </div>
          <p className="font-semibold">No certification programs yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create your first program to start issuing certificates.</p>
          <Button className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Create Program
          </Button>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Certification Program</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createProgram({ title, description, level, price: Math.round(parseFloat(price) * 100) || 0 })
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="BSL Level 1 Workplace Communication" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Prove your ability to communicate using BSL in a professional environment." rows={3} className="resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Level</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BEGINNER">Beginner</SelectItem>
                    <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
                    <SelectItem value="ADVANCED">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Price (£)</Label>
                <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <Button type="submit" disabled={creating || !title.trim()}>
              {creating ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Plus className="size-4 mr-1.5" />}
              {creating ? "Creating..." : "Create Program"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
