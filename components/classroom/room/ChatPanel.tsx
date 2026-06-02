"use client"

import { useState, useRef, useEffect } from "react"
import {
  Send, Hand, MessageSquare, ChevronDown, X,
  Paperclip, Loader2, Image, Video, FileText, Trash2, Download,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { QUICK_REACTIONS } from "./constants"
import type { ChatAttachment, ChatMsg, MsgType, RaisedHand } from "./types"

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
  "application/pdf",
])

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("video/")) return Video
  if (mimeType.startsWith("image/")) return Image
  return FileText
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  const Icon = fileIcon(attachment.mimeType)
  const isImage = attachment.mimeType.startsWith("image/")
  const isVideo = attachment.mimeType.startsWith("video/")

  return (
    <div className="mt-1.5 overflow-hidden rounded-xl border border-white/10 bg-black/20">
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.fileUrl}
          alt={attachment.fileName}
          className="max-h-48 w-full object-contain bg-zinc-950"
        />
      )}
      {isVideo && (
        <video
          src={attachment.fileUrl}
          controls
          playsInline
          className="max-h-48 w-full bg-zinc-950"
          preload="metadata"
        />
      )}
      <div className="flex items-center gap-2 px-2.5 py-2 text-xs border-t border-white/10">
        <Icon className="size-3.5 shrink-0 opacity-70" />
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

function MessageBubble({ msg, isOwn }: { msg: ChatMsg; isOwn: boolean }) {
  const time = new Date(msg.ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (msg.type === "reaction") {
    return (
      <div className="flex flex-col items-center gap-0.5 my-1">
        <span className="text-2xl">{msg.text}</span>
        <span className="text-[10px] text-zinc-600">{msg.from} · {time}</span>
      </div>
    )
  }

  if (msg.type === "system") {
    return (
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 py-0.5">
        <Hand className="size-3" />
        <span>{msg.text}</span>
        <span className="text-zinc-700">· {time}</span>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-0.5", isOwn ? "items-end self-end" : "items-start self-start", "max-w-[88%]")}>
      {!isOwn && (
        <span className="text-[11px] font-semibold text-amber-400 px-1 leading-none">{msg.from}</span>
      )}
      <div
        className={cn(
          "px-3 py-2 text-sm leading-snug wrap-break-word",
          isOwn
            ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
            : "bg-zinc-800 text-zinc-100 rounded-2xl rounded-bl-sm"
        )}
      >
        {msg.text && <p>{msg.text}</p>}
        {msg.attachment && <AttachmentPreview attachment={msg.attachment} />}
        {!msg.text && !msg.attachment && (
          <span className="opacity-60 italic">Empty message</span>
        )}
      </div>
      <span className="text-[10px] text-zinc-600 px-1">{time}</span>
    </div>
  )
}

export function ChatPanel({
  messages,
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
  const [unread, setUnread]     = useState(0)
  const [atBottom, setAtBottom] = useState(true)
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const listRef      = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error(`"${file.name}" is not supported. Use images, PDF, or video.`)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error(`"${file.name}" exceeds 15 MB`)
      return
    }

    setUploading(true)
    try {
      const presignRes = await fetch(`/api/sessions/${sessionId}/chat-upload-presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
      })
      if (!presignRes.ok) {
        const err = await presignRes.json() as { message?: string }
        throw new Error(err.message ?? "Could not get upload URL")
      }
      const { presignedUrl, fileUrl } = await presignRes.json() as { presignedUrl: string; fileUrl: string }

      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error("Upload failed")

      setPendingAttachment({
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

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
      <div className="flex flex-col items-center h-full bg-zinc-900">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center py-3 hover:bg-zinc-800 transition-colors relative"
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
            className="text-[10px] font-bold text-white uppercase tracking-widest"
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
        flash && "shadow-[inset_1px_0_0_hsl(var(--primary)/0.6)]"
      )}
    >
      <button
        onClick={onToggleCollapse}
        className="shrink-0 px-4 py-3 border-b border-zinc-800 flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800/60 transition-colors w-full text-left"
      >
        <MessageSquare className="size-4 text-primary shrink-0" />
        <span className="font-bold text-sm text-white">Live Chat</span>
        {unread > 0 && (
          <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full animate-bounce">
            {unread}
          </span>
        )}
        <ChevronDown className={cn("size-3.5 text-zinc-500 ml-auto transition-transform duration-200", collapsed && "-rotate-90")} />
      </button>

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
        className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 min-h-0"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700 select-none">
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
            <MessageBubble key={m.id} msg={m} isOwn={m.from === localName} />
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

      <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-t border-zinc-800/60 bg-zinc-900/60">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSend(emoji, "reaction")}
            className="text-lg hover:scale-125 active:scale-110 transition-transform leading-none p-1 rounded-lg hover:bg-zinc-800"
            title={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {pendingAttachment && (
        <div className="shrink-0 px-3 pt-2 flex items-center gap-2 bg-zinc-900/80">
          <div className="flex items-center gap-2 flex-1 min-w-0 rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5">
            {(() => {
              const Icon = fileIcon(pendingAttachment.mimeType)
              return <Icon className="size-3.5 shrink-0 text-zinc-400" />
            })()}
            <span className="text-xs text-zinc-200 truncate flex-1">{pendingAttachment.fileName}</span>
            <span className="text-[10px] text-zinc-500 shrink-0">{formatBytes(pendingAttachment.fileSize)}</span>
            <button
              onClick={() => setPendingAttachment(null)}
              className="shrink-0 text-zinc-500 hover:text-rose-400 transition-colors"
              title="Remove attachment"
              aria-label="Remove attachment"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 p-3 border-t border-zinc-800 bg-zinc-900/80 flex gap-2 items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf"
          className="hidden"
          onChange={(e) => void handleFileSelect(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 size-9 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 transition-colors"
          title="Attach a file for everyone to open or download"
          aria-label="Attach file"
        >
          {uploading ? (
            <Loader2 className="size-4 text-zinc-300 animate-spin" />
          ) : (
            <Paperclip className="size-4 text-zinc-300" />
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
          placeholder="Type a message or attach a file…"
          className="flex-1 resize-none rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-white placeholder:text-zinc-600 px-3 py-2 outline-none focus:border-primary/60 transition-colors max-h-24 overflow-y-auto leading-snug"
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
