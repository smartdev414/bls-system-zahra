"use client"

import { useState, useRef, useEffect } from "react"
import {
  Send, Hand, MessageSquare, ChevronDown, X,
  Paperclip, Loader2, Image as ImageIcon, Video, FileText, Trash2, Download,
  Palette, Check, Sun, Moon, Contrast,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { QUICK_REACTIONS } from "./constants"
import type { ChatAttachment, ChatMsg, MsgType, RaisedHand } from "./types"
import {
  MULTIPART_THRESHOLD,
  uploadFileDirect,
  uploadFileInParts,
  isUploadAborted,
} from "@/lib/multipart-upload"

// ─── Per-user appearance ────────────────────────────────────────────────────
// Chat readability is personal — colour-blind and low-vision students need to
// pick what works for them. The choice is saved per device, not per room.
type ChatThemeName = "light" | "dark" | "contrast"
const CHAT_THEME_STORAGE_KEY = "classroom:chat-theme"

type ChatThemeClasses = {
  panel: string
  headerText: string
  headerSub: string
  hover: string
  border: string
  emptyText: string
  bubbleOther: string
  senderName: string
  timeText: string
  systemText: string
  inputBar: string
  inputField: string
  iconBtn: string
  reactionHover: string
  pendingBar: string
  pendingChip: string
  pendingName: string
  pendingMeta: string
}

const CHAT_THEMES: Record<ChatThemeName, ChatThemeClasses> = {
  light: {
    panel: "bg-white",
    headerText: "text-zinc-900",
    headerSub: "text-zinc-500",
    hover: "hover:bg-zinc-100",
    border: "border-zinc-200",
    emptyText: "text-zinc-400",
    bubbleOther: "bg-zinc-100 text-zinc-900 ring-1 ring-zinc-200",
    senderName: "text-amber-700",
    timeText: "text-zinc-400",
    systemText: "text-zinc-500",
    inputBar: "bg-zinc-50 border-zinc-200",
    inputField: "bg-white border-zinc-300 text-zinc-900 placeholder:text-zinc-400 focus:border-primary",
    iconBtn: "bg-zinc-100 border-zinc-300 hover:bg-zinc-200 text-zinc-600",
    reactionHover: "hover:bg-zinc-100",
    pendingBar: "bg-zinc-50",
    pendingChip: "bg-white border-zinc-300",
    pendingName: "text-zinc-800",
    pendingMeta: "text-zinc-500",
  },
  dark: {
    panel: "bg-zinc-900",
    headerText: "text-white",
    headerSub: "text-zinc-400",
    hover: "hover:bg-zinc-800/60",
    border: "border-zinc-800",
    emptyText: "text-zinc-700",
    bubbleOther: "bg-zinc-800 text-zinc-100",
    senderName: "text-amber-400",
    timeText: "text-zinc-600",
    systemText: "text-zinc-500",
    inputBar: "bg-zinc-900/80 border-zinc-800",
    inputField: "bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-600 focus:border-primary/60",
    iconBtn: "bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-300",
    reactionHover: "hover:bg-zinc-800",
    pendingBar: "bg-zinc-900/80",
    pendingChip: "bg-zinc-800 border-zinc-700",
    pendingName: "text-zinc-200",
    pendingMeta: "text-zinc-500",
  },
  // High contrast — pure black/white with bold borders for low-vision users.
  contrast: {
    panel: "bg-black",
    headerText: "text-white",
    headerSub: "text-zinc-200",
    hover: "hover:bg-zinc-800",
    border: "border-white/40",
    emptyText: "text-zinc-300",
    bubbleOther: "bg-zinc-900 text-white ring-1 ring-white/50",
    senderName: "text-amber-300",
    timeText: "text-zinc-300",
    systemText: "text-zinc-200",
    inputBar: "bg-black border-white/40",
    inputField: "bg-zinc-900 border-white/50 text-white placeholder:text-zinc-400 focus:border-primary",
    iconBtn: "bg-zinc-900 border-white/50 hover:bg-zinc-800 text-white",
    reactionHover: "hover:bg-zinc-800",
    pendingBar: "bg-black",
    pendingChip: "bg-zinc-900 border-white/40",
    pendingName: "text-white",
    pendingMeta: "text-zinc-300",
  },
}

const CHAT_THEME_OPTIONS: { name: ChatThemeName; label: string; icon: typeof Sun }[] = [
  { name: "light",    label: "Light",         icon: Sun },
  { name: "dark",     label: "Dark",          icon: Moon },
  { name: "contrast", label: "High contrast", icon: Contrast },
]

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
  "application/pdf",
  // PowerPoint, Word, Excel, text — keep in sync with the presign route's ALLOWED.
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
])

// Accept attribute mirrors ALLOWED_MIME; extensions help browsers that report
// empty/again-generic MIME types for Office files.
const FILE_ACCEPT = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  ".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx", ".txt",
].join(",")

// No app-level size cap: anything over MULTIPART_THRESHOLD is chunked and PUT
// straight to S3 part by part, so a full-length lesson recording goes through
// the same paperclip as a screenshot.

// Some browsers report an empty/generic MIME for Office files — fall back to the
// extension so the upload still validates against the (extension-agnostic) server.
const EXT_MIME: Record<string, string> = {
  ppt:  "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc:  "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:  "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf:  "application/pdf",
  txt:  "text/plain",
}

function effectiveMime(file: File): string {
  if (file.type && ALLOWED_MIME.has(file.type)) return file.type
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return EXT_MIME[ext] ?? file.type
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("video/")) return <Video className={className} />
  if (mimeType.startsWith("image/")) return <ImageIcon className={className} />
  return <FileText className={className} />
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  const isImage = attachment.mimeType.startsWith("image/")
  const isVideo = attachment.mimeType.startsWith("video/")

  return (
    <div className="mt-1.5 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/20">
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.fileUrl}
          alt={attachment.fileName}
          className="max-h-48 w-full max-w-full object-contain bg-zinc-950"
        />
      )}
      {isVideo && (
        <video
          src={attachment.fileUrl}
          controls
          playsInline
          className="max-h-48 w-full max-w-full bg-zinc-950"
          preload="metadata"
        />
      )}
      <div className="flex items-center gap-2 px-2.5 py-2 text-xs border-t border-white/10">
        <FileIcon mimeType={attachment.mimeType} className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate flex-1 min-w-0">{attachment.fileName}</span>
        <span className="text-[10px] opacity-60 shrink-0">{formatBytes(attachment.fileSize)}</span>
      </div>
      <div className="flex border-t border-white/10 divide-x divide-white/10">
        <a
          href={attachment.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium hover:bg-white/5 transition-colors"
        >
          Open
        </a>
        <a
          href={attachment.fileUrl}
          download={attachment.fileName}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium hover:bg-white/5 transition-colors"
        >
          <Download className="size-3" />
          Download
        </a>
      </div>
    </div>
  )
}

function MessageBubble({
  msg, isOwn, t, showGroup,
}: { msg: ChatMsg; isOwn: boolean; t: ChatThemeClasses; showGroup: boolean }) {
  const time = new Date(msg.ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (msg.type === "reaction") {
    return (
      <div className="flex flex-col items-center gap-0.5 my-1">
        <span className="text-2xl">{msg.text}</span>
        <span className={cn("text-[10px]", t.timeText)}>{msg.from} · {time}</span>
      </div>
    )
  }

  if (msg.type === "system") {
    return (
      <div className={cn("flex items-center justify-center gap-1.5 text-[11px] py-0.5", t.systemText)}>
        <Hand className="size-3" />
        <span>{msg.text}</span>
        <span className="opacity-70">· {time}</span>
      </div>
    )
  }

  const hasAttachment = !!msg.attachment

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 min-w-0 max-w-[88%]",
        isOwn ? "items-end self-end" : "items-start self-start",
        hasAttachment && "w-full",
      )}
    >
      {(!isOwn || (showGroup && msg.groupName)) && (
        <span className={cn("text-[11px] font-semibold px-1 leading-none", t.senderName)}>
          {!isOwn && msg.from}
          {/* Teachers see every group's chat in one list; say which group. */}
          {showGroup && msg.groupName && (
            <span className="ml-1 font-normal opacity-70">{!isOwn && "· "}{msg.groupName}</span>
          )}
        </span>
      )}
      <div
        className={cn(
          "min-w-0 max-w-full overflow-hidden px-3 py-2 text-sm leading-snug wrap-break-word",
          hasAttachment && "w-full",
          isOwn
            ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
            : cn(t.bubbleOther, "rounded-2xl rounded-bl-sm")
        )}
      >
        {msg.text && <p>{msg.text}</p>}
        {msg.attachment && <AttachmentPreview attachment={msg.attachment} />}
        {!msg.text && !msg.attachment && (
          <span className="opacity-60 italic">Empty message</span>
        )}
      </div>
      <span className={cn("text-[10px] px-1", t.timeText)}>{time}</span>
    </div>
  )
}

export function ChatPanel({
  messages,
  audienceLabel = null,
  showGroupLabels = false,
  localName,
  raisedHands,
  onSend,
  flash,
  collapsed,
  onToggleCollapse,
  isTutor,
  sessionId,
  onLowerHand,
  onLowerAllHands,
}: {
  messages: ChatMsg[]
  /** During breakouts, who a message sent now reaches. Null outside breakouts. */
  audienceLabel?: string | null
  /** Label each bubble with its breakout group (teachers, who see them all). */
  showGroupLabels?: boolean
  localName: string
  raisedHands: RaisedHand[]
  onSend: (text: string, type: MsgType, attachment?: ChatAttachment) => void
  flash: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  isTutor?: boolean
  sessionId: string
  onLowerHand?: (identity: string) => void
  onLowerAllHands?: () => void
}) {
  const [input, setInput]       = useState("")
  // A message the student was part-way through typing is exactly what they lose
  // by reloading, so mirror the composer into sessionStorage (per session, per
  // tab) alongside any file they already uploaded but haven't sent.
  const draftStorageKey = `classroom:chat-draft:${sessionId}`
  const draftRestoredRef = useRef(false)
  const [unread, setUnread]     = useState(0)
  const [atBottom, setAtBottom] = useState(true)
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  // Percent for the in-flight attachment. Multi-gigabyte videos take minutes, so
  // a bare spinner isn't enough — show progress and let people back out.
  const [uploadPercent, setUploadPercent] = useState(0)
  const [uploadName, setUploadName] = useState("")
  const uploadAbortRef = useRef<AbortController | null>(null)
  // Default to dark to match the classroom chrome; restore saved choice on mount.
  const [theme, setTheme] = useState<ChatThemeName>("dark")
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const listRef      = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const themeMenuRef = useRef<HTMLDivElement>(null)

  const t = CHAT_THEMES[theme]

  useEffect(() => {
    const saved = typeof window !== "undefined"
      ? window.localStorage.getItem(CHAT_THEME_STORAGE_KEY)
      : null
    if (saved === "light" || saved === "dark" || saved === "contrast") setTheme(saved)
  }, [])

  // Restore the composer once, on mount.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftStorageKey)
      if (raw) {
        const saved = JSON.parse(raw) as { text?: string; attachment?: ChatAttachment | null }
        if (typeof saved.text === "string" && saved.text) setInput(saved.text)
        if (saved.attachment?.fileUrl) setPendingAttachment(saved.attachment)
      }
    } catch { /* corrupt or unavailable storage — start with an empty composer */ }
    draftRestoredRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Skip the first pass: it runs before the restore above has re-rendered and
    // would otherwise overwrite the draft it is about to read.
    if (!draftRestoredRef.current) return
    try {
      if (!input && !pendingAttachment) {
        sessionStorage.removeItem(draftStorageKey)
        return
      }
      sessionStorage.setItem(
        draftStorageKey,
        JSON.stringify({ text: input, attachment: pendingAttachment }),
      )
    } catch { /* quota or storage disabled — the draft just won't survive a reload */ }
  }, [input, pendingAttachment, draftStorageKey])

  const changeTheme = (next: ChatThemeName) => {
    setTheme(next)
    setThemeMenuOpen(false)
    try { window.localStorage.setItem(CHAT_THEME_STORAGE_KEY, next) } catch {}
  }

  // Close the appearance menu on outside click / Escape.
  useEffect(() => {
    if (!themeMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setThemeMenuOpen(false) }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [themeMenuOpen])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (atBottom) {
      el.scrollTop = el.scrollHeight
      setUnread(0)
    } else {
      const last = messages[messages.length - 1]
      if (last && last.from !== localName) setUnread((n) => n + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAtBottom(near)
    if (near) setUnread(0)
  }

  const scrollToBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    setAtBottom(true)
    setUnread(0)
  }

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    const contentType = effectiveMime(file)

    if (!ALLOWED_MIME.has(contentType)) {
      toast.error(`"${file.name}" is not supported. Use images, video, PDF, Word, PowerPoint, Excel, or text.`)
      return
    }
    const controller = new AbortController()
    uploadAbortRef.current = controller
    setUploading(true)
    setUploadPercent(0)
    setUploadName(file.name)

    try {
      let fileUrl: string

      if (file.size > MULTIPART_THRESHOLD) {
        // Big file: chunked straight into S3, no size ceiling.
        fileUrl = await uploadFileInParts({
          endpoint: `/api/sessions/${sessionId}/chat-upload-multipart`,
          file,
          contentType,
          signal: controller.signal,
          onProgress: (p) => setUploadPercent(p.percent),
        })
      } else {
        const presignRes = await fetch(`/api/sessions/${sessionId}/chat-upload-presign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType, fileSize: file.size }),
          signal: controller.signal,
        })
        if (!presignRes.ok) {
          const err = await presignRes.json() as { message?: string }
          throw new Error(err.message ?? "Could not get upload URL")
        }
        const presigned = await presignRes.json() as { presignedUrl: string; fileUrl: string }
        await uploadFileDirect({
          presignedUrl: presigned.presignedUrl,
          file,
          contentType,
          signal: controller.signal,
          onProgress: (p) => setUploadPercent(p.percent),
        })
        fileUrl = presigned.fileUrl
      }

      setPendingAttachment({
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: contentType,
      })
    } catch (e) {
      // A cancel is the user's own doing — don't shout about it.
      if (!isUploadAborted(e)) {
        toast.error(e instanceof Error ? e.message : "Upload failed")
      }
    } finally {
      uploadAbortRef.current = null
      setUploading(false)
      setUploadPercent(0)
      setUploadName("")
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const cancelUpload = () => uploadAbortRef.current?.abort()

  const handleSend = () => {
    const text = input.trim()
    if (!text && !pendingAttachment) return
    onSend(text, "text", pendingAttachment ?? undefined)
    setInput("")
    setPendingAttachment(null)
    inputRef.current?.focus()
  }

  const canSend = !!input.trim() || !!pendingAttachment

  if (collapsed) {
    return (
      <div className={cn("flex flex-col items-center h-full", t.panel)}>
        <button
          onClick={onToggleCollapse}
          className={cn("w-full flex items-center justify-center py-3 transition-colors relative", t.hover)}
          title="Expand Chat"
        >
          <MessageSquare className="size-4 text-primary" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1 size-3.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center">
              {unread}
            </span>
          )}
        </button>
        <div className="flex-1 flex items-center justify-center">
          <span
            className={cn("text-[10px] font-bold uppercase tracking-widest", t.headerText)}
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Live Chat{unread > 0 ? ` · ${unread} new` : ""}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-col h-full min-h-0 overflow-hidden transition-all duration-300",
        t.panel,
        flash && "shadow-[inset_1px_0_0_hsl(var(--primary)/0.6)]"
      )}
    >
      <div className={cn("shrink-0 flex items-center border-b", t.border, t.panel)}>
        <button
          onClick={onToggleCollapse}
          className={cn("flex-1 min-w-0 px-4 py-3 flex items-center gap-2 transition-colors text-left", t.hover)}
        >
          <MessageSquare className="size-4 text-primary shrink-0" />
          <span className={cn("font-bold text-sm", t.headerText)}>Live Chat</span>
          {unread > 0 && (
            <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full animate-bounce">
              {unread}
            </span>
          )}
          <ChevronDown className={cn("size-3.5 ml-auto transition-transform duration-200", t.headerSub, collapsed && "-rotate-90")} />
        </button>

        {/* Appearance picker — each person chooses light / dark / high-contrast. */}
        <div className="relative shrink-0 pr-2" ref={themeMenuRef}>
          <button
            type="button"
            onClick={() => setThemeMenuOpen((v) => !v)}
            className={cn("flex items-center justify-center size-8 rounded-lg transition-colors", t.hover, t.headerSub)}
            title="Chat appearance — pick what's easiest for you to read"
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
          >
            <Palette className="size-4" />
          </button>
          {themeMenuOpen && (
            <div
              role="menu"
              className={cn(
                "absolute right-0 top-full mt-1 z-30 w-44 rounded-lg border shadow-xl py-1",
                t.panel, t.border,
              )}
            >
              <p className={cn("px-3 py-1 text-[10px] uppercase tracking-wide", t.headerSub)}>Appearance</p>
              {CHAT_THEME_OPTIONS.map(({ name, label, icon: Icon }) => (
                <button
                  key={name}
                  role="menuitemradio"
                  aria-checked={theme === name}
                  onClick={() => changeTheme(name)}
                  className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors", t.headerText, t.hover)}
                >
                  <Icon className="size-3.5 shrink-0 opacity-80" />
                  <span className="flex-1 text-left">{label}</span>
                  {theme === name && <Check className="size-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {raisedHands.length > 0 && (
        <div className="shrink-0 px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 flex items-center gap-2 flex-wrap">
          <Hand className="size-3.5 text-amber-400 shrink-0 animate-bounce" />
          <span className="text-[11px] font-semibold text-amber-400">Raised:</span>
          {raisedHands.map((h) => (
            <span
              key={h.identity}
              className={cn(
                "flex items-center gap-1 text-[11px] text-amber-300 bg-amber-500/20 rounded-full",
                isTutor && onLowerHand ? "pl-2 pr-0.5 py-0.5" : "px-2 py-0.5",
              )}
            >
              {h.name}
              {isTutor && onLowerHand && (
                <button
                  onClick={() => onLowerHand(h.identity)}
                  className="flex items-center justify-center size-4 rounded-full hover:bg-amber-500/40 text-amber-200 hover:text-white transition-colors"
                  title={`Lower ${h.name}'s hand`}
                  aria-label={`Lower ${h.name}'s hand`}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {isTutor && onLowerAllHands && raisedHands.length > 1 && (
            <button
              onClick={onLowerAllHands}
              className="text-[11px] font-semibold text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/30 border border-amber-500/40 px-2 py-0.5 rounded-full transition-colors ml-auto"
              title="Lower every raised hand"
            >
              Lower all
            </button>
          )}
        </div>
      )}

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 flex flex-col gap-2 min-h-0 min-w-0"
      >
        {messages.length === 0 ? (
          <div className={cn("flex flex-col items-center justify-center h-full gap-3 select-none", t.emptyText)}>
            <MessageSquare className="size-8 opacity-30" />
            <p className="text-xs text-center opacity-70 max-w-48">
              Chat is how everyone communicates here. Say hello! 👋
            </p>
            <p className="text-[11px] text-center opacity-50 max-w-52">
              Use the paperclip to share a file — everyone can open or download it.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} msg={m} isOwn={m.from === localName} t={t} showGroup={showGroupLabels} />
          ))
        )}
      </div>

      {!atBottom && (
        <div className="absolute bottom-38 left-1/2 -translate-x-1/2 z-10 right-panel-anchor">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg hover:bg-primary/90 transition-colors"
          >
            <ChevronDown className="size-3.5" />
            {unread > 0 ? `${unread} new message${unread > 1 ? "s" : ""}` : "Scroll to latest"}
          </button>
        </div>
      )}

      {/* The placeholder disappears once you type, and "who will see this?" is
          exactly the question in a breakout — so say it where it stays put. */}
      {audienceLabel && (
        <div className={cn("shrink-0 px-3 pt-2 text-[11px] leading-none", t.timeText)} aria-live="polite">
          Messages go to <span className="font-semibold">{audienceLabel}</span>
        </div>
      )}

      <div className={cn("shrink-0 flex items-center gap-1 px-3 py-2 border-t", t.inputBar)}>
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSend(emoji, "reaction")}
            className={cn("text-lg hover:scale-125 active:scale-110 transition-transform leading-none p-1 rounded-lg", t.reactionHover)}
            title={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {uploading && (
        <div className={cn("shrink-0 px-3 pt-2 flex items-center gap-2", t.pendingBar)}>
          <div className={cn("flex items-center gap-2 flex-1 min-w-0 rounded-lg border px-2.5 py-1.5", t.pendingChip)}>
            <Loader2 className={cn("size-3.5 shrink-0 animate-spin", t.pendingMeta)} />
            <div className="flex-1 min-w-0">
              <span className={cn("text-xs truncate block", t.pendingName)}>{uploadName}</span>
              <div className="mt-1 h-1 rounded-full bg-current/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
            <span className={cn("text-[10px] shrink-0 tabular-nums", t.pendingMeta)}>{uploadPercent}%</span>
            <button
              onClick={cancelUpload}
              className={cn("shrink-0 hover:text-rose-400 transition-colors", t.pendingMeta)}
              title="Cancel upload"
              aria-label="Cancel upload"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {pendingAttachment && (
        <div className={cn("shrink-0 px-3 pt-2 flex items-center gap-2", t.pendingBar)}>
          <div className={cn("flex items-center gap-2 flex-1 min-w-0 rounded-lg border px-2.5 py-1.5", t.pendingChip)}>
            <FileIcon mimeType={pendingAttachment.mimeType} className={cn("size-3.5 shrink-0", t.pendingMeta)} />
            <span className={cn("text-xs truncate flex-1", t.pendingName)}>{pendingAttachment.fileName}</span>
            <span className={cn("text-[10px] shrink-0", t.pendingMeta)}>{formatBytes(pendingAttachment.fileSize)}</span>
            <button
              onClick={() => setPendingAttachment(null)}
              className={cn("shrink-0 hover:text-rose-400 transition-colors", t.pendingMeta)}
              title="Remove attachment"
              aria-label="Remove attachment"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className={cn("shrink-0 p-3 border-t flex gap-2 items-end", t.inputBar)}>
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={(e) => void handleFileSelect(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={cn("shrink-0 size-9 rounded-xl border flex items-center justify-center disabled:opacity-40 transition-colors", t.iconBtn)}
          title={audienceLabel ? `Attach a file for ${audienceLabel}` : "Attach a file for everyone to open or download"}
          aria-label="Attach file"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          rows={1}
          placeholder={audienceLabel ? `Message ${audienceLabel}…` : "Type a message or attach a file…"}
          className={cn("flex-1 resize-none rounded-xl border text-sm px-3 py-2 outline-none transition-colors max-h-24 overflow-y-auto leading-snug", t.inputField)}
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          onClick={handleSend}
          disabled={!canSend || uploading}
          className="shrink-0 size-9 rounded-xl bg-primary flex items-center justify-center hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          <Send className="size-4 text-white" />
        </button>
      </div>
    </div>
  )
}
