"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import {
  Search, Send, Plus, MessageSquare, Loader2,
  CheckCheck, Check, MoreVertical, Users, Wifi, WifiOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useFetch, usePostCallback } from "@/hooks/use-fetch"
import { getPusherClient } from "@/lib/pusher-client"
import type { Channel } from "pusher-js"

// ─── Types ────────────────────────────────────────────────────────────────────

type Contact = { id: string; name: string; avatarUrl: string | null }

type ConversationSummary = {
  id: string
  other: Contact
  lastMessage: { content: string; createdAt: string; senderId: string; isRead: boolean } | null
  unreadCount: number
  lastMessageAt: string
}

type MessageItem = {
  id: string
  content: string
  createdAt: string
  senderId: string
  isRead: boolean
  sender: Contact
}

type ConversationDetail = {
  id: string
  student: Contact
  tutor: Contact
  messages: MessageItem[]
}

type ConvsData     = { conversations: ConversationSummary[] }
type ConvData      = { conversation: ConversationDetail }
type ContactsData  = { contacts: Contact[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessagingCenter({
  role,
}: {
  role: "STUDENT" | "TUTOR"
  basePath: string
}) {
  const [activeId, setActiveId]       = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [newConvOpen, setNewConvOpen] = useState(false)
  const [connected, setConnected]     = useState(false)

  // Local messages state — seeded from fetch, then appended via Pusher
  const [messages, setMessages] = useState<MessageItem[]>([])

  // ── Conversation list ──────────────────────────────────────────────────────
  const { data: convsData, loading: convsLoading, refetch: refetchConvs } = useFetch<ConvsData>(
    "/api/messages/conversations",
    { errorMessage: "Could not load conversations" }
  )

  const filtered = (convsData?.conversations ?? []).filter((c) =>
    !searchQuery || c.other.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // ── Active conversation (initial load) ────────────────────────────────────
  const { data: convData, loading: convLoading, refetch: refetchConv } = useFetch<ConvData>(
    activeId ? `/api/messages/conversations/${activeId}` : "",
    {
      errorMessage: "Could not load messages",
      immediate: !!activeId,
      onSuccess: (d) => setMessages(d.conversation.messages),
    }
  )

  const activeConv = convData?.conversation ?? null

  // ── Pusher: connect once per session ──────────────────────────────────────
  const userChannelRef = useRef<Channel | null>(null)

  useEffect(() => {
    const pusher = getPusherClient()

    pusher.connection.bind("connected",    () => setConnected(true))
    pusher.connection.bind("disconnected", () => setConnected(false))
    pusher.connection.bind("error",        () => setConnected(false))

    // Subscribe to personal channel for sidebar updates
    const ch = pusher.subscribe(`private-user-${getUserId()}`)
    userChannelRef.current = ch

    ch.bind("new-message", () => {
      refetchConvs()
    })

    return () => {
      ch.unbind_all()
      pusher.unsubscribe(`private-user-${getUserId()}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Pusher: subscribe to active conversation channel ──────────────────────
  const convChannelRef = useRef<Channel | null>(null)

  useEffect(() => {
    if (!activeId) return

    const pusher = getPusherClient()
    const channelName = `private-conversation-${activeId}`
    const ch = pusher.subscribe(channelName)
    convChannelRef.current = ch

    ch.bind("new-message", (incoming: MessageItem) => {
      setMessages((prev) => {
        // Avoid duplicates (our own sent message is already in state)
        if (prev.some((m) => m.id === incoming.id)) return prev
        return [...prev, incoming]
      })
      // Update sidebar last-message
      refetchConvs()
      // Mark messages as read on server (fire-and-forget)
      fetch(`/api/messages/conversations/${activeId}`, { method: "GET" }).catch(() => {})
    })

    return () => {
      ch.unbind_all()
      pusher.unsubscribe(channelName)
      convChannelRef.current = null
    }
  }, [activeId, refetchConvs])

  // Reload messages when switching conversation
  useEffect(() => {
    if (activeId) {
      setMessages([])
      refetchConv()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Auto-scroll to bottom when messages change
  const messagesEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  // ── Send message ───────────────────────────────────────────────────────────
  const [draft, setDraft] = useState("")

  const { execute: sendMessage, loading: sending } = usePostCallback<
    { message: MessageItem },
    { content: string }
  >(
    activeId ? `/api/messages/conversations/${activeId}/messages` : "",
    {
      successMessage: false,
      errorMessage: "Could not send message",
      onSuccess: (d) => {
        // Optimistically append our own message immediately
        setMessages((prev) =>
          prev.some((m) => m.id === d.message.id) ? prev : [...prev, d.message]
        )
        setDraft("")
        refetchConvs()
      },
    }
  )

  function handleSend() {
    if (!draft.trim() || !activeId) return
    sendMessage({ content: draft })
  }

  // ── Start new conversation ─────────────────────────────────────────────────
  const { execute: startConv, loading: startingConv } = usePostCallback<
    { conversation: { id: string } },
    { recipientId: string }
  >("/api/messages/conversations", {
    successMessage: false,
    errorMessage: "Could not start conversation",
    onSuccess: (d) => {
      setNewConvOpen(false)
      setActiveId(d.conversation.id)
      refetchConvs()
    },
  })

  const currentUserId = activeConv
    ? role === "STUDENT" ? activeConv.student.id : activeConv.tutor.id
    : null

  const otherUser = activeConv
    ? role === "STUDENT" ? activeConv.tutor : activeConv.student
    : null

  return (
    <div className="-mx-6 -mt-8 flex h-[calc(100vh-4rem)]">

      {/* ── LEFT: conversation list ─────────────────────────────────────────── */}
      <aside className="w-80 shrink-0 border-r flex flex-col bg-background">

        {/* Header */}
        <div className="px-4 py-4 border-b shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-black flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" /> Messages
            </h1>
            <div className="flex items-center gap-1">
              {/* Real-time connection indicator */}
              <span title={connected ? "Connected" : "Connecting…"}>
                {connected
                  ? <Wifi className="size-3.5 text-emerald-500" />
                  : <WifiOff className="size-3.5 text-muted-foreground animate-pulse" />}
              </span>
              <Button
                size="icon" variant="ghost" className="size-8"
                onClick={() => setNewConvOpen(true)}
                title="New conversation"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
        </div>

        {/* List */}
        <ScrollArea className="flex-1">
          {convsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : filtered.length > 0 ? (
            <div className="divide-y">
              {filtered.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conv={conv}
                  isActive={activeId === conv.id}
                  onClick={() => setActiveId(conv.id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 px-4 text-center">
              <MessageSquare className="size-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">No conversations yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click + to start a new conversation
                </p>
              </div>
            </div>
          )}
        </ScrollArea>
      </aside>

      {/* ── RIGHT: chat window ──────────────────────────────────────────────── */}
      {activeConv && otherUser ? (
        <div className="flex-1 flex flex-col min-w-0">

          {/* Chat header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b bg-background shrink-0">
            <Avatar className="size-9">
              <AvatarImage src={otherUser.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                {initials(otherUser.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{otherUser.name}</p>
              <p className="text-xs text-muted-foreground">
                {role === "STUDENT" ? "Tutor" : "Student"}
              </p>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-5 py-4">
            {convLoading && messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : messages.length > 0 ? (
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => {
                  const isMine    = msg.senderId === currentUserId
                  const showAvatar = !isMine &&
                    (i === 0 || messages[i - 1].senderId !== msg.senderId)
                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      isMine={isMine}
                      showAvatar={showAvatar}
                    />
                  )
                })}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <MessageSquare className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No messages yet. Say hello!</p>
              </div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className="px-5 py-3 border-t bg-background shrink-0">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); handleSend() }}
            >
              <Input
                placeholder="Type a message…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
                }}
              />
              <Button type="submit" size="icon" disabled={!draft.trim() || sending}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <div className="rounded-full bg-primary/10 p-6">
            <MessageSquare className="size-10 text-primary" />
          </div>
          <div>
            <p className="font-bold text-lg">Your messages</p>
            <p className="text-sm text-muted-foreground mt-1">
              Select a conversation or start a new one
            </p>
          </div>
          <Button onClick={() => setNewConvOpen(true)}>
            <Plus className="size-4 mr-1.5" /> New Conversation
          </Button>
        </div>
      )}

      {/* ── New conversation dialog ─────────────────────────────────────────── */}
      <NewConversationDialog
        open={newConvOpen}
        onClose={() => setNewConvOpen(false)}
        onStart={(id) => startConv({ recipientId: id })}
        starting={startingConv}
        existingIds={(convsData?.conversations ?? []).map((c) => c.other.id)}
      />
    </div>
  )
}

// ─── getUserId — reads from a cookie/session on client side ──────────────────
// We need the current user's ID for the personal Pusher channel.
// It's embedded in the JWT session cookie; we read it from a server component
// via a small helper endpoint instead of calling getSession() (server-only).
function getUserId(): string {
  if (typeof window === "undefined") return ""
  // Stored in a meta tag rendered by the layout, or read from a data attribute.
  // Fallback: try sessionStorage where the layout stores it.
  return sessionStorage.getItem("userId") ?? ""
}

// ─── Conversation row ─────────────────────────────────────────────────────────

function ConversationRow({
  conv, isActive, onClick,
}: {
  conv: ConversationSummary
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
        isActive && "bg-primary/5 border-l-2 border-l-primary"
      )}
    >
      <div className="relative shrink-0">
        <Avatar className="size-10">
          <AvatarImage src={conv.other.avatarUrl ?? undefined} />
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
            {initials(conv.other.name)}
          </AvatarFallback>
        </Avatar>
        {conv.unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary border-2 border-background" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className={cn("text-sm truncate", conv.unreadCount > 0 ? "font-bold" : "font-medium")}>
            {conv.other.name}
          </p>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {relativeTime(conv.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <p className={cn(
            "text-xs truncate",
            conv.unreadCount > 0 ? "text-foreground font-medium" : "text-muted-foreground"
          )}>
            {conv.lastMessage?.content ?? "No messages yet"}
          </p>
          {conv.unreadCount > 0 && (
            <Badge className="h-4 min-w-4 px-1 text-[10px] shrink-0 bg-primary">
              {conv.unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message, isMine, showAvatar,
}: {
  message: MessageItem
  isMine: boolean
  showAvatar: boolean
}) {
  const time = new Date(message.createdAt).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit",
  })

  return (
    <div className={cn("flex items-end gap-2", isMine ? "flex-row-reverse" : "flex-row")}>
      <div className="size-7 shrink-0">
        {!isMine && showAvatar && (
          <Avatar className="size-7">
            <AvatarImage src={message.sender.avatarUrl ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-bold">
              {initials(message.sender.name)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      <div className={cn("flex flex-col gap-0.5 max-w-[70%]", isMine ? "items-end" : "items-start")}>
        <div className={cn(
          "px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
          isMine
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted rounded-bl-sm"
        )}>
          {message.content}
        </div>
        <div className="flex items-center gap-1 px-1">
          <span className="text-[10px] text-muted-foreground">{time}</span>
          {isMine && (
            message.isRead
              ? <CheckCheck className="size-3 text-primary" />
              : <Check className="size-3 text-muted-foreground" />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── New conversation dialog ──────────────────────────────────────────────────

function NewConversationDialog({
  open, onClose, onStart, starting, existingIds,
}: {
  open: boolean
  onClose: () => void
  onStart: (id: string) => void
  starting: boolean
  existingIds: string[]
}) {
  const [search, setSearch] = useState("")

  const { data, loading } = useFetch<ContactsData>("/api/messages/contacts", {
    errorMessage: "Could not load contacts",
  })

  const contacts = (data?.contacts ?? []).filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-primary" /> New Conversation
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <Separator />
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : contacts.length > 0 ? (
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  disabled={starting}
                  onClick={() => onStart(contact.id)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors text-left"
                >
                  <Avatar className="size-9 shrink-0">
                    <AvatarImage src={contact.avatarUrl ?? undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                      {initials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{contact.name}</p>
                    {existingIds.includes(contact.id) && (
                      <p className="text-xs text-muted-foreground">Existing conversation</p>
                    )}
                  </div>
                  {starting && <Loader2 className="size-4 animate-spin shrink-0" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Users className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {search ? "No contacts found" : "No contacts available yet"}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
