"use client"

import { useState, use, useEffect, useRef } from "react"
import Link from "next/link"
import {
  ArrowLeft, Bug, Sparkles, Lightbulb, HelpCircle, Clock, CheckCircle2,
  AlertCircle, Paperclip, Image, Video, FileText, Send, Loader2,
  ExternalLink, MessageSquare, Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useFetch, usePostCallback } from "@/hooks/use-fetch"
import { format } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

type Attachment = {
  id: string
  fileUrl: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
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
  submitter: { id: string; name: string }
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
  OPEN:        { label: "Open",        icon: AlertCircle,  color: "bg-rose-50 text-rose-700 border-rose-200",      step: 1 },
  IN_PROGRESS: { label: "In Progress", icon: Clock,        color: "bg-amber-50 text-amber-700 border-amber-200",   step: 2 },
  RESOLVED:    { label: "Resolved",    icon: CheckCircle2, color: "bg-emerald-50 text-emerald-700 border-emerald-200", step: 3 },
  CLOSED:      { label: "Closed",      icon: CheckCircle2, color: "bg-muted text-muted-foreground border-muted",   step: 4 },
}

const PRIORITY_COLORS = {
  LOW:    "bg-muted text-muted-foreground",
  MEDIUM: "bg-blue-50 text-blue-700 border-blue-200",
  HIGH:   "bg-amber-50 text-amber-700 border-amber-200",
  URGENT: "bg-rose-50 text-rose-700 border-rose-200",
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

// ─── Status tracker ───────────────────────────────────────────────────────────

function StatusTracker({ status }: { status: keyof typeof STATUS_CONFIG }) {
  const steps: Array<keyof typeof STATUS_CONFIG> = ["OPEN", "IN_PROGRESS", "RESOLVED"]
  const currentStep = STATUS_CONFIG[status].step
  const isClosed = status === "CLOSED"

  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => {
        const cfg = STATUS_CONFIG[s]
        const Icon = cfg.icon
        const done = currentStep > cfg.step
        const active = currentStep === cfg.step && !isClosed
        return (
          <div key={s} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`size-8 rounded-full flex items-center justify-center border-2 transition-all ${
                done    ? "bg-emerald-500 border-emerald-500 text-white" :
                active  ? "bg-primary border-primary text-primary-foreground" :
                          "bg-muted border-muted-foreground/20 text-muted-foreground"
              }`}>
                {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-3.5" />}
              </div>
              <span className={`text-[0.625rem] font-medium whitespace-nowrap ${active ? "text-primary" : done ? "text-emerald-600" : "text-muted-foreground"}`}>
                {cfg.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-12 sm:w-20 mb-4 mx-1 transition-all ${done ? "bg-emerald-400" : "bg-muted-foreground/15"}`} />
            )}
          </div>
        )
      })}
      {isClosed && (
        <div className="flex items-center gap-1 ml-3">
          <div className="size-8 rounded-full flex items-center justify-center border-2 bg-muted border-muted-foreground/20">
            <CheckCircle2 className="size-3.5 text-muted-foreground" />
          </div>
          <span className="text-[0.625rem] font-medium text-muted-foreground">Closed</span>
        </div>
      )}
    </div>
  )
}

// ─── Comment ──────────────────────────────────────────────────────────────────

function CommentBubble({ comment, isOwn }: { comment: Comment; isOwn: boolean }) {
  const isAdmin = comment.author.role === "ADMIN"
  const initials = comment.author.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

  return (
    <div className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}>
      <Avatar className="size-7 shrink-0 mt-0.5">
        <AvatarFallback className={`text-[0.625rem] font-bold ${isAdmin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className={`max-w-[80%] flex flex-col gap-1 ${isOwn ? "items-end" : "items-start"}`}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{isAdmin ? "Support Team" : comment.author.name}</span>
          {isAdmin && (
            <Badge variant="outline" className="text-[0.5625rem] h-4 px-1.5 bg-primary/10 text-primary border-primary/20">
              Admin
            </Badge>
          )}
          <span className="text-[0.625rem] text-muted-foreground">
            {format(new Date(comment.createdAt), "dd MMM, HH:mm")}
          </span>
        </div>
        <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isAdmin
            ? "bg-primary text-primary-foreground rounded-tl-sm"
            : "bg-muted text-foreground rounded-tr-sm"
        }`}>
          {comment.content}
        </div>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  params: Promise<{ id: string }>
  /** e.g. "/student/tickets" or "/tutor/tickets" */
  basePath: string
  /** current user id — so we know which side of the chat to show */
  userId?: string
}

export function MyTicketDetail({ params, basePath, userId }: Props) {
  const { id } = use(params)
  const [newComment, setNewComment] = useState("")
  const commentsEndRef = useRef<HTMLDivElement>(null)

  const { data, loading, refetch } = useFetch<{ ticket: TicketDetail }>(
    `/api/tickets/${id}`,
    { errorMessage: "Could not load ticket" },
  )

  const { execute: addComment, loading: commenting } = usePostCallback<
    { comment: Comment },
    { content: string }
  >(`/api/tickets/${id}/comments`, {
    successMessage: false,
    onSuccess: () => {
      setNewComment("")
      refetch()
    },
  })

  // Scroll to bottom of comments when new ones arrive
  useEffect(() => {
    if (data?.ticket.comments.length) {
      commentsEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [data?.ticket.comments.length])

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
  const TypeIcon = type.icon
  const isResolved = ticket.status === "RESOLVED" || ticket.status === "CLOSED"

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="gap-1.5 w-fit -mb-2">
        <Link href={basePath}><ArrowLeft className="size-4" /> My Tickets</Link>
      </Button>

      {/* Ticket header card */}
      <Card className="shadow-sm overflow-hidden">
        {/* Coloured top bar based on status */}
        <div className={`h-1.5 w-full ${isResolved ? "bg-emerald-500" : ticket.status === "IN_PROGRESS" ? "bg-amber-400" : "bg-rose-400"}`} />
        <CardContent className="p-6">
          <div className="flex items-start gap-3 mb-5">
            <div className={`rounded-xl border p-2.5 shrink-0 ${type.color}`}>
              <TypeIcon className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black tracking-tight">{ticket.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge variant="outline" className={`text-xs gap-1 ${type.color}`}>
                  <TypeIcon className="size-3" />{type.label}
                </Badge>
                <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[ticket.priority]}`}>
                  {ticket.priority.charAt(0) + ticket.priority.slice(1).toLowerCase()} priority
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  Submitted {format(new Date(ticket.createdAt), "dd MMM yyyy")}
                </span>
              </div>
            </div>
          </div>

          {/* Status tracker */}
          <div className="bg-muted/40 rounded-xl px-5 py-4 mb-5 overflow-x-auto">
            <StatusTracker status={ticket.status} />
            {isResolved && ticket.resolvedAt && (
              <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
                <CheckCircle2 className="size-3" />
                Resolved on {format(new Date(ticket.resolvedAt), "dd MMM yyyy")}
              </p>
            )}
          </div>

          {/* Description */}
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
              <Paperclip className="size-4 text-primary" />
              Your Attachments ({ticket.attachments.length})
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
                      <img src={a.fileUrl} alt={a.fileName} className="size-8 object-cover rounded shrink-0" />
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

      {/* Conversation */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 pt-4 px-5 border-b">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="size-4 text-primary" />
            Conversation
            {ticket.comments.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal">
                · {ticket.comments.length} message{ticket.comments.length !== 1 ? "s" : ""}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-4 flex flex-col gap-4">
          {ticket.comments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <MessageSquare className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No messages yet.</p>
              <p className="text-xs text-muted-foreground">The support team will reply here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {ticket.comments.map((c) => (
                <CommentBubble
                  key={c.id}
                  comment={c}
                  isOwn={c.author.id === userId || c.author.role !== "ADMIN"}
                />
              ))}
              <div ref={commentsEndRef} />
            </div>
          )}

          {/* Reply box — hide if closed */}
          {ticket.status !== "CLOSED" && (
            <div className="border-t pt-4 flex flex-col gap-2">
              <Textarea
                placeholder="Add a reply or additional information…"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={3}
                className="resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && newComment.trim()) {
                    void addComment({ content: newComment })
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <p className="text-[0.6875rem] text-muted-foreground">Ctrl+Enter to send</p>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={!newComment.trim() || commenting}
                  onClick={() => addComment({ content: newComment })}
                >
                  {commenting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  Send
                </Button>
              </div>
            </div>
          )}

          {ticket.status === "CLOSED" && (
            <div className="border-t pt-4 text-center">
              <p className="text-xs text-muted-foreground">This ticket is closed. No further replies can be added.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
