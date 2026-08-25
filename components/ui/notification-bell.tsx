"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Bell,
  BookOpen,
  CheckCheck,
  Trash2,
  Video,
  Award,
  XCircle,
  UserPlus,
  Users2,
  Star,
  Radio,
  CalendarPlus,
  BellOff,
} from "lucide-react"
import { toast } from "sonner"
import { usePoll } from "@/hooks/use-poll"
import { netFetch, netJson, POLL_TIMEOUT_MS } from "@/lib/net-fetch"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"

type NotificationType =
  | "SESSION_SCHEDULED"
  | "SESSION_STARTED"
  | "SESSION_CANCELLED"
  | "SESSION_DELETED"
  | "SESSION_INVITE"
  | "SESSION_COTUTOR_INVITE"
  | "RECORDING_READY"
  | "COURSE_PUBLISHED"
  | "NEW_LESSON"
  | "NEW_ENROLLMENT"
  | "NEW_REVIEW"
  | "NEW_TUTOR_REVIEW"
  | "CERT_STEP_REVIEWED"
  | "CERT_COMPLETED"
  | "CERT_SUBMISSION_RECEIVED"
  | "SESSION_JOIN_REQUEST"
  | "SESSION_REQUEST_APPROVED"
  | "SESSION_REQUEST_REJECTED"
  | "QUIZ_PASSED"
  | "QUIZ_FAILED"

type Notification = {
  id: string
  type: NotificationType
  title: string
  body: string
  link: string | null
  isRead: boolean
  createdAt: string
}

const typeIcon: Record<NotificationType, React.ElementType> = {
  SESSION_SCHEDULED: CalendarPlus,
  SESSION_STARTED: Radio,
  SESSION_CANCELLED: XCircle,
  SESSION_DELETED: XCircle,
  SESSION_INVITE: Video,
  SESSION_COTUTOR_INVITE: Users2,
  RECORDING_READY: Video,
  COURSE_PUBLISHED: BookOpen,
  NEW_LESSON: BookOpen,
  NEW_ENROLLMENT: UserPlus,
  NEW_REVIEW: Star,
  NEW_TUTOR_REVIEW: Star,
  CERT_STEP_REVIEWED: Award,
  CERT_COMPLETED: Award,
  CERT_SUBMISSION_RECEIVED: Award,
  SESSION_JOIN_REQUEST: UserPlus,
  SESSION_REQUEST_APPROVED: Video,
  SESSION_REQUEST_REJECTED: XCircle,
  QUIZ_PASSED: Award,
  QUIZ_FAILED: Award,
}

const typeColor: Record<NotificationType, string> = {
  SESSION_SCHEDULED: "text-blue-500",
  SESSION_STARTED: "text-green-500",
  SESSION_CANCELLED: "text-destructive",
  SESSION_DELETED: "text-destructive",
  SESSION_INVITE: "text-blue-500",
  SESSION_COTUTOR_INVITE: "text-primary",
  RECORDING_READY: "text-blue-500",
  COURSE_PUBLISHED: "text-primary",
  NEW_LESSON: "text-primary",
  NEW_ENROLLMENT: "text-green-500",
  NEW_REVIEW: "text-yellow-500",
  NEW_TUTOR_REVIEW: "text-yellow-500",
  CERT_STEP_REVIEWED: "text-primary",
  CERT_COMPLETED: "text-green-500",
  CERT_SUBMISSION_RECEIVED: "text-yellow-500",
  SESSION_JOIN_REQUEST: "text-blue-500",
  SESSION_REQUEST_APPROVED: "text-green-500",
  SESSION_REQUEST_REJECTED: "text-destructive",
  QUIZ_PASSED: "text-green-500",
  QUIZ_FAILED: "text-destructive",
}

const POLL_INTERVAL = 30_000 // 30 seconds

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  async function fetchNotifications() {
    try {
      const data = await netJson<{ notifications: Notification[]; unreadCount: number }>(
        "/api/notifications",
        undefined,
        // Background chatter: it must not hold a socket open on a stalled link,
        // and it must not move the global connection banner on its own — the
        // bell going quiet for a minute is not worth telling anyone about.
        { timeoutMs: POLL_TIMEOUT_MS, retries: 0, report: false },
      )
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
    } catch { /* the next poll picks it up */ }
  }

  // Paused while the tab is hidden or the link is down, and caught up the
  // instant either clears — so coming back to a laptop that slept shows the
  // right badge immediately rather than up to half a minute later.
  usePoll(fetchNotifications, POLL_INTERVAL)

  // Fetch fresh list when popover opens
  useEffect(() => {
    if (open) void fetchNotifications()
  }, [open])

  // These now go through a request with a deadline, which can reject where a
  // bare `fetch` would have hung. Each one keeps its own local state truthful
  // rather than throwing into an event handler and leaving the list showing a
  // change that never reached the server.
  async function markAllRead() {
    setLoading(true)
    try {
      await netFetch("/api/notifications", { method: "PATCH" })
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function markRead(id: string) {
    try {
      await netFetch(`/api/notifications/${id}`, { method: "PATCH" })
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      )
      setUnreadCount((c) => Math.max(0, c - 1))
    } catch { /* stays unread; the next poll or open re-syncs it */ }
  }

  async function dismiss(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    try {
      await netFetch(`/api/notifications/${id}`, { method: "DELETE" })
    } catch (err) {
      toast.error((err as Error).message)
      return
    }
    const wasUnread = notifications.find((n) => n.id === id)?.isRead === false
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1))
  }

  function handleClick(n: Notification) {
    if (!n.isRead) void markRead(n.id)
    if (n.link) {
      setOpen(false)
      router.push(n.link)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[1.1rem] h-[1.1rem] rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center px-0.5 leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[380px] p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {unreadCount} new
              </Badge>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={markAllRead}
              disabled={loading}
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        {/* List */}
        <ScrollArea className="max-h-[420px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <BellOff className="size-8 opacity-30" />
              <span className="text-sm">No notifications yet</span>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => {
                const Icon = typeIcon[n.type] ?? Bell
                const color = typeColor[n.type] ?? "text-muted-foreground"
                return (
                  <div
                    key={n.id}
                    role={n.link ? "button" : undefined}
                    tabIndex={n.link ? 0 : undefined}
                    onClick={() => handleClick(n)}
                    onKeyDown={(e) => e.key === "Enter" && handleClick(n)}
                    className={cn(
                      "group flex gap-3 px-4 py-3 transition-colors",
                      n.link && "cursor-pointer hover:bg-muted/50",
                      !n.isRead && "bg-primary/5",
                    )}
                  >
                    {/* Icon */}
                    <div className={cn("mt-0.5 shrink-0 size-7 rounded-full bg-muted flex items-center justify-center", color)}>
                      <Icon className="size-3.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm leading-snug", !n.isRead && "font-semibold")}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    </div>

                    {/* Dismiss */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100 text-muted-foreground hover:text-destructive mt-0.5"
                      onClick={(e) => dismiss(e, n.id)}
                      aria-label="Dismiss"
                    >
                      <Trash2 className="size-3" />
                    </Button>

                    {/* Unread dot */}
                    {!n.isRead && (
                      <span className="mt-2 shrink-0 size-1.5 rounded-full bg-primary self-start" />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>

        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="px-4 py-2 text-center">
              <span className="text-xs text-muted-foreground">
                Showing last {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
              </span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
