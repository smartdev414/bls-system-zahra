"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import {
  useParticipants,
  useLocalParticipant,
  useTracks,
  useDataChannel,
  useRoomContext,
  VideoTrack,
  AudioTrack,
  TrackToggle,
  isTrackReference,
} from "@livekit/components-react"
import { Track, RoomEvent } from "livekit-client"
import { cn } from "@/lib/utils"
import {
  Mic, Camera, Monitor, Hand, PhoneOff, Send, Radio, Users,
  Maximize2, Minimize2, ChevronDown, MessageSquare,
  HandMetal, Presentation, ChevronLeft, ChevronRight,
  Upload, X, Loader2,
} from "lucide-react"
import { PptSlideViewer } from "./PptSlideViewer"

// ─── Data channel topics ──────────────────────────────────────────────────────

const CHAT_TOPIC = "cls-chat"
const HAND_TOPIC = "cls-hand"
const PPT_TOPIC  = "cls-ppt"

const enc = new TextEncoder()
const dec = new TextDecoder()

const QUICK_REACTIONS = ["👍", "✋", "❓", "👏", "😮", "❤️"]

// ─── Types ────────────────────────────────────────────────────────────────────

type MsgType = "text" | "reaction" | "system"

type ChatMsg = {
  id: string
  from: string
  text: string
  ts: number
  type: MsgType
}

type RaisedHand = {
  identity: string
  name: string
}

type PptAction =
  | { action: "start";   url: string; total: number; page: number }
  | { action: "navigate"; page: number }
  | { action: "stop" }
  | { action: "sync_request" }
  | { action: "sync_response"; url: string; total: number; page: number }

// ─── Audio renderer ───────────────────────────────────────────────────────────

function AudioRenderer() {
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true })
  const { localParticipant } = useLocalParticipant()
  return (
    <>
      {tracks
        .filter((t) => t.participant.identity !== localParticipant.identity)
        .map((t) => (
          <AudioTrack key={t.participant.identity} trackRef={t} />
        ))}
    </>
  )
}

// ─── Tutor video (normal mode main area, fullscreen-capable) ──────────────────

function TutorVideoArea({
  containerRef,
  isFullscreen,
  onToggleFullscreen,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  isFullscreen: boolean
  onToggleFullscreen: () => void
}) {
  const camTracks    = useTracks([Track.Source.Camera],      { onlySubscribed: false })
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })

  const tutorCam    = camTracks.find((t) => t.participant.metadata === "tutor")
  const tutorScreen = screenTracks.find((t) => t.participant.metadata === "tutor")
  const active      = tutorScreen ?? tutorCam

  return (
    <div ref={containerRef} className="relative w-full h-full bg-zinc-950 overflow-hidden group">
      {active ? (
        <VideoTrack trackRef={active} className="w-full h-full object-contain" />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700">
          <Camera className="size-14 opacity-20" />
          <span className="text-sm opacity-60">Waiting for tutor camera…</span>
        </div>
      )}

      {active && (
        <div className="absolute bottom-12 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full">
          {active.participant.name ?? active.participant.identity}
        </div>
      )}

      <button
        onClick={onToggleFullscreen}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70 text-white rounded-lg p-1.5 backdrop-blur-sm"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  )
}

// ─── Tutor camera inset (PPT split-screen mode only) ─────────────────────────
// Shows just the tutor's camera feed so students can read BSL signs alongside slides

function TutorCameraInset() {
  const camTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const tutorCam  = camTracks.find((t) => t.participant.metadata === "tutor")
  const name      = tutorCam?.participant.name ?? tutorCam?.participant.identity ?? "Tutor"

  return (
    <div className="relative w-full h-full bg-zinc-900 overflow-hidden">
      {tutorCam ? (
        <>
          <VideoTrack trackRef={tutorCam} className="w-full h-full object-cover" />
          {/* BSL visibility badge */}
          <div className="absolute top-2 left-2 bg-amber-500/80 text-black text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm">
            BSL · {name}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
          <Camera className="size-8 opacity-20" />
          <span className="text-xs opacity-50 text-center px-2">Tutor camera off</span>
        </div>
      )}
    </div>
  )
}

// ─── Participants panel (right sidebar, sorted camera-on first) ───────────────

function ParticipantsPanel({
  pinnedId,
  onPin,
  collapsed,
  onToggleCollapse,
}: {
  pinnedId: string | null
  onPin: (identity: string | null) => void
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const { localParticipant } = useLocalParticipant()
  const allParticipants      = useParticipants()
  const camTracks            = useTracks([Track.Source.Camera])

  const withTracks = allParticipants.map((p) => {
    const trackRef = camTracks.find(
      (t) => t.participant.identity === p.identity && isTrackReference(t)
    )
    return { p, trackRef, camOn: !!trackRef }
  })

  const sorted = [...withTracks].sort((a, b) => {
    if (a.camOn !== b.camOn) return a.camOn ? -1 : 1
    if (a.p.metadata === "tutor" && b.p.metadata !== "tutor") return -1
    if (b.p.metadata === "tutor" && a.p.metadata !== "tutor") return 1
    return 0
  })

  if (collapsed) {
    return (
      <div className="flex flex-col items-center h-full bg-zinc-900">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center py-3 hover:bg-zinc-800 transition-colors"
          title="Expand Participants"
        >
          <Users className="size-4 text-primary" />
        </button>
        <div className="flex-1 flex items-center justify-center">
          <span
            className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Participants · {allParticipants.length}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <button
        onClick={onToggleCollapse}
        className="shrink-0 px-4 py-2.5 flex items-center gap-2 bg-zinc-900 border-b border-zinc-800 hover:bg-zinc-800/60 transition-colors w-full text-left"
      >
        <Users className="size-3.5 text-primary shrink-0" />
        <span className="text-xs font-bold text-white">Participants</span>
        <span className="text-[10px] text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded-full font-medium">
          {allParticipants.length}
        </span>
        <ChevronDown className="size-3.5 text-zinc-500 ml-auto" />
      </button>

      <div className="overflow-y-auto flex flex-col gap-1.5 p-2 min-h-0 flex-1">
        {sorted.map(({ p, trackRef, camOn }) => {
          const isLocal     = p.identity === localParticipant.identity
          const isPinned    = pinnedId === p.identity
          const isTutor     = p.metadata === "tutor"
          const displayName = p.name ?? p.identity

          return (
            <div
              key={p.identity}
              className={cn(
                "relative rounded-xl overflow-hidden transition-all aspect-square bg-zinc-800 border shrink-0 group",
                isTutor
                  ? "border-amber-500/30 cursor-default"
                  : isPinned
                  ? "border-primary ring-1 ring-primary/30 cursor-pointer"
                  : "border-zinc-700 hover:border-zinc-500 cursor-pointer"
              )}
            >
              {camOn && trackRef ? (
                <>
                  <VideoTrack trackRef={trackRef} className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/80 to-transparent px-2 pb-0.5 pointer-events-none">
                    <p className="text-[10px] text-white truncate font-medium">
                      {isLocal ? "You" : displayName}
                      {isTutor && <span className="ml-1 text-amber-400">• Tutor</span>}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 px-2">
                  <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg shrink-0">
                    {displayName[0]?.toUpperCase()}
                  </div>
                  <div className="text-center min-w-0 w-full">
                    <p className="text-xs font-semibold text-white truncate px-1">
                      {isLocal ? "You" : displayName}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Camera off</p>
                  </div>
                </div>
              )}

              {!isTutor && (
                <div
                  className={cn(
                    "absolute inset-0 z-10 flex items-center justify-center transition-opacity",
                    camOn ? "opacity-0 group-hover:opacity-100 bg-black/30" : "opacity-0"
                  )}
                  onClick={() => onPin(isPinned ? null : p.identity)}
                  title={isPinned ? "Click to unpin" : "Click to pin to main view"}
                >
                  {!isPinned && camOn && <Maximize2 className="size-3.5 text-white" />}
                </div>
              )}

              {isPinned && (
                <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                  Pinned
                </div>
              )}

              {isTutor && (
                <div className="absolute top-1 left-1 text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold border border-amber-500/30">
                  Tutor
                </div>
              )}
            </div>
          )
        })}

        {allParticipants.length === 0 && (
          <p className="text-xs text-zinc-600 text-center py-4">No one else here yet</p>
        )}
      </div>
    </div>
  )
}

// ─── Pinned student video (fills center area in normal mode) ──────────────────

function PinnedVideoArea({
  identity,
  containerRef,
  isFullscreen,
  onToggleFullscreen,
  onUnpin,
}: {
  identity: string
  containerRef: React.RefObject<HTMLDivElement | null>
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onUnpin: () => void
}) {
  const allParticipants = useParticipants()
  const camTracks       = useTracks([Track.Source.Camera])
  const screenTracks    = useTracks([Track.Source.ScreenShare])

  const participant = allParticipants.find((p) => p.identity === identity)
  const camRef      = camTracks.find(
    (t) => t.participant.identity === identity && isTrackReference(t)
  )
  const screenRef   = screenTracks.find(
    (t) => t.participant.identity === identity && isTrackReference(t)
  )
  const active      = screenRef ?? camRef
  const displayName = participant?.name ?? identity

  return (
    <div ref={containerRef} className="relative w-full h-full bg-zinc-950 overflow-hidden group">
      {active ? (
        <VideoTrack trackRef={active} className="w-full h-full object-contain" />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
          <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-3xl font-bold">
            {displayName[0]?.toUpperCase()}
          </div>
          <span className="text-sm">{displayName} · Camera off</span>
        </div>
      )}

      <button
        onClick={onUnpin}
        className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 hover:bg-black/80 text-white text-xs font-medium px-3 py-1.5 rounded-full backdrop-blur-sm transition-colors"
      >
        ← Tutor view
      </button>

      <div className="absolute bottom-10 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full">
        {displayName}
      </div>

      <button
        onClick={onToggleFullscreen}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70 text-white rounded-lg p-1.5 backdrop-blur-sm"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

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

function ChatPanel({
  messages,
  localName,
  raisedHands,
  onSend,
  flash,
  collapsed,
  onToggleCollapse,
}: {
  messages: ChatMsg[]
  localName: string
  raisedHands: RaisedHand[]
  onSend: (text: string, type: MsgType) => void
  flash: boolean
  collapsed: boolean
  onToggleCollapse: () => void
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
            <span key={h.identity} className="text-[11px] text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full">
              {h.name}
            </span>
          ))}
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

// ─── Tutor slide upload panel ─────────────────────────────────────────────────

function SlideUploadPanel({
  sessionId,
  onSlidesReady,
  onClose,
}: {
  sessionId: string
  onSlidesReady: (url: string, total: number) => void
  onClose: () => void
}) {
  const [uploading, setUploading]   = useState(false)
  const [progress, setProgress]     = useState("")
  const [error, setError]           = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError("")
    setUploading(true)
    setProgress("Getting upload URL…")

    try {
      // 1. Get presigned URL
      const presignRes = await fetch(`/api/tutor/sessions/${sessionId}/slides/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type }),
      })
      if (!presignRes.ok) {
        const err = await presignRes.json()
        throw new Error(err.message ?? "Could not get upload URL")
      }
      const { uploadUrl, fileUrl } = await presignRes.json()

      // 2. Upload directly to S3
      setProgress("Uploading file…")
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error("Upload to storage failed")

      // 3. Register the file in the session
      setProgress("Registering slides…")
      const registerRes = await fetch(`/api/tutor/sessions/${sessionId}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileUrl,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
        }),
      })
      if (!registerRes.ok) {
        const err = await registerRes.json()
        throw new Error(err.message ?? "Could not save slides")
      }

      // 4. Load PDF in browser to determine page count
      setProgress("Reading slide count…")
      const pdfjsLib = await import("pdfjs-dist")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
        `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

      const pdf = await pdfjsLib.getDocument(fileUrl).promise
      const total = pdf.numPages

      onSlidesReady(fileUrl, total)
    } catch (err: unknown) {
      setError((err as Error).message ?? "Upload failed")
    } finally {
      setUploading(false)
      setProgress("")
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Presentation className="size-4 text-primary" />
            <h3 className="font-bold text-sm text-white">Upload Slides</h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-4">
          Upload a PDF or PowerPoint file. Students will see your slides alongside your camera.
          For best results, export your PowerPoint as a PDF first.
        </p>

        {error && (
          <p className="text-xs text-rose-400 bg-rose-900/20 border border-rose-800/40 rounded-lg px-3 py-2 mb-4">
            {error}
          </p>
        )}

        {uploading ? (
          <div className="flex items-center gap-3 py-4 justify-center text-zinc-400">
            <Loader2 className="size-5 animate-spin text-primary" />
            <span className="text-sm">{progress}</span>
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-zinc-700 hover:border-primary/60 hover:bg-primary/5 text-zinc-400 hover:text-primary transition-all text-sm font-medium"
            >
              <Upload className="size-4" />
              Choose PDF or PPTX file
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Bottom controls bar ──────────────────────────────────────────────────────

function ControlsBar({
  isTutor,
  handRaised,
  onToggleHand,
  onLeave,
  // PPT controls (tutor only)
  pptActive,
  pptCurrentPage,
  pptTotalPages,
  onShowUpload,
  onPptNavigate,
  onPptStop,
}: {
  isTutor: boolean
  handRaised: boolean
  onToggleHand: () => void
  onLeave: () => void
  pptActive: boolean
  pptCurrentPage: number
  pptTotalPages: number
  onShowUpload: () => void
  onPptNavigate: (page: number) => void
  onPptStop: () => void
}) {
  return (
    <div className="flex items-center gap-2 shrink-0 px-3 flex-wrap">
      <TrackToggle
        source={Track.Source.Microphone}
        className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors data-[enabled=false]:bg-rose-900/50 data-[enabled=false]:text-rose-400 whitespace-nowrap"
      >
        <Mic className="size-3.5" /> Mic
      </TrackToggle>

      <TrackToggle
        source={Track.Source.Camera}
        className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors data-[enabled=false]:bg-rose-900/50 data-[enabled=false]:text-rose-400 whitespace-nowrap"
      >
        <Camera className="size-3.5" /> Camera
      </TrackToggle>

      {isTutor && (
        <TrackToggle
          source={Track.Source.ScreenShare}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors data-[enabled=true]:bg-emerald-900/50 data-[enabled=true]:text-emerald-400 whitespace-nowrap"
        >
          <Monitor className="size-3.5" /> Screen
        </TrackToggle>
      )}

      {/* ── PPT controls (tutor only) ── */}
      {isTutor && !pptActive && (
        <button
          onClick={onShowUpload}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors whitespace-nowrap"
          title="Upload and present slides"
        >
          <Presentation className="size-3.5" /> Slides
        </button>
      )}

      {isTutor && pptActive && (
        <>
          {/* Prev slide */}
          <button
            onClick={() => onPptNavigate(pptCurrentPage - 1)}
            disabled={pptCurrentPage <= 1}
            className="flex items-center justify-center size-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous slide"
          >
            <ChevronLeft className="size-4" />
          </button>

          {/* Slide counter */}
          <span className="text-xs text-zinc-400 bg-zinc-800 px-2.5 h-9 flex items-center rounded-xl whitespace-nowrap font-mono">
            {pptCurrentPage} / {pptTotalPages}
          </span>

          {/* Next slide */}
          <button
            onClick={() => onPptNavigate(pptCurrentPage + 1)}
            disabled={pptCurrentPage >= pptTotalPages}
            className="flex items-center justify-center size-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next slide"
          >
            <ChevronRight className="size-4" />
          </button>

          {/* Stop presentation */}
          <button
            onClick={onPptStop}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-amber-900/40 hover:bg-amber-900/70 text-amber-400 border border-amber-700/40 transition-colors whitespace-nowrap"
            title="Stop presenting slides"
          >
            <X className="size-3.5" /> End Slides
          </button>
        </>
      )}

      {!isTutor && (
        <button
          onClick={onToggleHand}
          className={cn(
            "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-all whitespace-nowrap",
            handRaised
              ? "bg-amber-500/30 text-amber-400 border border-amber-500/50 animate-pulse"
              : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          )}
        >
          <HandMetal className="size-3.5" />
          {handRaised ? "Lower Hand" : "Raise Hand"}
        </button>
      )}

      <button
        onClick={onLeave}
        className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors whitespace-nowrap ml-auto"
      >
        <PhoneOff className="size-3.5" /> Leave
      </button>
    </div>
  )
}

// ─── Live Captions Overlay ────────────────────────────────────────────────────

type CaptionEntry = {
  id: string
  speakerName: string
  text: string
  final: boolean
}

function CaptionsOverlay() {
  const room = useRoomContext()
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const clearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (segments: any[], participant: any) => {
      segments.forEach((seg) => {
        if (!seg.text?.trim()) return
        setCaptions((prev) => {
          const idx = prev.findIndex((c) => c.id === seg.id)
          const entry: CaptionEntry = {
            id: seg.id,
            speakerName: participant?.name ?? participant?.identity ?? "Unknown",
            text: seg.text,
            final: seg.final,
          }
          if (idx >= 0) {
            const next = [...prev]; next[idx] = entry; return next
          }
          return [...prev.slice(-1), entry]
        })
        if (seg.final) {
          const existing = clearTimers.current.get(seg.id)
          if (existing) clearTimeout(existing)
          clearTimers.current.set(seg.id, setTimeout(() => {
            setCaptions((prev) => prev.filter((c) => c.id !== seg.id))
            clearTimers.current.delete(seg.id)
          }, 4000))
        }
      })
    }

    room.on(RoomEvent.TranscriptionReceived, handler)
    return () => {
      room.off(RoomEvent.TranscriptionReceived, handler)
      clearTimers.current.forEach(clearTimeout)
    }
  }, [room])

  const visible = captions.filter((c) => c.text.trim())
  if (visible.length === 0) return null

  return (
    <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none z-20 px-6">
      <div className="bg-black/80 backdrop-blur-sm rounded-2xl px-5 py-3 max-w-2xl w-full flex flex-col gap-1.5">
        {visible.map((c) => (
          <p key={c.id} className="text-sm leading-snug text-white">
            <span className="font-semibold text-amber-400 mr-1.5">{c.speakerName}:</span>
            {c.text}
          </p>
        ))}
      </div>
    </div>
  )
}

// ─── Main ClassroomRoom ───────────────────────────────────────────────────────

export function ClassroomRoom({
  isTutor,
  sessionId,
  sessionTitle,
  onLeave,
}: {
  isTutor: boolean
  sessionId: string
  sessionTitle: string
  onLeave: () => void
}) {
  const { localParticipant } = useLocalParticipant()
  const participants          = useParticipants()

  const localName = localParticipant.name ?? localParticipant.identity

  // ── Chat / hand state ──────────────────────────────────────────────────────
  const [messages,         setMessages]         = useState<ChatMsg[]>([])
  const [raisedHands,      setRaisedHands]      = useState<RaisedHand[]>([])
  const [handRaised,       setHandRaised]       = useState(false)
  const [chatFlash,        setChatFlash]        = useState(false)
  const [isFullscreen,     setIsFullscreen]     = useState(false)
  const [pinnedId,         setPinnedId]         = useState<string | null>(null)
  const [participantsOpen, setParticipantsOpen] = useState(true)
  const [chatOpen,         setChatOpen]         = useState(true)

  // ── PPT state ──────────────────────────────────────────────────────────────
  const [pptActive,      setPptActive]      = useState(false)
  const [pptUrl,         setPptUrl]         = useState<string | null>(null)
  const [pptCurrentPage, setPptCurrentPage] = useState(1)
  const [pptTotalPages,  setPptTotalPages]  = useState(0)
  const [showUpload,     setShowUpload]     = useState(false)

  // Refs used for sync_response when participants join late
  const pptStateRef = useRef({ active: false, url: "", total: 0, page: 1 })

  const videoContainerRef = useRef<HTMLDivElement>(null)

  // ── Data channel: chat ─────────────────────────────────────────────────────

  const { send: sendChat } = useDataChannel(CHAT_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as Omit<ChatMsg, "id">
      setMessages((prev) => [...prev, { ...data, id: `${Date.now()}-${Math.random()}` }])
      setChatFlash(true)
      setTimeout(() => setChatFlash(false), 800)
    } catch { /* ignore malformed */ }
  })

  // ── Data channel: hand raise ───────────────────────────────────────────────

  const { send: sendHand } = useDataChannel(HAND_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as { identity: string; name: string; raised: boolean }
      setRaisedHands((prev) => {
        if (data.raised) {
          if (prev.find((h) => h.identity === data.identity)) return prev
          return [...prev, { identity: data.identity, name: data.name }]
        }
        return prev.filter((h) => h.identity !== data.identity)
      })
      if (isTutor) {
        if (data.raised) setPinnedId(data.identity)
        else setPinnedId((prev) => prev === data.identity ? null : prev)
      }
      const text = data.raised ? `${data.name} raised their hand ✋` : `${data.name} lowered their hand`
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, from: "system", text, ts: Date.now(), type: "system" },
      ])
    } catch { /* ignore */ }
  })

  // ── Data channel: PPT sync ─────────────────────────────────────────────────

  const { send: sendPpt } = useDataChannel(PPT_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as PptAction

      if (data.action === "start") {
        setPptUrl(data.url)
        setPptTotalPages(data.total)
        setPptCurrentPage(data.page)
        setPptActive(true)
        // Collapse participants to give slides more room
        setParticipantsOpen(false)
        return
      }

      if (data.action === "navigate") {
        setPptCurrentPage(data.page)
        return
      }

      if (data.action === "stop") {
        setPptActive(false)
        setPptUrl(null)
        setPptCurrentPage(1)
        setPptTotalPages(0)
        setParticipantsOpen(true)
        return
      }

      // Student joined late and is requesting the current slide state
      if (data.action === "sync_request" && isTutor) {
        const state = pptStateRef.current
        if (!state.active) return
        const response: PptAction = {
          action: "sync_response",
          url: state.url,
          total: state.total,
          page: state.page,
        }
        sendPpt(enc.encode(JSON.stringify(response)), { reliable: true })
        return
      }

      // Tutor responded to our sync request
      if (data.action === "sync_response" && !isTutor) {
        setPptUrl(data.url)
        setPptTotalPages(data.total)
        setPptCurrentPage(data.page)
        setPptActive(true)
        setParticipantsOpen(false)
      }
    } catch { /* ignore malformed */ }
  })

  // Keep pptStateRef in sync so sync_response handler has current values
  useEffect(() => {
    pptStateRef.current = {
      active: pptActive,
      url: pptUrl ?? "",
      total: pptTotalPages,
      page: pptCurrentPage,
    }
  }, [pptActive, pptUrl, pptTotalPages, pptCurrentPage])

  // ── Student: request sync when first joining ───────────────────────────────
  // Sends a sync_request after a short delay so the tutor's data channel listener is ready
  const hasSentSyncRequest = useRef(false)
  useEffect(() => {
    if (isTutor || hasSentSyncRequest.current) return
    const timer = setTimeout(() => {
      hasSentSyncRequest.current = true
      const req: PptAction = { action: "sync_request" }
      sendPpt(enc.encode(JSON.stringify(req)), { reliable: true })
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor])

  // ── Fullscreen ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      videoContainerRef.current?.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }, [])

  // ── Chat handler ───────────────────────────────────────────────────────────

  const handleSend = useCallback(
    (text: string, type: MsgType) => {
      const msg: Omit<ChatMsg, "id"> = { from: localName, text, ts: Date.now(), type }
      sendChat(enc.encode(JSON.stringify(msg)), { reliable: true })
      setMessages((prev) => [...prev, { ...msg, id: `local-${Date.now()}` }])
    },
    [localName, sendChat]
  )

  // ── Hand raise handler ─────────────────────────────────────────────────────

  const handleToggleHand = useCallback(() => {
    const next = !handRaised
    setHandRaised(next)
    const evt = { identity: localParticipant.identity, name: localName, raised: next }
    sendHand(enc.encode(JSON.stringify(evt)), { reliable: true })
    setRaisedHands((prev) => {
      if (next) {
        if (prev.find((h) => h.identity === localParticipant.identity)) return prev
        return [...prev, { identity: localParticipant.identity, name: localName }]
      }
      return prev.filter((h) => h.identity !== localParticipant.identity)
    })
  }, [handRaised, localParticipant.identity, localName, sendHand])

  // ── PPT handlers (tutor only) ──────────────────────────────────────────────

  const handleSlidesReady = useCallback((url: string, total: number) => {
    setShowUpload(false)
    setPptUrl(url)
    setPptTotalPages(total)
    setPptCurrentPage(1)
    setPptActive(true)
    setParticipantsOpen(false)

    const evt: PptAction = { action: "start", url, total, page: 1 }
    sendPpt(enc.encode(JSON.stringify(evt)), { reliable: true })

    setMessages((prev) => [
      ...prev,
      {
        id: `sys-ppt-${Date.now()}`,
        from: "system",
        text: "Tutor started a slide presentation 📊",
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [sendPpt])

  const handlePptNavigate = useCallback((page: number) => {
    if (page < 1 || page > pptTotalPages) return
    setPptCurrentPage(page)
    const evt: PptAction = { action: "navigate", page }
    sendPpt(enc.encode(JSON.stringify(evt)), { reliable: true })
  }, [pptTotalPages, sendPpt])

  const handlePptStop = useCallback(() => {
    setPptActive(false)
    setPptUrl(null)
    setPptCurrentPage(1)
    setPptTotalPages(0)
    setParticipantsOpen(true)

    const evt: PptAction = { action: "stop" }
    sendPpt(enc.encode(JSON.stringify(evt)), { reliable: true })

    setMessages((prev) => [
      ...prev,
      {
        id: `sys-ppt-end-${Date.now()}`,
        from: "system",
        text: "Slide presentation ended",
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [sendPpt])

  // ── Keyboard shortcuts for slide navigation ────────────────────────────────
  useEffect(() => {
    if (!isTutor || !pptActive) return
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        handlePptNavigate(pptCurrentPage + 1)
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        handlePptNavigate(pptCurrentPage - 1)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isTutor, pptActive, pptCurrentPage, handlePptNavigate])

  const studentCount = participants.filter((p) => p.metadata !== "tutor").length

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white flex flex-col overflow-hidden z-50">
      <AudioRenderer />

      {/* ── Upload panel overlay (tutor only) ── */}
      {showUpload && isTutor && (
        <SlideUploadPanel
          sessionId={sessionId}
          onSlidesReady={handleSlidesReady}
          onClose={() => setShowUpload(false)}
        />
      )}

      {/* ── Top bar ── */}
      <header className="h-11 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <Radio className="size-3.5 text-rose-500 animate-pulse shrink-0" />
          <span className="font-bold text-sm truncate max-w-xs">{sessionTitle}</span>
          {pptActive && (
            <span className="flex items-center gap-1 text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold">
              <Presentation className="size-3" />
              Presenting
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-800 px-2.5 py-1 rounded-full">
            <Users className="size-3" />
            {studentCount} student{studentCount !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-zinc-500 hidden sm:block">{localName}</span>
        </div>
      </header>

      {/* ── Main body ── */}
      <div className="flex flex-1 overflow-hidden">

        {pptActive && pptUrl ? (
          // ── PPT mode: split view (slides + tutor camera) ──────────────────
          <>
            {/* Slide viewer — 50% width */}
            <div className="w-1/2 shrink-0 overflow-hidden relative">
              <PptSlideViewer
                fileUrl={pptUrl}
                currentPage={pptCurrentPage}
                onTotalPages={(total) => {
                  if (total !== pptTotalPages) setPptTotalPages(total)
                }}
              />
              {/* Slide number badge */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none">
                Slide {pptCurrentPage} of {pptTotalPages}
              </div>
              {/* Captions in PPT mode */}
              <CaptionsOverlay />
            </div>

            {/* Tutor camera panel — 50% width, always visible for BSL signs */}
            <div className="w-1/2 border-l border-zinc-800 flex flex-col overflow-hidden">
              {/* Camera area */}
              <div className="flex-1 overflow-hidden bg-zinc-900 relative">
                <TutorCameraInset />
              </div>
              {/* BSL indicator label */}
              <div className="shrink-0 px-3 py-2 bg-zinc-900 border-t border-zinc-800 text-center">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                  Tutor · Sign Language
                </span>
              </div>
            </div>
          </>
        ) : (
          // ── Normal mode: full tutor video / pinned student ────────────────
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <div className="flex-1 overflow-hidden">
              {pinnedId ? (
                <PinnedVideoArea
                  identity={pinnedId}
                  containerRef={videoContainerRef}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={toggleFullscreen}
                  onUnpin={() => setPinnedId(null)}
                />
              ) : (
                <TutorVideoArea
                  containerRef={videoContainerRef}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={toggleFullscreen}
                />
              )}
            </div>
            <CaptionsOverlay />
          </div>
        )}

        {/* Participants column — collapsible */}
        <div className={cn(
          "flex flex-col h-full overflow-hidden border-l border-zinc-800 transition-all duration-200",
          participantsOpen ? "w-72" : "w-10"
        )}>
          <ParticipantsPanel
            pinnedId={pinnedId}
            onPin={setPinnedId}
            collapsed={!participantsOpen}
            onToggleCollapse={() => setParticipantsOpen((v) => !v)}
          />
        </div>

        {/* Chat column — collapsible */}
        <div className={cn(
          "flex flex-col h-full overflow-hidden border-l border-zinc-800 transition-all duration-200",
          chatOpen ? "w-72" : "w-10"
        )}>
          <ChatPanel
            messages={messages}
            localName={localName}
            raisedHands={raisedHands}
            onSend={handleSend}
            flash={chatFlash}
            collapsed={!chatOpen}
            onToggleCollapse={() => setChatOpen((v) => !v)}
          />
        </div>
      </div>

      {/* ── Bottom controls row ── */}
      <div className="h-12 bg-zinc-950 border-t border-zinc-800/60 shrink-0 flex items-center px-3 gap-2">
        <ControlsBar
          isTutor={isTutor}
          handRaised={handRaised}
          onToggleHand={handleToggleHand}
          onLeave={onLeave}
          pptActive={pptActive}
          pptCurrentPage={pptCurrentPage}
          pptTotalPages={pptTotalPages}
          onShowUpload={() => setShowUpload(true)}
          onPptNavigate={handlePptNavigate}
          onPptStop={handlePptStop}
        />
      </div>
    </div>
  )
}
