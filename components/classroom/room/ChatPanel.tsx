"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Hand, MessageSquare, ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { QUICK_REACTIONS } from "./constants"
import type { ChatMsg, MsgType, RaisedHand } from "./types"

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
        {msg.text}
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
  onLowerHand,
  onLowerAllHands,
}: {
  messages: ChatMsg[]
  localName: string
  raisedHands: RaisedHand[]
  onSend: (text: string, type: MsgType) => void
  flash: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  // Tutor-only controls for dismissing raised hands from the chat strip.
  isTutor?: boolean
  onLowerHand?: (identity: string) => void
  onLowerAllHands?: () => void
}) {
  const [input, setInput]   = useState("")
  const [unread, setUnread] = useState(0)
  const [atBottom, setAtBottom] = useState(true)
  const listRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    onSend(text, "text")
    setInput("")
    inputRef.current?.focus()
  }

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
            className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest"
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

      <div className="shrink-0 p-3 border-t border-zinc-800 bg-zinc-900/80 flex gap-2 items-end">
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
          placeholder="Type a message… (Enter to send)"
          className="flex-1 resize-none rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-white placeholder:text-zinc-600 px-3 py-2 outline-none focus:border-primary/60 transition-colors max-h-24 overflow-y-auto leading-snug"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="shrink-0 size-9 rounded-xl bg-primary flex items-center justify-center hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          <Send className="size-4 text-white" />
        </button>
      </div>
    </div>
  )
}
