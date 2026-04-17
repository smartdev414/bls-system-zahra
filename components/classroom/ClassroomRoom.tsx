"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import {
  useParticipants,
  useLocalParticipant,
  useTracks,
  useDataChannel,
  useRoomContext,
  useConnectionState,
  VideoTrack,
  AudioTrack,
  TrackToggle,
  isTrackReference,
} from "@livekit/components-react"
import { Track, RoomEvent, ConnectionState } from "livekit-client"
import { cn } from "@/lib/utils"
import {
  Mic, Camera, Monitor, Hand, PhoneOff, Send, Radio, Users,
  Maximize2, Minimize2, ChevronDown, MessageSquare,
  HandMetal, Presentation, ChevronLeft, ChevronRight,
  Upload, X, Loader2, MousePointer2, UserPlus, Check, XCircle,
  ArrowLeft, Megaphone, Info,
} from "lucide-react"
import { toast } from "sonner"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"
import { PptSlideViewer } from "./PptSlideViewer"

// ─── Data channel topics ──────────────────────────────────────────────────────

const CHAT_TOPIC      = "cls-chat"
const HAND_TOPIC      = "cls-hand"
const PPT_TOPIC       = "cls-ppt"
const POINTER_TOPIC   = "cls-pointer"
const SPOTLIGHT_TOPIC = "cls-spotlight"

const POINTER_SEND_INTERVAL_MS = 50  // throttle pointer moves to ~20 fps
const POINTER_AUTO_HIDE_MS     = 1500

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

type JoinRequest = {
  id: string
  student: { id: string; name: string; email: string; avatarUrl: string | null }
  message: string | null
  status: "PENDING" | "APPROVED" | "REJECTED"
  responseMessage: string | null
  createdAt: string
  respondedAt: string | null
}

type PptAction =
  | { action: "start";   url: string; total: number; page: number }
  | { action: "navigate"; page: number }
  | { action: "stop" }
  | { action: "sync_request" }
  | { action: "sync_response"; url: string; total: number; page: number }

type PointerAction =
  | { action: "move"; x: number; y: number }  // x,y are 0-1 normalized slide coords
  | { action: "hide" }

type SpotlightAction =
  | { action: "set"; identity: string }  // tutor broadcasts: everyone pins this participant
  | { action: "clear" }                  // tutor broadcasts: everyone unpins
  | { action: "sync_request" }           // late-joining student asks the tutor
  | { action: "sync_response"; identity: string | null }

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
      <button
        onClick={onToggleCollapse}
        className="h-full w-full flex items-center justify-start gap-2 bg-zinc-900 hover:bg-zinc-800/60 transition-colors px-4 text-left"
        title="Expand Participants"
      >
        <Users className="size-3.5 text-primary shrink-0" />
        <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
          Participants · {allParticipants.length}
        </span>
        <ChevronDown className="size-3 text-zinc-500 rotate-180 ml-1" />
      </button>
    )
  }

  return (
    <div className="flex items-stretch h-full min-w-0 overflow-hidden bg-zinc-900">
      <button
        onClick={onToggleCollapse}
        className="shrink-0 w-36 px-3 flex flex-col justify-center border-r border-zinc-800 hover:bg-zinc-800/60 transition-colors text-left"
      >
        <div className="flex items-center gap-1.5">
          <Users className="size-3.5 text-primary shrink-0" />
          <span className="text-xs font-bold text-white">Participants</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-zinc-400">
          <span className="text-[10px]">{allParticipants.length} in room</span>
          <ChevronDown className="size-3 text-zinc-500 ml-auto" />
        </div>
      </button>

      <div className="overflow-x-auto flex items-center gap-2 px-2 py-2 min-w-0 flex-1">
        {sorted.map(({ p, trackRef, camOn }) => {
          const isLocal     = p.identity === localParticipant.identity
          const isPinned    = pinnedId === p.identity
          const isTutor     = p.metadata === "tutor"
          const displayName = p.name ?? p.identity

          return (
            <div
              key={p.identity}
              className={cn(
                "relative rounded-xl overflow-hidden transition-all h-full aspect-square bg-zinc-800 border shrink-0 group",
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
                  <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/80 to-transparent px-1.5 pb-0.5 pointer-events-none">
                    <p className="text-[9px] text-white truncate font-medium">
                      {isLocal ? "You" : displayName}
                      {isTutor && <span className="ml-0.5 text-amber-400">•</span>}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-1 px-1">
                  <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {displayName[0]?.toUpperCase()}
                  </div>
                  <p className="text-[9px] font-semibold text-white truncate max-w-full px-1">
                    {isLocal ? "You" : displayName}
                  </p>
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
                <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-[8px] px-1.5 py-0.5 rounded-full font-bold">
                  Pinned
                </div>
              )}

              {isTutor && (
                <div className="absolute top-1 left-1 text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold border border-amber-500/30">
                  Tutor
                </div>
              )}
            </div>
          )
        })}

        {allParticipants.length === 0 && (
          <p className="text-xs text-zinc-600 px-3 whitespace-nowrap">No one else here yet</p>
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
  // Tutor-only spotlight controls
  showSpotlight,
  spotlightActive,
  onToggleSpotlight,
}: {
  identity: string
  containerRef: React.RefObject<HTMLDivElement | null>
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onUnpin: () => void
  showSpotlight?: boolean
  spotlightActive?: boolean
  onToggleSpotlight?: () => void
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

      <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
        <button
          onClick={onUnpin}
          className="flex items-center gap-1.5 bg-black/70 hover:bg-black/90 text-white text-xs font-semibold px-3 py-2 rounded-full backdrop-blur-sm transition-colors shadow-lg ring-1 ring-white/10"
          title="Back to tutor — return to the tutor's camera view"
          aria-label="Unpin and return to tutor view"
        >
          <ArrowLeft className="size-3.5" />
          Back to tutor
        </button>

        {showSpotlight && (
          <button
            onClick={onToggleSpotlight}
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full backdrop-blur-sm transition-colors shadow-lg ring-1",
              spotlightActive
                ? "bg-amber-400 hover:bg-amber-300 text-black ring-amber-200/60 animate-pulse"
                : "bg-primary/90 hover:bg-primary text-primary-foreground ring-white/10"
            )}
            title={
              spotlightActive
                ? "Click to stop — every student will return to the tutor view"
                : "Click to show this camera on every student's screen"
            }
            aria-label={spotlightActive ? "Stop broadcasting to class" : "Broadcast this camera to the whole class"}
            aria-pressed={spotlightActive}
          >
            {spotlightActive ? (
              <>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-600 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-rose-600" />
                </span>
                Sharing with class — click to stop
              </>
            ) : (
              <>
                <Megaphone className="size-3.5" />
                Show to whole class
              </>
            )}
          </button>
        )}

        {/* Discoverability hint: only shown when spotlight is available but not active */}
        {showSpotlight && !spotlightActive && (
          <span
            className="hidden md:flex items-center gap-1 text-[10px] text-white/70 bg-black/40 px-2 py-1 rounded-full backdrop-blur-sm pointer-events-none"
            aria-hidden
          >
            <Info className="size-3" />
            Only you see this camera until you click &ldquo;Show to whole class&rdquo;
          </span>
        )}
      </div>

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
  previousSlides,
}: {
  sessionId: string
  onSlidesReady: (url: string, total: number) => void
  onClose: () => void
  previousSlides: { url: string; total: number } | null
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

      // 4. Determine slide/page count
      setProgress("Reading slide count…")
      const isPdf = file.type === "application/pdf"
      let total: number

      if (isPdf) {
        const pdfjsLib = await import("pdfjs-dist")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
          `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        total = pdf.numPages
      } else {
        // PPTX: count slides by inspecting the ZIP structure
        const JSZip = (await import("jszip")).default
        const zip = await JSZip.loadAsync(file)
        const slideFiles = Object.keys(zip.files).filter(
          (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)
        )
        total = slideFiles.length || 1
      }

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

            {previousSlides && (
              <button
                onClick={() => onSlidesReady(previousSlides.url, previousSlides.total)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-all text-sm font-medium mt-3"
              >
                <Presentation className="size-4" />
                Resume previous slides
              </button>
            )}
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
  // Pointer (tutor only, active during slide presentation)
  pointerMode,
  onTogglePointer,
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
  pointerMode: boolean
  onTogglePointer: () => void
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

          {/* Finger pointer toggle */}
          <button
            onClick={onTogglePointer}
            className={cn(
              "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border",
              pointerMode
                ? "bg-amber-500/25 text-amber-300 border-amber-500/50 animate-pulse"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent"
            )}
            title={pointerMode ? "Turn off finger pointer" : "Point at things on the slide — students will see a 👆 follow your cursor"}
          >
            <MousePointer2 className="size-3.5" />
            {pointerMode ? "Pointing" : "Pointer"}
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

// ─── Join Requests Popover (tutor only) ───────────────────────────────────────

function JoinRequestsPopover({
  requests,
  loading,
  onAction,
  onClose,
}: {
  requests: JoinRequest[]
  loading: boolean
  onAction: (requestId: string, action: "approve" | "reject", message?: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl z-50 flex flex-col"
    >
      <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
          <UserPlus className="size-3.5 text-amber-400" />
          Join Requests {requests.length > 0 && (
            <span className="text-amber-400">({requests.length})</span>
          )}
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {requests.length === 0 ? (
          <div className="py-10 px-4 text-center text-xs text-zinc-500">
            No pending requests.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {requests.map((r) => (
              <JoinRequestRow key={r.id} request={r} disabled={loading} onAction={onAction} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function JoinRequestRow({
  request,
  disabled,
  onAction,
}: {
  request: JoinRequest
  disabled: boolean
  onAction: (requestId: string, action: "approve" | "reject", message?: string) => void
}) {
  const initials = request.student.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <div className="size-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[11px] font-bold shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-zinc-100 truncate">{request.student.name}</p>
          <p className="text-[10px] text-zinc-500 truncate">{request.student.email}</p>
          {request.message && (
            <p className="mt-1.5 text-[11px] text-zinc-300 bg-zinc-800/60 rounded-md px-2 py-1.5 leading-snug">
              &ldquo;{request.message}&rdquo;
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 justify-end">
        <button
          disabled={disabled}
          onClick={() => onAction(request.id, "reject")}
          className="h-6 px-2 text-[11px] rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-1"
        >
          <XCircle className="size-3" /> Decline
        </button>
        <button
          disabled={disabled}
          onClick={() => onAction(request.id, "approve")}
          className="h-6 px-2 text-[11px] rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 flex items-center gap-1"
        >
          <Check className="size-3" /> Approve
        </button>
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
  const connectionState       = useConnectionState()

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
  const [requestsOpen,     setRequestsOpen]     = useState(false)

  // ── Join requests (tutor only) ─────────────────────────────────────────────
  const { data: requestsData, refetch: refetchRequests } = useFetch<{ requests: JoinRequest[] }>(
    `/api/tutor/sessions/${sessionId}/requests`,
    { errorMessage: false, immediate: isTutor }
  )
  const pendingRequests = useMemo(
    () => requestsData?.requests.filter((r) => r.status === "PENDING") ?? [],
    [requestsData]
  )
  const lastSeenPendingIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!isTutor) return
    const seen = lastSeenPendingIdsRef.current
    const newOnes = pendingRequests.filter((r) => !seen.has(r.id))
    if (seen.size > 0 && newOnes.length > 0) {
      newOnes.forEach((r) => {
        toast.info(`${r.student.name} wants to join`, {
          action: { label: "Open", onClick: () => setRequestsOpen(true) },
        })
      })
    }
    lastSeenPendingIdsRef.current = new Set(pendingRequests.map((r) => r.id))
  }, [pendingRequests, isTutor])
  useEffect(() => {
    if (!isTutor) return
    const interval = setInterval(() => refetchRequests(), 8000)
    return () => clearInterval(interval)
  }, [isTutor, refetchRequests])

  const { execute: respondToRequest, loading: respondingToRequest } = usePatchCallback<
    { message: string },
    { requestId: string; action: "approve" | "reject"; message?: string }
  >(`/api/tutor/sessions/${sessionId}/requests`, {
    successMessage: (d) => d.message,
    errorMessage: "Could not process request",
    onSuccess: () => refetchRequests(),
  })

  // ── PPT state ──────────────────────────────────────────────────────────────
  const [pptActive,      setPptActive]      = useState(false)
  const [pptUrl,         setPptUrl]         = useState<string | null>(null)
  const [pptCurrentPage, setPptCurrentPage] = useState(1)
  const [pptTotalPages,  setPptTotalPages]  = useState(0)
  const [showUpload,     setShowUpload]     = useState(false)

  // ── Finger pointer state ───────────────────────────────────────────────────
  // Tutor toggles pointer mode; coords are normalized (0-1) against the slide area.
  const [pointerMode,   setPointerMode]   = useState(false)
  const [livePointer,   setLivePointer]   = useState<{ x: number; y: number } | null>(null)
  const slideAreaRef    = useRef<HTMLDivElement>(null)
  const lastPointerSent = useRef(0)
  const pointerHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Spotlight state (tutor-initiated, seen by everyone) ───────────────────
  // When non-null, all students auto-pin this participant. Independent from local pinning.
  const [spotlightedId, setSpotlightedId] = useState<string | null>(null)
  const spotlightRef = useRef<string | null>(null)
  // Remember uploaded slides so tutor can resume without re-uploading
  const uploadedSlidesRef = useRef<{ url: string; total: number } | null>(null)

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

  // ── Data channel: finger pointer ───────────────────────────────────────────
  // Tutor broadcasts cursor position over the slide; everyone else renders it.

  const { send: sendPointer } = useDataChannel(POINTER_TOPIC, (msg) => {
    if (isTutor) return  // tutor drives the pointer, no need to react to own echoes
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as PointerAction
      if (data.action === "move") {
        setLivePointer({ x: data.x, y: data.y })
        // Auto-hide if the tutor's "hide" packet is dropped (e.g. tab switch)
        if (pointerHideTimer.current) clearTimeout(pointerHideTimer.current)
        pointerHideTimer.current = setTimeout(() => setLivePointer(null), POINTER_AUTO_HIDE_MS)
      } else if (data.action === "hide") {
        setLivePointer(null)
        if (pointerHideTimer.current) clearTimeout(pointerHideTimer.current)
      }
    } catch { /* ignore malformed */ }
  })

  // Turn the pointer off automatically when slides stop
  useEffect(() => {
    if (!pptActive && pointerMode) setPointerMode(false)
    if (!pptActive) setLivePointer(null)
  }, [pptActive, pointerMode])

  // ── Data channel: spotlight ─────────────────────────────────────────────────
  // Tutor can force every student to pin a particular participant.

  const { send: sendSpotlight } = useDataChannel(SPOTLIGHT_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as SpotlightAction

      if (data.action === "set") {
        setSpotlightedId(data.identity)
        if (!isTutor) setPinnedId(data.identity)
        return
      }
      if (data.action === "clear") {
        setSpotlightedId(null)
        if (!isTutor) setPinnedId((prev) => (prev === spotlightRef.current ? null : prev))
        return
      }
      if (data.action === "sync_request" && isTutor) {
        const current = spotlightRef.current
        const response: SpotlightAction = current
          ? { action: "sync_response", identity: current }
          : { action: "sync_response", identity: null }
        try {
          sendSpotlight(enc.encode(JSON.stringify(response)), { reliable: true })
        } catch { /* ignore */ }
        return
      }
      if (data.action === "sync_response" && !isTutor) {
        if (data.identity) {
          setSpotlightedId(data.identity)
          setPinnedId(data.identity)
        }
        return
      }
    } catch { /* ignore malformed */ }
  })

  // Keep spotlightRef in sync so data channel handler sees current value
  useEffect(() => {
    spotlightRef.current = spotlightedId
  }, [spotlightedId])

  // Student: ask the tutor for current spotlight when joining
  const hasSentSpotlightSync = useRef(false)
  useEffect(() => {
    if (isTutor || hasSentSpotlightSync.current) return
    if (connectionState !== ConnectionState.Connected) return
    const timer = setTimeout(() => {
      hasSentSpotlightSync.current = true
      try {
        sendSpotlight(enc.encode(JSON.stringify({ action: "sync_request" })), { reliable: true })
      } catch {
        hasSentSpotlightSync.current = false
      }
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState])

  // If the spotlighted participant leaves the room, clear the spotlight
  useEffect(() => {
    if (!spotlightedId) return
    const stillHere = participants.some((p) => p.identity === spotlightedId)
    if (!stillHere) {
      setSpotlightedId(null)
      if (!isTutor) setPinnedId((prev) => (prev === spotlightedId ? null : prev))
    }
  }, [participants, spotlightedId, isTutor])

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
    if (connectionState !== ConnectionState.Connected) return
    const timer = setTimeout(() => {
      hasSentSyncRequest.current = true
      const req: PptAction = { action: "sync_request" }
      try {
        sendPpt(enc.encode(JSON.stringify(req)), { reliable: true })
      } catch {
        // Data channel not ready yet — will sync on next PPT action from tutor
        hasSentSyncRequest.current = false
      }
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState])

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

  const safeSendPpt = useCallback((data: PptAction) => {
    if (connectionState !== ConnectionState.Connected) return
    if (typeof sendPpt !== "function") return
    try {
      const result = sendPpt(enc.encode(JSON.stringify(data)), { reliable: true }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore transient LiveKit errors */ })
      }
    } catch {
      // Connection may have dropped — ignore silently
    }
  }, [connectionState, sendPpt])

  const handleSlidesReady = useCallback((url: string, total: number) => {
    setShowUpload(false)
    uploadedSlidesRef.current = { url, total }
    setPptUrl(url)
    setPptTotalPages(total)
    setPptCurrentPage(1)
    setPptActive(true)
    setParticipantsOpen(false)

    safeSendPpt({ action: "start", url, total, page: 1 })

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
  }, [safeSendPpt])

  const handlePptNavigate = useCallback((page: number) => {
    if (page < 1 || page > pptTotalPages) return
    setPptCurrentPage(page)
    safeSendPpt({ action: "navigate", page })
  }, [pptTotalPages, safeSendPpt])

  // ── Finger pointer handlers (tutor only) ───────────────────────────────────

  const safeSendPointer = useCallback((data: PointerAction) => {
    if (connectionState !== ConnectionState.Connected) return
    if (typeof sendPointer !== "function") return
    try {
      // sendPointer returns a Promise — swallow both sync throws and async rejections.
      const result = sendPointer(enc.encode(JSON.stringify(data)), {
        reliable: data.action === "hide",
      }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore transient LiveKit errors */ })
      }
    } catch { /* silently ignore — connection may have dropped */ }
  }, [connectionState, sendPointer])

  const handleTogglePointer = useCallback(() => {
    const next = !pointerMode
    setPointerMode(next)
    if (!next) {
      setLivePointer(null)
      safeSendPointer({ action: "hide" })
    }
  }, [pointerMode, safeSendPointer])

  const handleSlidePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTutor || !pointerMode) return
    const host = slideAreaRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top)  / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return

    setLivePointer({ x, y })

    const now = Date.now()
    if (now - lastPointerSent.current < POINTER_SEND_INTERVAL_MS) return
    lastPointerSent.current = now
    safeSendPointer({ action: "move", x, y })
  }, [isTutor, pointerMode, safeSendPointer])

  const handleSlidePointerLeave = useCallback(() => {
    if (!isTutor || !pointerMode) return
    setLivePointer(null)
    safeSendPointer({ action: "hide" })
  }, [isTutor, pointerMode, safeSendPointer])

  // ── Spotlight handler (tutor only) ─────────────────────────────────────────

  const safeSendSpotlight = useCallback((data: SpotlightAction) => {
    if (connectionState !== ConnectionState.Connected) return
    if (typeof sendSpotlight !== "function") return
    try {
      const result = sendSpotlight(enc.encode(JSON.stringify(data)), { reliable: true }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore */ })
      }
    } catch { /* ignore */ }
  }, [connectionState, sendSpotlight])

  const handleToggleSpotlight = useCallback(() => {
    if (!isTutor || !pinnedId) return
    if (spotlightedId === pinnedId) {
      setSpotlightedId(null)
      safeSendSpotlight({ action: "clear" })
    } else {
      setSpotlightedId(pinnedId)
      safeSendSpotlight({ action: "set", identity: pinnedId })
    }
  }, [isTutor, pinnedId, spotlightedId, safeSendSpotlight])

  // If the tutor unpins locally, stop any spotlight they were running
  useEffect(() => {
    if (!isTutor) return
    if (spotlightedId && pinnedId !== spotlightedId) {
      setSpotlightedId(null)
      safeSendSpotlight({ action: "clear" })
    }
  }, [isTutor, pinnedId, spotlightedId, safeSendSpotlight])

  const handlePptStop = useCallback(() => {
    setPptActive(false)
    setPptCurrentPage(1)
    setParticipantsOpen(true)

    safeSendPpt({ action: "stop" })

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
  }, [safeSendPpt])

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
          previousSlides={uploadedSlidesRef.current}
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
          {isTutor && (
            <div className="relative">
              <button
                onClick={() => setRequestsOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors",
                  pendingRequests.length > 0
                    ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                )}
                aria-label="Join requests"
              >
                <UserPlus className="size-3" />
                <span className="hidden sm:inline">Requests</span>
                {pendingRequests.length > 0 && (
                  <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-[10px] font-bold text-zinc-950 flex items-center justify-center">
                    {pendingRequests.length}
                  </span>
                )}
              </button>
              {requestsOpen && (
                <JoinRequestsPopover
                  requests={pendingRequests}
                  loading={respondingToRequest}
                  onAction={(requestId, action, message) =>
                    respondToRequest({ requestId, action, message })
                  }
                  onClose={() => setRequestsOpen(false)}
                />
              )}
            </div>
          )}
          <span className="flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-800 px-2.5 py-1 rounded-full">
            <Users className="size-3" />
            {studentCount} student{studentCount !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-zinc-500 hidden sm:block">{localName}</span>
        </div>
      </header>

      {/* ── Main body ── */}
      <div className="flex flex-1 overflow-hidden flex-col min-h-0">

        {/* Top row: slides / video + chat sidebar */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {pptActive && pptUrl ? (
            // ── PPT mode: Deaf-culture convention — signer on the LEFT, content on the RIGHT.
            // Both panels are 50% width and identical height (no extra footer rows).
            // When a student is pinned, their camera takes over the LEFT panel;
            // unpin returns to the tutor camera for BSL signing.
            <>
              {/* Camera panel — LEFT. Pinned student if set, otherwise tutor for BSL */}
              <div className="flex-1 min-w-0 basis-0 overflow-hidden bg-zinc-900 relative">
                {pinnedId ? (
                  <PinnedVideoArea
                    identity={pinnedId}
                    containerRef={videoContainerRef}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={toggleFullscreen}
                    onUnpin={() => setPinnedId(null)}
                    showSpotlight={isTutor && pinnedId !== localParticipant.identity}
                    spotlightActive={spotlightedId === pinnedId}
                    onToggleSpotlight={handleToggleSpotlight}
                  />
                ) : (
                  <TutorCameraInset />
                )}
              </div>

              {/* Slide viewer — RIGHT */}
              <div
                ref={slideAreaRef}
                className="flex-1 min-w-0 basis-0 overflow-hidden relative border-l border-zinc-800"
                onPointerMove={handleSlidePointerMove}
                onPointerLeave={handleSlidePointerLeave}
                style={isTutor && pointerMode ? { cursor: "none" } : undefined}
              >
                <PptSlideViewer
                  fileUrl={pptUrl}
                  currentPage={pptCurrentPage}
                  onTotalPages={(total) => {
                    if (total !== pptTotalPages) setPptTotalPages(total)
                  }}
                />

                {/* Finger pointer overlay — shown to everyone while tutor is pointing */}
                {livePointer && (
                  <div
                    className="absolute pointer-events-none z-40"
                    style={{
                      left: `${livePointer.x * 100}%`,
                      top:  `${livePointer.y * 100}%`,
                      transform: "translate(-18%, -6%)",
                      filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.85))",
                      transition: isTutor ? "none" : "left 60ms linear, top 60ms linear",
                    }}
                    aria-hidden
                  >
                    <span className="text-5xl leading-none select-none">👆</span>
                  </div>
                )}

                {/* Slide number badge */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none">
                  Slide {pptCurrentPage} of {pptTotalPages}
                </div>
                {/* Captions in PPT mode */}
                <CaptionsOverlay />
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
                    showSpotlight={isTutor && pinnedId !== localParticipant.identity}
                    spotlightActive={spotlightedId === pinnedId}
                    onToggleSpotlight={handleToggleSpotlight}
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

          {/* Chat column — collapsible (right sidebar) */}
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

        {/* Bottom strip: participants row */}
        <div className={cn(
          "shrink-0 border-t border-zinc-800 bg-zinc-900 transition-[height] duration-200 overflow-hidden",
          participantsOpen ? "h-28" : "h-9"
        )}>
          <ParticipantsPanel
            pinnedId={pinnedId}
            onPin={setPinnedId}
            collapsed={!participantsOpen}
            onToggleCollapse={() => setParticipantsOpen((v) => !v)}
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
          pointerMode={pointerMode}
          onTogglePointer={handleTogglePointer}
        />
      </div>
    </div>
  )
}
