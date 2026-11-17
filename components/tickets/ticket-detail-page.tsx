"use client"

import { useState, use } from "react"
import Link from "next/link"
import {
  ArrowLeft, Bug, Sparkles, Lightbulb, HelpCircle, Clock, CheckCircle2,
  AlertCircle, Paperclip, Image, Video, FileText, Send, Trash2,
  ExternalLink, Loader2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useFetch, usePatchCallback, usePostCallback, useDeleteCallback } from "@/hooks/use-fetch"
import { format } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

type Attachment = {
  id: string
  fileUrl: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  createdAt: string
}

type Comment = {
  id: string
  content: string
  createdAt: string
  author: { id: string; name: string; role: string; avatarUrl: string | null }
}

type TicketDetail = {
  id: string
  title: string
  description: string
  type: "BUG" | "FEATURE" | "SUGGESTION" | "OTHER"
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  submitter: { id: string; name: string; email: string; role: string; avatarUrl: string | null }
  assignedTo: { id: string; name: string; email: string } | null
  attachments: Attachment[]
  comments: Comment[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  BUG:        { label: "Bug Report",   icon: Bug,        color: "bg-rose-50 text-rose-700 border-rose-200" },
  FEATURE:    { label: "Feature",      icon: Sparkles,   color: "bg-violet-50 text-violet-700 border-violet-200" },
  SUGGESTION: { label: "Suggestion",   icon: Lightbulb,  color: "bg-amber-50 text-amber-700 border-amber-200" },
  OTHER:      { label: "Other",        icon: HelpCircle, color: "bg-blue-50 text-blue-700 border-blue-200" },
}

const STATUS_CONFIG = {
  OPEN:        { label: "Open",        icon: AlertCircle,  color: "bg-rose-50 text-rose-700 border-rose-200" },
  IN_PROGRESS: { label: "In Progress", icon: Clock,        color: "bg-amber-50 text-amber-700 border-amber-200" },
  RESOLVED:    { label: "Resolved",    icon: CheckCircle2, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CLOSED:      { label: "Closed",      icon: CheckCircle2, color: "bg-muted text-muted-foreground" },
}

const PRIORITY_CONFIG = {
  LOW:    { label: "Low",    color: "bg-muted text-muted-foreground" },
  MEDIUM: { label: "Medium", color: "bg-blue-50 text-blue-700 border-blue-200" },
  HIGH:   { label: "High",   color: "bg-amber-50 text-amber-700 border-amber-200" },
  URGENT: { label: "Urgent", color: "bg-rose-50 text-rose-700 border-rose-200" },
}

function fileIcon(mimeType: string | null) {
  if (!mimeType) return FileText
  if (mimeType.startsWith("video/")) return Video
  if (mimeType.startsWith("image/")) return Image
  return FileText
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Comment ──────────────────────────────────────────────────────────────────

function CommentItem({
  comment,
  onDelete,
}: {
  comment: Comment
  onDelete: (id: string) => void
}) {
  const initials = comment.author.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
  const isAdmin = comment.author.role === "ADMIN"

  return (
    <div className="flex gap-3">
      <Avatar className="size-7 shrink-0 mt-0.5">
        <AvatarFallback className={`text-[0.625rem] font-bold ${isAdmin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold">{comment.author.name}</span>
          {isAdmin && (
            <Badge variant="outline" className="text-[0.5625rem] h-4 px-1.5 bg-primary/10 text-primary border-primary/20">
              Admin
            </Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {format(new Date(comment.createdAt), "dd MMM, HH:mm")}
          </span>
          <button
            onClick={() => onDelete(comment.id)}
            className="text-muted-foreground hover:text-destructive transition-colors"
            title="Delete comment"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{comment.content}</p>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function TicketDetail({
  params,
  basePath = "/admin",
}: {
  params: Promise<{ id: string }>
  basePath?: string
}) {
  const { id } = use(params)
  const [newComment, setNewComment] = useState("")

  const { data, loading, refetch } = useFetch<{ ticket: TicketDetail }>(
    `/api/tickets/${id}`,
    { errorMessage: "Could not load ticket" },
  )

  const { execute: updateTicket, loading: updating } = usePatchCallback<{ ticket: TicketDetail }, unknown>(
    `/api/tickets/${id}`,
    { successMessage: "Ticket updated", onSuccess: () => refetch() },
  )

  const { execute: addComment, loading: commenting } = usePostCallback<{ comment: Comment }, { content: string }>(
    `/api/tickets/${id}/comments`,
    {
      successMessage: false,
      onSuccess: () => { setNewComment(""); refetch() },
    },
  )

  const { execute: deleteComment } = useDeleteCallback(
    `/api/tickets/${id}/comments/placeholder`,
    { successMessage: false, onSuccess: () => refetch() },
  )

  async function handleDeleteComment(cid: string) {
    const res = await fetch(`/api/tickets/${id}/comments/${cid}`, { method: "DELETE" })
    if (res.ok) refetch()
  }

  const ticket = data?.ticket
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!ticket) return null

  const type = TYPE_CONFIG[ticket.type]
  const status = STATUS_CONFIG[ticket.status]
  const priority = PRIORITY_CONFIG[ticket.priority]
  const TypeIcon = type.icon
  const StatusIcon = status.icon
  const initials = ticket.submitter.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Back */}
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href={`${basePath}/tickets`}><ArrowLeft className="size-4" /> All Tickets</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: main content */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Ticket header */}
          <Card className="shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className={`rounded-xl border p-2.5 shrink-0 ${type.color}`}>
                  <TypeIcon className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-black tracking-tight leading-tight">{ticket.title}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Badge variant="outline" className={`text-xs gap-1 ${type.color}`}>
                      <TypeIcon className="size-3" />{type.label}
                    </Badge>
                    <Badge variant="outline" className={`text-xs gap-1 ${status.color}`}>
                      <StatusIcon className="size-3" />{status.label}
                    </Badge>
                    <Badge variant="outline" className={`text-xs ${priority.color}`}>
                      {priority.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {format(new Date(ticket.createdAt), "dd MMM yyyy, HH:mm")}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                {ticket.description}
              </p>
            </CardContent>
          </Card>

          {/* Attachments */}
          {ticket.attachments.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-3 pt-4 px-5">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Paperclip className="size-4 text-primary" /> Attachments ({ticket.attachments.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ticket.attachments.map((a) => {
                    const Icon = fileIcon(a.mimeType)
                    const isImage = a.mimeType?.startsWith("image/")
                    return (
                      <a
                        key={a.id}
                        href={a.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 hover:border-primary hover:bg-primary/5 transition-all group"
                      >
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.fileUrl}
                            alt={a.fileName}
                            className="size-8 object-cover rounded shrink-0"
                          />
                        ) : (
                          <div className="size-8 rounded bg-muted flex items-center justify-center shrink-0">
                            <Icon className="size-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{a.fileName}</p>
                          {a.fileSize && <p className="text-[0.625rem] text-muted-foreground">{formatBytes(a.fileSize)}</p>}
                        </div>
                        <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                      </a>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-sm flex items-center gap-2">
                <Send className="size-4 text-primary" /> Comments ({ticket.comments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-0 flex flex-col gap-4">
              {ticket.comments.length > 0 && (
                <div className="flex flex-col gap-4">
                  {ticket.comments.map((c) => (
                    <CommentItem key={c.id} comment={c} onDelete={handleDeleteComment} />
                  ))}
                </div>
              )}

              {ticket.comments.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No comments yet.</p>
              )}

              <div className="border-t pt-4 flex flex-col gap-2">
                <Textarea
                  placeholder="Add a comment or response to the submitter…"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  rows={3}
                  className="resize-none text-sm"
                />
                <Button
                  size="sm"
                  className="self-end gap-1.5"
                  disabled={!newComment.trim() || commenting}
                  onClick={() => addComment({ content: newComment })}
                >
                  {commenting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  Post Comment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: sidebar */}
        <div className="flex flex-col gap-4">
          {/* Submitter */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Submitted By</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="flex items-center gap-2.5">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{ticket.submitter.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{ticket.submitter.email}</p>
                  <Badge variant="outline" className="text-[0.5625rem] h-4 px-1.5 mt-0.5 capitalize">
                    {ticket.submitter.role.toLowerCase()}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Manage */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Manage Ticket</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select
                  defaultValue={ticket.status}
                  onValueChange={(v) => updateTicket({ status: v })}
                  disabled={updating}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Priority</label>
                <Select
                  defaultValue={ticket.priority}
                  onValueChange={(v) => updateTicket({ priority: v })}
                  disabled={updating}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {ticket.resolvedAt && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
                  Resolved {format(new Date(ticket.resolvedAt), "dd MMM yyyy")}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Created</span>
                <span className="text-foreground">{format(new Date(ticket.createdAt), "dd MMM yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span>Updated</span>
                <span className="text-foreground">{format(new Date(ticket.updatedAt), "dd MMM yyyy")}</span>
              </div>
              {ticket.resolvedAt && (
                <div className="flex justify-between">
                  <span>Resolved</span>
                  <span className="text-emerald-600 font-medium">{format(new Date(ticket.resolvedAt), "dd MMM yyyy")}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
