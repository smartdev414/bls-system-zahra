"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import dynamic from "next/dynamic"
import {
  useParticipants,
  useLocalParticipant,
  useDataChannel,
  useConnectionState,
  useTracks,
  useRoomContext,
  VideoTrack,
} from "@livekit/components-react"
import { ConnectionState, Track } from "livekit-client"
import { cn } from "@/lib/utils"
import {
  Radio, Users, Users2, Presentation, UserPlus, Pointer, UserMinus, AlertTriangle, RefreshCw, Monitor,
  MessageSquare, X, HandMetal, Mic, Check,
} from "lucide-react"
import { toast } from "sonner"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"
import { PptSlideViewer } from "./PptSlideViewer"
import { SlidePicker } from "./SlidePicker"

import {
  CHAT_TOPIC, HAND_TOPIC, PPT_TOPIC, POINTER_TOPIC, SPOTLIGHT_TOPIC, MUTE_TOPIC, CONTROL_TOPIC, WHITEBOARD_TOPIC,
  BREAKOUT_TOPIC, NUDGE_TOPIC, SCREEN_TOPIC,
  BREAKOUT_WRAP_UP_SEC, CHAT_HISTORY_LIMIT,
  POINTER_SEND_INTERVAL_MS, POINTER_AUTO_HIDE_MS,
  enc, dec,
} from "./room/constants"
import type {
  ChatMsg, MsgType, RaisedHand, JoinRequest,
  PptAction, PointerAction, SpotlightAction, MuteAction, SessionControlAction,
  UploadedSlides, WhiteboardAction, WhiteboardSnapshot, WhiteboardDiff,
  BreakoutAction, BreakoutGroup, NudgeAction, ScreenAction,
} from "./room/types"
import { AudioRenderer }        from "./room/AudioRenderer"
import { TutorVideoArea }       from "./room/TutorVideoArea"
import { TutorCameraInset }     from "./room/TutorCameraInset"
import { ParticipantsPanel }    from "./room/ParticipantsPanel"
import { PinnedVideoArea }      from "./room/PinnedVideoArea"
import { FloatingVideoWindow }  from "./room/FloatingVideoWindow"
import { ChatPanel }            from "./room/ChatPanel"
import { SlideUploadPanel }     from "./room/SlideUploadPanel"
import { SlideTray }            from "./room/SlideTray"
import { VideoPlayer }          from "./room/VideoPlayer"
import { ControlsBar }          from "./room/ControlsBar"
import { CaptionsOverlay }      from "./room/CaptionsOverlay"
import { JoinRequestsPopover }  from "./room/JoinRequestsPopover"
import type { WhiteboardApi }   from "./room/TldrawBoard"
import { BreakoutsPanel }       from "./room/BreakoutsPanel"
import { BreakoutMonitor }      from "./room/BreakoutMonitor"
import { BreakoutBanner }       from "./room/BreakoutBanner"
import { NudgeOverlay }          from "./room/NudgeOverlay"
import { InviteCoTutorModal }    from "./InviteCoTutorModal"
import { LogoWatermark }        from "@/components/layout/logo"
import { readBlurPreference, writeBlurPreference } from "./blurPreference"
import { participantBaseId } from "@/lib/participant-identity"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

// Which breakout group this student was last in, remembered per session and per
// tab so a reload or a re-login after a dropped connection can put them back.
const breakoutGroupStorageKey = (sessionId: string) => `classroom:breakout-group:${sessionId}`

function readStoredBreakoutGroupId(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(breakoutGroupStorageKey(sessionId))
  } catch {
    return null   // storage disabled — treat every join as a first placement
  }
}

// What's on the shared screen, remembered per session and per tab. A class-wide
// refresh reloads the tutor too, and the tutor is the only source of truth for
// the presentation — without this, "refresh the classroom" wipes the slides for
// everyone and nobody can put them back except by re-uploading.
const presentationStorageKey = (sessionId: string) => `classroom:presentation:${sessionId}`

type StoredPresentation = {
  kind: "slides" | "video"
  url: string
  page: number
  total: number
  /** Tutor-only: which slides were picked, in presentation order. */
  selected: number[]
}

// tldraw pulls in browser-only APIs and a large bundle, so load it lazily and
// skip SSR. Only mounted while the whiteboard is active.
const TldrawBoard = dynamic(() => import("./room/TldrawBoard"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-100 text-zinc-500 text-sm">
      Loading whiteboard…
    </div>
  ),
})

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
  const room                  = useRoomContext()
  const { localParticipant } = useLocalParticipant()
  const participants          = useParticipants()

  // A LiveKit identity is per-connection (`<userId>__<random>`), so it changes
  // every time someone reconnects. Breakout membership is keyed on the stable
  // user id instead; these two helpers translate between the two worlds.
  const localBaseId = useMemo(
    () => participantBaseId(localParticipant.identity),
    [localParticipant.identity],
  )

  const identitiesByBaseId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of participants) {
      const base = participantBaseId(p.identity)
      const existing = map.get(base)
      if (existing) existing.push(p.identity)
      else map.set(base, [p.identity])
    }
    return map
  }, [participants])

  // Resolve stored group members to the identities currently in the room. A
  // reconnecting student can briefly appear twice (the dropped connection has
  // not timed out yet) — including both is correct for audio and tiles.
  const liveIdentitiesFor = useCallback(
    (memberIds: string[]) => memberIds.flatMap((base) => identitiesByBaseId.get(base) ?? []),
    [identitiesByBaseId],
  )
  const connectionState       = useConnectionState()

  // A browser refresh / tab close fires no React unmount, so LiveKit never sends a
  // clean "leave". The socket dies abnormally (1006) and LiveKit Cloud holds the
  // identity in its reconnect-grace window — which makes an immediate rejoin with
  // our stable identity (session.sub) collide and get rejected with
  // "invalid token: revoked". Disconnecting on pagehide sends the leave frame over
  // the still-open socket so Cloud frees the identity right away and the rejoin
  // connects cleanly. `pagehide` (not `beforeunload`) is the bfcache-safe hook and
  // still fires on reload, navigation, and tab close.
  useEffect(() => {
    const onPageHide = () => {
      try { void room.disconnect(true) } catch { /* socket already gone */ }
    }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [room])

  // Dashboard layout renders a global Feedback button; hide it while the
  // classroom fullscreen UI is mounted so it doesn't overlap the controls.
  useEffect(() => {
    const btn = document.querySelector<HTMLButtonElement>("[data-app-feedback]")
    if (!btn) return
    btn.hidden = true
    return () => { btn.hidden = false }
  }, [])

  // Reactive screen share state — works for both tutor and student clients.
  // `onlySubscribed: false` includes the tutor's own locally-published track.
  const allScreenTracks  = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })
  const tutorScreenTrack = allScreenTracks.find((t) => t.participant.metadata === "tutor") ?? null
  const screenSharing    = !!tutorScreenTrack

  const localName = localParticipant.name ?? localParticipant.identity

  // Students may only publish audio when the tutor enables their mic.
  const micAllowedByTutorRef = useRef(false)
  const studentInitialMutedRef = useRef(false)

  // ── Chat / hand state ──────────────────────────────────────────────────────
  // Chat lives only in memory during a call, so a reload or a dropped Wi-Fi
  // connection used to wipe the whole conversation — exactly when a student
  // most needs to read back what their group said. Mirror it into
  // sessionStorage (per session, per tab) and restore it on mount.
  const chatStorageKey = `classroom:chat:${sessionId}`
  const [messages, setMessages] = useState<ChatMsg[]>([])

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(chatStorageKey)
      if (!saved) return
      const parsed = JSON.parse(saved) as ChatMsg[]
      if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed)
    } catch { /* corrupt or unavailable storage — start empty */ }
    // Restore once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Never write an empty list: on mount this effect would otherwise run before
    // the restore above has re-rendered, wiping the history it just read.
    if (messages.length === 0) return
    try {
      // Cap the backlog: a long session would otherwise outgrow the ~5 MB quota.
      sessionStorage.setItem(chatStorageKey, JSON.stringify(messages.slice(-CHAT_HISTORY_LIMIT)))
    } catch { /* quota or storage disabled — history just won't survive a reload */ }
  }, [messages, chatStorageKey])
  const [raisedHands,      setRaisedHands]      = useState<RaisedHand[]>([])
  const [handRaised,       setHandRaised]       = useState(false)
  // Fast O(1) membership lookup for tile/overlay badges.
  const raisedHandIds = useMemo(
    () => new Set(raisedHands.map((h) => h.identity)),
    [raisedHands]
  )
  // Pending "request to speak" from students (tutor-side). Each is cleared when
  // the tutor approves (turns the mic on) or denies.
  const [speakRequests,    setSpeakRequests]    = useState<{ identity: string; name: string }[]>([])
  const [chatFlash,        setChatFlash]        = useState(false)
  const [isFullscreen,     setIsFullscreen]     = useState(false)
  const [pinnedId,         setPinnedId]         = useState<string | null>(null)
  const [participantsOpen, setParticipantsOpen] = useState(true)
  const [chatOpen,         setChatOpen]         = useState(true)
  const [requestsOpen,     setRequestsOpen]     = useState(false)
  // Tutor-only: "Invite a second teacher" modal.
  const [inviteCoTutorOpen, setInviteCoTutorOpen] = useState(false)

  // On small screens (phones), default chat + participants to collapsed so the
  // camera/content area isn't covered by overlays / cramped strips. We do this
  // once after mount via matchMedia to avoid SSR hydration mismatch.
  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.matchMedia("(max-width: 767px)").matches) {
      setChatOpen(false)
      setParticipantsOpen(false)
    }
  }, [])

  // ── Popped-out floating video windows ──────────────────────────────────────
  // Each entry is a participant identity the tutor has popped out into a
  // draggable, resizable window so they can keep an eye on that student
  // regardless of who's pinned in the main view.
  const [poppedOutIds, setPoppedOutIds] = useState<string[]>([])

  // ── Remove-participant confirmation (tutor only) ───────────────────────────
  const [pendingRemoval, setPendingRemoval] = useState<{ identity: string; name: string } | null>(null)

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

  // ── Presentation state ─────────────────────────────────────────────────────
  // `pptActive` is TRUE for both slide- and video-mode presentations; `presentKind`
  // says which. We reuse the PPT_TOPIC + a single "what's on the screen now"
  // flag so only one resource can be live at a time.
  const [pptActive,      setPptActive]      = useState(false)
  const [pptUrl,         setPptUrl]         = useState<string | null>(null)
  const [pptCurrentPage, setPptCurrentPage] = useState(1)
  const [pptTotalPages,  setPptTotalPages]  = useState(0)
  const [presentKind,    setPresentKind]    = useState<"slides" | "video" | null>(null)
  const [showUpload,     setShowUpload]     = useState(false)
  // Slide picker appears after upload. While non-null, the tutor hasn't yet
  // chosen which slides to include. Videos bypass the picker entirely, so the
  // state is narrowed to the slide-deck variant.
  type SlidesUpload = Extract<UploadedSlides, { kind: "slides" }>
  const [pickerData,     setPickerData]     = useState<SlidesUpload | null>(null)
  // Tutor-only: the 1-based slide numbers in the order they'll be navigated.
  // Broadcast protocol doesn't need to know about this — students just receive
  // actual page numbers in the underlying deck.
  const [selectedSlides, setSelectedSlides] = useState<number[]>([])
  // Tutor-only: show/hide the live slide-thumbnail sidebar (shown only in PPT mode)
  const [slideTrayOpen,  setSlideTrayOpen]  = useState(true)

  // ── Presentation survives a reload ─────────────────────────────────────────
  // Restore whatever was on screen before the page reloaded. Read in an effect
  // rather than a lazy initialiser so the first client render still matches the
  // server's, matching how the rest of this component restores stored prefs.
  const restoredPresentationRef = useRef(false)
  const hadPresentationRef = useRef(false)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(presentationStorageKey(sessionId))
      if (!raw) return
      const saved = JSON.parse(raw) as StoredPresentation
      if (!saved?.url || (saved.kind !== "slides" && saved.kind !== "video")) return
      setPresentKind(saved.kind)
      setPptUrl(saved.url)
      setPptCurrentPage(saved.page > 0 ? saved.page : 1)
      setPptTotalPages(saved.total > 0 ? saved.total : 0)
      setSelectedSlides(Array.isArray(saved.selected) ? saved.selected : [])
      setPptActive(true)
      setParticipantsOpen(false)
      restoredPresentationRef.current = true
    } catch { /* corrupt or unavailable storage — come up with a blank stage */ }
  }, [sessionId])

  useEffect(() => {
    try {
      if (pptActive && pptUrl && presentKind) {
        hadPresentationRef.current = true
        const record: StoredPresentation = {
          kind: presentKind,
          url: pptUrl,
          page: pptCurrentPage,
          total: pptTotalPages,
          selected: selectedSlides,
        }
        sessionStorage.setItem(presentationStorageKey(sessionId), JSON.stringify(record))
        return
      }
      // Only clear once this mount has actually seen a presentation: on the
      // first render after a reload the state is still empty, and clearing here
      // would wipe the very record the effect above is about to restore.
      if (!hadPresentationRef.current) return
      sessionStorage.removeItem(presentationStorageKey(sessionId))
    } catch { /* storage disabled — the presentation just won't survive a reload */ }
  }, [pptActive, pptUrl, presentKind, pptCurrentPage, pptTotalPages, selectedSlides, sessionId])

  // Position of the currently-shown page within the tutor-selected subset.
  // -1 if the tutor has live-excluded the current slide from the sequence.
  const presentationIdx = useMemo(
    () => selectedSlides.indexOf(pptCurrentPage),
    [selectedSlides, pptCurrentPage]
  )
  const hasNextSlide = useMemo(
    () => selectedSlides.some((p) => p > pptCurrentPage),
    [selectedSlides, pptCurrentPage]
  )
  const hasPrevSlide = useMemo(
    () => selectedSlides.some((p) => p < pptCurrentPage),
    [selectedSlides, pptCurrentPage]
  )

  // ── Video playback state (tutor-authoritative, mirrored by students) ───────
  // The tutor's VideoPlayer ignores these props — they only exist so students
  // can mirror. The tutor updates `videoStateRef` on every play/pause/seek so
  // late-joining students get the right answer from video_sync_response.
  const [videoPlaying,     setVideoPlaying]     = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoAsOf,        setVideoAsOf]        = useState(() => Date.now())
  const videoStateRef = useRef({ url: "", playing: false, currentTime: 0, ts: 0 })

  // ── Whiteboard state ───────────────────────────────────────────────────────
  // `whiteboardActive` toggles the shared tldraw surface for everyone. The
  // document state itself lives inside tldraw (TldrawBoard); this shell only
  // owns the lifecycle + the student-write permission and relays opaque tldraw
  // diffs/snapshots over the data channel.
  // Mutually exclusive with slides/video: only one "main area" resource runs
  // at a time, handled in the render branch below.
  const [whiteboardActive, setWhiteboardActive] = useState(false)
  // Students can draw only after the tutor presses "Let them write".
  const [whiteboardStudentWrite, setWhiteboardStudentWrite] = useState(false)
  const tutorIdentityRef = useRef<string | null>(null)
  useEffect(() => {
    tutorIdentityRef.current =
      participants.find((p) => p.metadata === "tutor")?.identity ?? null
  }, [participants])
  // Ref mirrors for the sync_response handler so it always sees latest values.
  const whiteboardStateRef = useRef({ active: false, studentWrite: false })
  useEffect(() => {
    whiteboardStateRef.current = {
      active: whiteboardActive,
      studentWrite: whiteboardStudentWrite,
    }
  }, [whiteboardActive, whiteboardStudentWrite])

  // Imperative bridge to the tldraw store, populated by TldrawBoard on mount.
  // While the board is mounting, remote diffs/snapshots that arrive first are
  // buffered here and flushed once the bridge registers.
  const wbApiRef = useRef<WhiteboardApi | null>(null)
  const wbPendingRef = useRef<{ snapshot?: WhiteboardSnapshot; changes: WhiteboardDiff[] }>({ changes: [] })
  const registerWhiteboardApi = useCallback((api: WhiteboardApi | null) => {
    wbApiRef.current = api
    if (!api) return
    const pending = wbPendingRef.current
    if (pending.snapshot) {
      api.applySnapshot(pending.snapshot)
      pending.snapshot = undefined
    }
    for (const changes of pending.changes) api.applyChanges(changes)
    pending.changes = []
  }, [])

  // ── Breakout rooms state ───────────────────────────────────────────────────
  // Simulated breakouts — everyone stays in the same LiveKit room, but each
  // client filters audio and tiles by group membership. `visitingGroupId` is
  // the group the tutor has entered (their audio bridges in, and they hear
  // that group's students). `null` = tutor is in the main room / monitor-only.
  const [breakoutsActive,    setBreakoutsActive]    = useState(false)
  const [breakoutGroups,     setBreakoutGroups]     = useState<BreakoutGroup[]>([])
  const [visitingGroupId,    setVisitingGroupId]    = useState<string | null>(null)
  const [breakoutStartedAt,  setBreakoutStartedAt]  = useState<number | null>(null)
  const [breakoutDurationMin,setBreakoutDurationMin]= useState<number | null>(null)
  const [breakoutClosingAt,  setBreakoutClosingAt]  = useState<number | null>(null)
  const [breakoutsPanelOpen, setBreakoutsPanelOpen] = useState(false)
  const [breakoutMonitorOpen,setBreakoutMonitorOpen]= useState(false)
  // Mirrors for sync_response so the handler always sees the latest values.
  const breakoutStateRef = useRef({
    active: false,
    groups: [] as BreakoutGroup[],
    visitingGroupId: null as string | null,
    startedAt: null as number | null,
    durationMin: null as number | null,
    closingAt: null as number | null,
  })
  useEffect(() => {
    breakoutStateRef.current = {
      active: breakoutsActive,
      groups: breakoutGroups,
      visitingGroupId,
      startedAt: breakoutStartedAt,
      durationMin: breakoutDurationMin,
      closingAt: breakoutClosingAt,
    }
  }, [breakoutsActive, breakoutGroups, visitingGroupId, breakoutStartedAt, breakoutDurationMin, breakoutClosingAt])

  // Students: keep the participant strip open during breakouts so group cameras
  // stay visible — and open the chat too. Chat is the main channel in a BSL
  // classroom, and on phones/tablets it starts collapsed, so a student sent
  // into a breakout would otherwise land in a room with no visible way to talk
  // to their group.
  useEffect(() => {
    if (!isTutor && breakoutsActive) {
      setParticipantsOpen(true)
      setChatOpen(true)
    }
  }, [isTutor, breakoutsActive])

  // ── Finger pointer state ───────────────────────────────────────────────────
  const [pointerMode,   setPointerMode]   = useState(false)
  const [livePointer,   setLivePointer]   = useState<{ x: number; y: number } | null>(null)
  const slideAreaRef    = useRef<HTMLDivElement>(null)
  const lastPointerSent = useRef(0)
  const pointerHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Background blur state ──────────────────────────────────────────────────
  // The actual processor instance is heavy (bundles MediaPipe) so it's lazily
  // imported on first toggle. `blurEnabled` is the source of truth; the
  // auto-apply effect below attaches the processor whenever the local camera
  // track is (re-)published. Initial value comes from the pre-join lobby so
  // a user who flipped blur on before joining doesn't have to click again.
  const [blurEnabled, setBlurEnabled] = useState(() => readBlurPreference())
  const [blurBusy, setBlurBusy] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blurProcessorRef = useRef<any>(null)

  // ── Recording (tutor only) ────────────────────────────────────────────────
  // Recording is manual: tutor clicks Start Rec, then can pause/resume. Each
  // pause/resume cycle creates a new MP4 segment in S3.
  const [recordingStarted, setRecordingStarted] = useState(false)
  const [recordingPaused, setRecordingPaused]     = useState(false)
  const [recordingBusy, setRecordingBusy]         = useState(false)
  const recordingReminderShown = useRef(false)

  // ── Participant tile size (persisted per-user) ─────────────────────────────
  // Drives the height of the bottom participants strip and, transitively, the
  // size of each tile (they keep an aspect-square). Each user gets their own
  // preference — students can make their classmates' tiles bigger too.
  type TileSize = "sm" | "md" | "lg" | "xl"
  const [tileSize, setTileSize] = useState<TileSize>("md")
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("classroom:tileSize") as TileSize | null
      if (stored === "sm" || stored === "md" || stored === "lg" || stored === "xl") {
        setTileSize(stored)
      }
    } catch { /* ignore — private mode or quota */ }
  }, [])
  const handleTileSizeChange = useCallback((next: TileSize) => {
    setTileSize(next)
    try { window.localStorage.setItem("classroom:tileSize", next) } catch { /* ignore */ }
  }, [])

  // ── Spotlight state (tutor-initiated, seen by everyone) ───────────────────
  const [spotlightedId, setSpotlightedId] = useState<string | null>(null)
  const spotlightRef = useRef<string | null>(null)
  // Remember uploaded slides so tutor can resume without re-uploading
  const uploadedSlidesRef = useRef<UploadedSlides | null>(null)

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
      // Keep the local `handRaised` button state in sync with any inbound event
      // that targets the local participant — covers the case where the tutor
      // force-lowers a student, so the student's own button flips back to
      // "Raise Hand" without them having to click it.
      if (data.identity === localParticipant.identity) {
        setHandRaised(data.raised)
      }
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

      // ── Slides ───────────────────────────────────────────────────────────
      if (data.action === "start") {
        setPresentKind("slides")
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
        setPresentKind(null)
        setPptUrl(null)
        setPptCurrentPage(1)
        setPptTotalPages(0)
        setParticipantsOpen(true)
        return
      }

      // ── Video ────────────────────────────────────────────────────────────
      if (data.action === "video_start") {
        setPresentKind("video")
        setPptUrl(data.url)
        setPptActive(true)
        setVideoPlaying(false)
        setVideoCurrentTime(0)
        setVideoAsOf(Date.now())
        setParticipantsOpen(false)
        return
      }

      if (data.action === "video_state" && !isTutor) {
        // Students mirror whatever the tutor just broadcast. The tutor's own
        // echo is ignored to avoid fighting their native <video> controls.
        setVideoPlaying(data.playing)
        setVideoCurrentTime(data.currentTime)
        setVideoAsOf(data.ts)
        return
      }

      if (data.action === "video_stop") {
        setPptActive(false)
        setPresentKind(null)
        setPptUrl(null)
        setVideoPlaying(false)
        setVideoCurrentTime(0)
        setParticipantsOpen(true)
        return
      }

      // ── Sync for late joiners ────────────────────────────────────────────
      if (data.action === "sync_request" && isTutor) {
        const state = pptStateRef.current
        if (state.active) {
          const response: PptAction = {
            action: "sync_response",
            url: state.url,
            total: state.total,
            page: state.page,
          }
          sendPpt(enc.encode(JSON.stringify(response)), { reliable: true })
          return
        }
        const v = videoStateRef.current
        if (v.url) {
          const response: PptAction = {
            action: "video_sync_response",
            url: v.url,
            playing: v.playing,
            currentTime: v.currentTime,
            ts: v.ts,
          }
          sendPpt(enc.encode(JSON.stringify(response)), { reliable: true })
        }
        return
      }

      if (data.action === "sync_response" && !isTutor) {
        setPresentKind("slides")
        setPptUrl(data.url)
        setPptTotalPages(data.total)
        setPptCurrentPage(data.page)
        setPptActive(true)
        setParticipantsOpen(false)
        return
      }

      if (data.action === "video_sync_response" && !isTutor) {
        setPresentKind("video")
        setPptUrl(data.url)
        setPptActive(true)
        setVideoPlaying(data.playing)
        setVideoCurrentTime(data.currentTime)
        setVideoAsOf(data.ts)
        setParticipantsOpen(false)
        return
      }
    } catch { /* ignore malformed */ }
  })

  // ── Data channel: finger pointer ───────────────────────────────────────────

  const { send: sendPointer } = useDataChannel(POINTER_TOPIC, (msg) => {
    if (isTutor) return  // tutor drives the pointer, no need to react to own echoes
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as PointerAction
      if (data.action === "move") {
        setLivePointer({ x: data.x, y: data.y })
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

  // ── Data channel: tutor-controlled microphones ─────────────────────────────
  // Server permission updates can lag the data-channel command by a few hundred ms.
  // Retry enabling so publish doesn't fail silently while the UI still looks "on".
  const enableStudentMic = useCallback(async () => {
    const retryDelaysMs = [0, 500, 1200, 2500]
    for (let i = 0; i < retryDelaysMs.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[i]! - retryDelaysMs[i - 1]!))
      }
      if (!micAllowedByTutorRef.current) return
      try {
        await localParticipant.setMicrophoneEnabled(true)
        if (localParticipant.isMicrophoneEnabled) return
      } catch {
        // Permission may not have propagated yet — retry.
      }
    }
    micAllowedByTutorRef.current = false
    const micErr = localParticipant.lastMicrophoneError
    toast.error("Couldn't turn your microphone on", {
      description: micErr?.message?.toLowerCase().includes("permission")
        ? "Allow microphone access in your browser, then tap Request to speak again."
        : "Tap Request to speak again — your tutor may need to approve once more.",
    })
  }, [localParticipant])

  const applyLocalMic = useCallback((enabled: boolean) => {
    micAllowedByTutorRef.current = enabled
    if (enabled) {
      void enableStudentMic()
    } else {
      void localParticipant.setMicrophoneEnabled(false).catch(() => { /* ignore */ })
    }
  }, [localParticipant, enableStudentMic])

  const { send: sendMuteAll } = useDataChannel(MUTE_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as MuteAction

      // ── Tutor side: a student is asking to speak ────────────────────────────
      // The tutor stays in control — they can acknowledge the request now and
      // turn the mic on later from the participant controls if needed.
      if (data.action === "request-speak") {
        if (!isTutor) return
        setSpeakRequests((prev) =>
          prev.some((r) => r.identity === data.identity)
            ? prev
            : [...prev, { identity: data.identity, name: data.name }]
        )
        setMessages((prev) => [
          ...prev,
          { id: `sys-ask-${Date.now()}`, from: "system", text: `${data.name} is asking to speak 🎙️`, ts: Date.now(), type: "system" },
        ])
        toast.info(`${data.name} wants to speak`, {
          description: "Accept to acknowledge them now, or deny. Their mic stays off until you enable it.",
          duration: 20000,
          action: { label: "Accept", onClick: () => handleAcceptSpeak(data.identity, data.name) },
          cancel:  { label: "Deny",    onClick: () => handleDenySpeak(data.identity, data.name) },
        })
        return
      }

      // ── Student side: tutor-issued actions ─────────────────────────────────
      if (isTutor) return

      if (data.action === "mute-all") {
        applyLocalMic(false)
        toast.info(`${data.from} muted everyone's microphone`, {
          description: "Your tutor will turn your mic on when it's your turn to speak.",
        })
        return
      }
      if (data.action === "set-mic" && data.identity === localParticipant.identity) {
        applyLocalMic(data.enabled)
        // Approving a request clears the local "requested" state via the effect below.
        if (data.enabled) {
          toast.info(`${data.from} turned your microphone on`, {
            description: "You can sign with audio until the tutor mutes you again.",
          })
        } else {
          toast.info(`${data.from} turned your microphone off`)
        }
        return
      }
      if (data.action === "accept-speak" && data.identity === localParticipant.identity) {
        toast.info(`${data.from} accepted your request`, {
          description: "Your mic is still off for now. Your tutor can turn it on when they're ready.",
        })
        return
      }
      if (data.action === "deny-speak" && data.identity === localParticipant.identity) {
        toast.info(`${data.from} declined your request to speak`, {
          description: "Your mic stays off for now — you can ask again later.",
        })
      }
    } catch { /* ignore malformed */ }
  })

  // Join muted once after the room connects. Guard with a ref so a later
  // localParticipant identity change (e.g. after publishing) can't re-mute
  // a student the tutor already approved.
  useEffect(() => {
    if (isTutor || studentInitialMutedRef.current) return
    if (connectionState !== ConnectionState.Connected) return
    studentInitialMutedRef.current = true
    micAllowedByTutorRef.current = false
    void localParticipant.setMicrophoneEnabled(false).catch(() => { /* ignore */ })
  }, [isTutor, connectionState, localParticipant])

  // ── Data channel: session-level admin actions ─────────────────────────────
  // Tutor broadcasts `refresh`. Students react on receipt; the tutor performs
  // the same action locally in the click handler to stay in sync — we don't
  // rely on the tutor's own data-channel echo here.

  const { send: sendControl } = useDataChannel(CONTROL_TOPIC, (msg) => {
    if (isTutor) return
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as SessionControlAction
      if (data.action === "refresh") {
        toast.info(`${data.from} is refreshing the classroom`, {
          description: "Your page will reload in a moment…",
        })
        // Leave a one-shot flag so the page skips the lobby and auto-rejoins
        // after the reload. Scoped to this session + tab via sessionStorage.
        try {
          sessionStorage.setItem(`classroom:auto-rejoin:${sessionId}`, String(Date.now()))
        } catch { /* storage may be disabled */ }
        setTimeout(() => window.location.reload(), 1500)
      }
    } catch { /* ignore malformed */ }
  })

  // ── Data channel: whiteboard ───────────────────────────────────────────────
  // Tutor controls start/stop/clear and whether students may draw. Students
  // only add/update/delete when `student_write` is enabled. Everyone echoes
  // locally first; receive handler de-dupes by id.

  const { send: sendWhiteboard } = useDataChannel(WHITEBOARD_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as WhiteboardAction
      const senderId = msg.from?.identity
      const tutorId = tutorIdentityRef.current

      const isFromTutor = !!(tutorId && senderId === tutorId)
      const studentWriteAllowed = () => whiteboardStateRef.current.studentWrite

      const allowStudentMutation = () => studentWriteAllowed() || isFromTutor

      if (data.action === "start") {
        setWhiteboardActive(true)
        setWhiteboardStudentWrite(false)
        return
      }
      if (data.action === "stop") {
        setWhiteboardActive(false)
        setWhiteboardStudentWrite(false)
        wbApiRef.current = null
        wbPendingRef.current = { changes: [] }
        return
      }
      if (data.action === "student_write") {
        setWhiteboardStudentWrite(data.enabled)
        return
      }
      // Incremental tldraw store diff. Apply if it's allowed for the sender;
      // buffer until the board's store bridge has registered.
      if (data.action === "doc") {
        if (!allowStudentMutation() && !isFromTutor) return
        if (wbApiRef.current) wbApiRef.current.applyChanges(data.changes)
        else wbPendingRef.current.changes.push(data.changes)
        return
      }

      // Live cursor from a peer. Cursors are view-only, so they're applied
      // regardless of write permission. Dropped (not buffered) if the board
      // isn't mounted yet — presence is ephemeral and the next frame is ~60ms out.
      if (data.action === "presence") {
        wbApiRef.current?.applyPresence(data.presence)
        return
      }

      // Late joiner asked the tutor for current state — reply with the live
      // tldraw snapshot from the board bridge.
      if (data.action === "sync_request" && isTutor) {
        const state = whiteboardStateRef.current
        const response: WhiteboardAction = {
          action: "sync_response",
          active: state.active,
          studentWrite: state.studentWrite,
          snapshot: wbApiRef.current?.getSnapshot() ?? null,
        }
        try {
          sendWhiteboard(enc.encode(JSON.stringify(response)), { reliable: true })
        } catch { /* ignore */ }
        return
      }
      if (data.action === "sync_response" && !isTutor) {
        setWhiteboardActive(data.active)
        setWhiteboardStudentWrite(data.studentWrite)
        if (data.snapshot) {
          if (wbApiRef.current) wbApiRef.current.applySnapshot(data.snapshot)
          else wbPendingRef.current.snapshot = data.snapshot
        }
        return
      }
    } catch { /* ignore malformed */ }
  })

  // ── Data channel: breakout rooms ───────────────────────────────────────────
  // Tutor originates start/update/visit/stop; students react. Tutor also
  // answers sync_request from late joiners so everyone converges on the same
  // group assignments.

  const { send: sendBreakout } = useDataChannel(BREAKOUT_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as BreakoutAction

      if (data.action === "start") {
        setBreakoutsActive(true)
        setBreakoutGroups(data.groups)
        setVisitingGroupId(data.visitingGroupId ?? null)
        setBreakoutStartedAt(data.startedAt)
        setBreakoutDurationMin(data.durationMin ?? null)

        if (!isTutor) {
          // Figure out which group the local student landed in and toast.
          const ownGroup = data.groups.find((g) => g.memberIds.includes(localBaseId))
          if (ownGroup) {
            toast.info(`You're in ${ownGroup.name}`, {
              description: "Use the camera tiles to work with your group — sign away!",
            })
          } else {
            toast.info("Breakouts started", {
              description: "The tutor hasn't put you in a group yet — hang tight.",
            })
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-bo-start-${Date.now()}`,
              from: "system",
              text: "Tutor split the class into breakout groups 👥",
              ts: Date.now(),
              type: "system",
            },
          ])
        }
        return
      }

      if (data.action === "update") {
        setBreakoutsActive(true)
        setBreakoutGroups(data.groups)
        setBreakoutStartedAt(data.startedAt)
        setBreakoutDurationMin(data.durationMin ?? null)
        if (!isTutor) {
          const ownGroup = data.groups.find((g) => g.memberIds.includes(localBaseId))
          if (ownGroup) {
            toast.info(`Group updated — you're now in ${ownGroup.name}`)
          } else {
            toast.info("Breakouts are live", {
              description: "The tutor hasn't put you in a group yet — hang tight.",
            })
          }
        }
        return
      }

      if (data.action === "extend") {
        setBreakoutsActive(true)
        setBreakoutStartedAt(data.startedAt)
        setBreakoutDurationMin(data.durationMin)
        // Adding time means "not yet" — cancel a wrap-up already counting down.
        setBreakoutClosingAt(null)
        if (!isTutor) {
          toast.success(`${data.addedMin} more minute${data.addedMin !== 1 ? "s" : ""} added`, {
            description: "Your breakout room is staying open a little longer.",
          })
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-bo-extend-${Date.now()}`,
              from: "system",
              text: `Tutor added ${data.addedMin} more minute${data.addedMin !== 1 ? "s" : ""} to the breakout ⏱️`,
              ts: Date.now(),
              type: "system",
            },
          ])
        }
        return
      }

      if (data.action === "closing") {
        setBreakoutClosingAt(data.endsAt)
        if (!isTutor) {
          toast.info("Breakouts ending soon", {
            description: "Wrap up — we'll return to the main room shortly.",
          })
        }
        return
      }

      if (data.action === "visit") {
        setVisitingGroupId(data.groupId)
        if (!isTutor) {
          const group = data.groupId ? breakoutStateRef.current.groups.find((g) => g.id === data.groupId) : null
          const ownGroup = breakoutStateRef.current.groups.find((g) => g.memberIds.includes(localBaseId))
          if (group && ownGroup && group.id === ownGroup.id) {
            toast.info("The tutor just joined your group 🎯")
          } else if (ownGroup && data.groupId === null) {
            // Tutor left — no toast, stays quiet.
          }
        }
        return
      }

      if (data.action === "stop") {
        setBreakoutsActive(false)
        setBreakoutGroups([])
        setVisitingGroupId(null)
        setBreakoutStartedAt(null)
        setBreakoutDurationMin(null)
        setBreakoutClosingAt(null)
        if (!isTutor) {
          toast.info("Breakouts ended — back to the main room.")
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-bo-end-${Date.now()}`,
              from: "system",
              text: "Breakouts ended — everyone's back together",
              ts: Date.now(),
              type: "system",
            },
          ])
        }
        return
      }

      if (data.action === "sync_request" && isTutor) {
        const snap = breakoutStateRef.current
        const response: BreakoutAction = {
          action: "sync_response",
          active: snap.active,
          groups: snap.groups,
          visitingGroupId: snap.visitingGroupId,
          startedAt: snap.startedAt,
          durationMin: snap.durationMin,
          closingAt: snap.closingAt,
        }
        try {
          sendBreakout(enc.encode(JSON.stringify(response)), { reliable: true })
        } catch { /* ignore */ }
        return
      }

      if (data.action === "sync_response" && !isTutor) {
        setBreakoutsActive(data.active)
        setBreakoutGroups(data.groups)
        setVisitingGroupId(data.visitingGroupId)
        setBreakoutStartedAt(data.startedAt)
        setBreakoutDurationMin(data.durationMin)
        setBreakoutClosingAt(data.closingAt ?? null)
        if (data.active) {
          const ownGroup = data.groups.find((g) => g.memberIds.includes(localBaseId))
          if (ownGroup) {
            // Landing back in the group we were already in means this is a
            // return after a drop, not a fresh assignment. Say so — the room
            // otherwise just silently changes shape around them.
            if (readStoredBreakoutGroupId(sessionId) === ownGroup.id) {
              toast.success(`Welcome back — you're in ${ownGroup.name} again`, {
                description: "Your breakout room is still running.",
              })
            } else {
              toast.info(`You're in ${ownGroup.name}`, {
                description: "Use the main view and camera tiles to work with your group.",
              })
            }
          }
        }
        return
      }
    } catch { /* ignore malformed */ }
  })

  // Student: ask the tutor for breakout state after joining, and retry a few
  // times in case breakouts went live before we connected.
  const breakoutSyncAttempts = useRef(0)
  useEffect(() => {
    if (isTutor || connectionState !== ConnectionState.Connected) return
    if (breakoutsActive) {
      breakoutSyncAttempts.current = 0
      return
    }
    // Keep asking for a while: a student returning after a dropped connection
    // needs an answer, and "no reply yet" is indistinguishable from "no
    // breakouts running" until one arrives.
    if (breakoutSyncAttempts.current >= 12) return

    const requestSync = () => {
      breakoutSyncAttempts.current += 1
      try {
        sendBreakout(enc.encode(JSON.stringify({ action: "sync_request" })), { reliable: true })
      } catch { /* ignore */ }
    }

    requestSync()
    const id = setInterval(requestSync, 8000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState, breakoutsActive])

  // ── Data channel: attention nudge ──────────────────────────────────────────
  // Tutor pings the class (or a single breakout group). Receivers render a
  // short visual flash overlay — the key UX for BSL, where audio cues miss.

  const [activeNudge, setActiveNudge] = useState<{ id: number; from: string; message: string | null } | null>(null)

  // ── Screen share privacy state ─────────────────────────────────────────────
  const [screenPrivate, setScreenPrivate] = useState(false)
  const screenPrivateRef = useRef(false)
  useEffect(() => { screenPrivateRef.current = screenPrivate }, [screenPrivate])

  // Reset privacy whenever screen sharing stops so the next session starts public
  useEffect(() => {
    if (!screenSharing) setScreenPrivate(false)
  }, [screenSharing])

  const { send: sendNudge } = useDataChannel(NUDGE_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as NudgeAction
      if (data.action !== "nudge") return
      // Respect a targeted nudge: only show it to members of that group. The
      // tutor always sees their own nudge echo so they know it fired.
      if (data.groupId && !isTutor) {
        const own = breakoutStateRef.current.groups.find((g) => g.memberIds.includes(localBaseId))
        if (!own || own.id !== data.groupId) return
      }
      setActiveNudge({ id: Date.now(), from: data.from, message: data.message ?? null })
    } catch { /* ignore malformed */ }
  })

  // ── Data channel: screen share privacy ────────────────────────────────────
  // Tutor toggles a "private" flag; students see a placeholder until it's lifted.
  // The track still flows (soft privacy) — no start/stop lag when revealing.

  const { send: sendScreen } = useDataChannel(SCREEN_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as ScreenAction
      if (data.action === "privacy") {
        if (!isTutor) setScreenPrivate(data.private)
        return
      }
      if (data.action === "sync_request" && isTutor) {
        const response: ScreenAction = { action: "sync_response", private: screenPrivateRef.current }
        try {
          sendScreen(enc.encode(JSON.stringify(response)), { reliable: true })
        } catch { /* ignore */ }
        return
      }
      if (data.action === "sync_response" && !isTutor) {
        setScreenPrivate(data.private)
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

  // Keep pptStateRef in sync so sync_response handler has current values.
  // `active` is scoped to SLIDES only — when video is playing the handler
  // consults videoStateRef instead and this ref stays inert.
  useEffect(() => {
    pptStateRef.current = {
      active: pptActive && presentKind === "slides",
      url: pptUrl ?? "",
      total: pptTotalPages,
      page: pptCurrentPage,
    }
  }, [pptActive, presentKind, pptUrl, pptTotalPages, pptCurrentPage])

  // ── Student: request sync when first joining ───────────────────────────────
  // Retry rather than asking once. A class-wide refresh reloads everyone at the
  // same moment, so a single request 2s after connecting routinely lands while
  // the tutor's own page is still coming back up — and the student would then
  // sit in front of a blank stage for the rest of the lesson. Stops as soon as
  // something is on screen.
  const pptSyncAttempts = useRef(0)
  useEffect(() => {
    if (isTutor || connectionState !== ConnectionState.Connected) return
    if (pptActive) {
      pptSyncAttempts.current = 0
      return
    }
    if (pptSyncAttempts.current >= 8) return

    const requestSync = () => {
      pptSyncAttempts.current += 1
      try {
        sendPpt(enc.encode(JSON.stringify({ action: "sync_request" } as PptAction)), { reliable: true })
      } catch { /* ignore */ }
    }

    const first = setTimeout(requestSync, 2000)
    const id = setInterval(requestSync, 6000)
    return () => { clearTimeout(first); clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState, pptActive])

  // ── Tutor: re-announce a restored presentation ─────────────────────────────
  // After a refresh the tutor comes back holding the slides again, but nobody
  // else knows. Students restore their own copy from storage and also retry a
  // sync, so this is belt-and-braces for anyone whose storage was cleared.
  const pptRebroadcastRef = useRef(false)
  useEffect(() => {
    if (!isTutor || pptRebroadcastRef.current) return
    if (!restoredPresentationRef.current) return
    if (connectionState !== ConnectionState.Connected) return
    if (!pptActive || !pptUrl || presentKind !== "slides") return
    pptRebroadcastRef.current = true
    safeSendPpt({ action: "start", url: pptUrl, total: pptTotalPages, page: pptCurrentPage })
    // safeSendPpt is declared further down; it is initialised by the time any
    // effect body runs, and listing it here would reorder the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState, pptActive, pptUrl, presentKind, pptTotalPages, pptCurrentPage])

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
    (text: string, type: MsgType, attachment?: ChatMsg["attachment"]) => {
      const msg: Omit<ChatMsg, "id"> = { from: localName, text, ts: Date.now(), type, attachment }
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

  // ── Tutor: lower a raised hand on behalf of a student ──────────────────────
  // Broadcasts the same shape the student would send, so every client (including
  // the target student) applies it via the HAND_TOPIC receiver above — which
  // also flips the student's local `handRaised` so their button resets.
  const handleLowerHand = useCallback((identity: string) => {
    if (!isTutor) return
    const entry = raisedHands.find((h) => h.identity === identity)
    if (!entry) return
    const evt = { identity, name: entry.name, raised: false }
    sendHand(enc.encode(JSON.stringify(evt)), { reliable: true })
    setRaisedHands((prev) => prev.filter((h) => h.identity !== identity))
    setPinnedId((prev) => (prev === identity ? null : prev))
  }, [isTutor, raisedHands, sendHand])

  const handleLowerAllHands = useCallback(() => {
    if (!isTutor || raisedHands.length === 0) return
    for (const h of raisedHands) {
      const evt = { identity: h.identity, name: h.name, raised: false }
      sendHand(enc.encode(JSON.stringify(evt)), { reliable: true })
    }
    setRaisedHands([])
    // If the currently-pinned participant had a raised hand, drop the pin too.
    setPinnedId((prev) => (prev && raisedHands.some((h) => h.identity === prev) ? null : prev))
  }, [isTutor, raisedHands, sendHand])

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

  // Kicks off a video presentation. Broadcasts `video_start`, flips the
  // classroom into video mode, and seeds videoStateRef so late joiners can
  // sync. Separate from slide-start because there's no picker step.
  const handleVideoStart = useCallback((url: string) => {
    const now = Date.now()
    setPresentKind("video")
    setPptUrl(url)
    setPptTotalPages(0)
    setPptCurrentPage(1)
    setPptActive(true)
    setVideoPlaying(false)
    setVideoCurrentTime(0)
    setVideoAsOf(now)
    setParticipantsOpen(false)
    videoStateRef.current = { url, playing: false, currentTime: 0, ts: now }

    safeSendPpt({ action: "video_start", url })

    setMessages((prev) => [
      ...prev,
      {
        id: `sys-vid-${Date.now()}`,
        from: "system",
        text: "Tutor started playing a video 🎥",
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [safeSendPpt])

  const handleSlidesUploaded = useCallback((data: UploadedSlides) => {
    setShowUpload(false)
    uploadedSlidesRef.current = data
    if (data.kind === "video") {
      handleVideoStart(data.url)
      return
    }
    setPickerData(data)
  }, [handleVideoStart])

  const handleSlidesPicked = useCallback((selected: number[]) => {
    if (!pickerData || selected.length === 0) return

    const { url, total } = pickerData
    const firstPage = selected[0]

    setPickerData(null)
    setPresentKind("slides")
    setSelectedSlides(selected)
    setPptUrl(url)
    setPptTotalPages(total)
    setPptCurrentPage(firstPage)
    setPptActive(true)
    setParticipantsOpen(false)
    setSlideTrayOpen(true)

    safeSendPpt({ action: "start", url, total, page: firstPage })

    setMessages((prev) => [
      ...prev,
      {
        id: `sys-ppt-${Date.now()}`,
        from: "system",
        text: `Tutor started presenting ${selected.length} slide${selected.length !== 1 ? "s" : ""} 📊`,
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [pickerData, safeSendPpt])

  // Next/prev walk through the selected subset relative to the page currently
  // on screen. Deriving position from `pptCurrentPage` (rather than tracking a
  // separate index) keeps navigation coherent when the tutor live-excludes or
  // jumps to a slide via the tray.
  const handlePptNext = useCallback(() => {
    if (!selectedSlides.length) return
    const next = selectedSlides.find((p) => p > pptCurrentPage)
    if (next === undefined) return
    setPptCurrentPage(next)
    safeSendPpt({ action: "navigate", page: next })
  }, [pptCurrentPage, selectedSlides, safeSendPpt])

  const handlePptPrev = useCallback(() => {
    if (!selectedSlides.length) return
    let prev: number | undefined
    for (const p of selectedSlides) {
      if (p < pptCurrentPage) prev = p
      else break
    }
    if (prev === undefined) return
    setPptCurrentPage(prev)
    safeSendPpt({ action: "navigate", page: prev })
  }, [pptCurrentPage, selectedSlides, safeSendPpt])

  // Jump to an arbitrary slide from the live tray. Doesn't change the
  // included/excluded set — the tutor toggles that separately.
  const handlePptJump = useCallback((page: number) => {
    if (!pptActive || page < 1 || page > pptTotalPages) return
    if (page === pptCurrentPage) return
    setPptCurrentPage(page)
    safeSendPpt({ action: "navigate", page })
  }, [pptActive, pptTotalPages, pptCurrentPage, safeSendPpt])

  // Add/remove a slide from the navigation sequence mid-lesson. Preserves
  // ascending order so next/prev remain monotonic.
  const handleToggleSelected = useCallback((page: number) => {
    setSelectedSlides((prev) => {
      if (prev.includes(page)) return prev.filter((p) => p !== page)
      const next = [...prev, page]
      next.sort((a, b) => a - b)
      return next
    })
  }, [])

  // ── Video handlers (tutor only) ────────────────────────────────────────────
  // Each DOM event on the tutor's <video> broadcasts the new playback state so
  // students can mirror. We also stash the latest snapshot so sync_request from
  // late joiners returns the current position + play/pause.
  const broadcastVideoState = useCallback((playing: boolean, currentTime: number) => {
    if (!isTutor) return
    const ts = Date.now()
    const url = videoStateRef.current.url || pptUrl || ""
    videoStateRef.current = { url, playing, currentTime, ts }
    safeSendPpt({ action: "video_state", playing, currentTime, ts })
  }, [isTutor, pptUrl, safeSendPpt])

  const handleVideoPlayPause = useCallback((playing: boolean, currentTime: number) => {
    broadcastVideoState(playing, currentTime)
  }, [broadcastVideoState])

  const handleVideoSeek = useCallback((currentTime: number) => {
    // Preserve whatever the tutor's player is actually doing (it may still be
    // playing through the seek) — we read it from the ref rather than flipping.
    broadcastVideoState(videoStateRef.current.playing, currentTime)
  }, [broadcastVideoState])

  // ── Finger pointer handlers (tutor only) ───────────────────────────────────

  const safeSendPointer = useCallback((data: PointerAction) => {
    if (connectionState !== ConnectionState.Connected) return
    if (typeof sendPointer !== "function") return
    try {
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

  // ── Background blur ────────────────────────────────────────────────────────
  // Returns the LocalVideoTrack the user is currently publishing (or null).
  const getLocalCameraTrack = useCallback(() => {
    const pub = localParticipant?.getTrackPublication(Track.Source.Camera)
    return pub?.track ?? null
  }, [localParticipant])

  const handleToggleBlur = useCallback(async () => {
    if (blurBusy) return
    const track = getLocalCameraTrack()
    // Turning blur OFF doesn't need a camera — we just record the pref off and
    // detach if there's a track. Turning it ON needs an active camera track.
    if (!track && !blurEnabled) {
      toast.info("Turn your camera on first to blur the background")
      return
    }
    setBlurBusy(true)
    try {
      if (blurEnabled) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const liveTrack = track as any
        if (liveTrack && typeof liveTrack.stopProcessor === "function") {
          await liveTrack.stopProcessor()
        }
        blurProcessorRef.current = null
        setBlurEnabled(false)
        writeBlurPreference(false)
        return
      }
      const mod = await import("@livekit/track-processors")
      if (!mod.supportsBackgroundProcessors()) {
        toast.error("Background blur isn't supported on this browser")
        return
      }
      // Just flip state — the auto-apply effect below creates the processor
      // and attaches it. Calling setProcessor here too would run it twice in
      // a row and hang the main thread long enough to trigger Chrome's
      // "Page Unresponsive" dialog mid-session.
      setBlurEnabled(true)
      writeBlurPreference(true)
    } catch (err) {
      console.error("[blur] toggle failed", err)
      toast.error("Couldn't toggle background blur")
    } finally {
      setBlurBusy(false)
    }
  }, [blurBusy, blurEnabled, getLocalCameraTrack])

  // Remind tutor to start recording when they enter the classroom.
  useEffect(() => {
    if (!isTutor || recordingReminderShown.current) return
    if (connectionState !== ConnectionState.Connected) return
    recordingReminderShown.current = true
    toast.info("Click Start Rec in the controls bar when you're ready to record this session.", {
      duration: 12_000,
    })
  }, [isTutor, connectionState])

  // Tutor starts, pauses, or resumes recording. Each pause/resume creates a
  // separate MP4 segment in S3.
  const handleToggleRecording = useCallback(async () => {
    if (!isTutor || recordingBusy) return
    setRecordingBusy(true)

    const prevStarted = recordingStarted
    const prevPaused = recordingPaused

    if (!recordingStarted) {
      setRecordingStarted(true)
      setRecordingPaused(false)
    } else {
      setRecordingPaused(!recordingPaused)
    }

    try {
      const endpoint = !prevStarted
        ? `/api/sessions/${sessionId}/recording/start`
        : prevPaused
          ? `/api/sessions/${sessionId}/recording/resume`
          : `/api/sessions/${sessionId}/recording/pause`
      const res = await fetch(endpoint, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message || "Recording control failed")
      }
      if (!prevStarted) {
        toast.success("Recording started")
      } else {
        toast.success(prevPaused ? "Recording resumed" : "Recording paused")
      }
    } catch (err) {
      console.error("[recording] toggle failed", err)
      setRecordingStarted(prevStarted)
      setRecordingPaused(prevPaused)
      toast.error("Couldn't change recording state")
    } finally {
      setRecordingBusy(false)
    }
  }, [isTutor, recordingBusy, recordingStarted, recordingPaused, sessionId])

  // Attach the processor to the local camera track. One effect handles three
  // cases: (a) first publish after joining when the lobby pref is on, (b)
  // re-publish after a camera off/on cycle, (c) toggling blur on inside the
  // room when the processor doesn't exist yet. The processor instance is
  // cached so we don't pay the MediaPipe model fetch on every reattach.
  const localCameraTrack = useMemo(
    () => localParticipant?.getTrackPublication(Track.Source.Camera)?.track ?? null,
    // The participant object's identity is stable; LiveKit mutates it in place,
    // so we depend on the publication's underlying track via this ref read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localParticipant, localParticipant?.getTrackPublication(Track.Source.Camera)?.track],
  )
  useEffect(() => {
    if (!blurEnabled || !localCameraTrack) return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveTrack = localCameraTrack as any

    ;(async () => {
      try {
        if (!blurProcessorRef.current) {
          const mod = await import("@livekit/track-processors")
          if (cancelled || !mod.supportsBackgroundProcessors()) return
          blurProcessorRef.current = mod.BackgroundProcessor({
            mode: "background-blur",
            blurRadius: 12,
          })
        }
        if (cancelled) return
        await liveTrack.setProcessor(blurProcessorRef.current)
      } catch (err) {
        console.warn("[blur] auto-apply failed", err)
      }
    })()

    return () => { cancelled = true }
  }, [blurEnabled, localCameraTrack])

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

  // Spotlight directly on a specific identity (used from the right-click
  // context menu, where we act on the clicked participant rather than on
  // whoever happens to be pinned).
  const handleToggleSpotlightFor = useCallback((identity: string) => {
    if (!isTutor) return
    if (spotlightedId === identity) {
      setSpotlightedId(null)
      safeSendSpotlight({ action: "clear" })
    } else {
      setSpotlightedId(identity)
      safeSendSpotlight({ action: "set", identity })
    }
  }, [isTutor, spotlightedId, safeSendSpotlight])

  // ── Pop-out handlers ───────────────────────────────────────────────────────
  // Participants popped out render as draggable/resizable floating windows so
  // the tutor can watch several students at once without pinning each.

  const handlePopOut = useCallback((identity: string) => {
    setPoppedOutIds((prev) => (prev.includes(identity) ? prev : [...prev, identity]))
  }, [])

  const handleClosePopOut = useCallback((identity: string) => {
    setPoppedOutIds((prev) => prev.filter((id) => id !== identity))
  }, [])

  // ── Remove-participant handlers (tutor only) ───────────────────────────────

  const handleRequestRemove = useCallback((identity: string, name: string) => {
    if (!isTutor) return
    setPendingRemoval({ identity, name })
  }, [isTutor])

  const [removingParticipant, setRemovingParticipant] = useState(false)
  const confirmRemoveParticipant = useCallback(async () => {
    if (!pendingRemoval) return
    setRemovingParticipant(true)
    try {
      const res = await fetch(
        `/api/tutor/sessions/${sessionId}/participants/${encodeURIComponent(pendingRemoval.identity)}`,
        { method: "DELETE" },
      )
      const data = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) {
        toast.error(data.message ?? "Could not remove participant.")
        return
      }
      toast.success(`${pendingRemoval.name} was removed from the session.`)
      // Also close any floating window showing them, and unpin if needed.
      setPoppedOutIds((prev) => prev.filter((id) => id !== pendingRemoval.identity))
      setPinnedId((prev) => (prev === pendingRemoval.identity ? null : prev))
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-remove-${Date.now()}`,
          from: "system",
          text: `${pendingRemoval.name} was removed from the session`,
          ts: Date.now(),
          type: "system",
        },
      ])
      setPendingRemoval(null)
    } catch {
      toast.error("Could not remove participant — network error.")
    } finally {
      setRemovingParticipant(false)
    }
  }, [pendingRemoval, sessionId])

  // If the tutor unpins locally, stop any spotlight they were running
  useEffect(() => {
    if (!isTutor) return
    if (spotlightedId && pinnedId !== spotlightedId) {
      setSpotlightedId(null)
      safeSendSpotlight({ action: "clear" })
    }
  }, [isTutor, pinnedId, spotlightedId, safeSendSpotlight])

  const handlePptStop = useCallback(() => {
    const wasVideo = presentKind === "video"

    setPptActive(false)
    setPresentKind(null)
    setPptUrl(null)
    setPptCurrentPage(1)
    setPptTotalPages(0)
    setSelectedSlides([])
    setParticipantsOpen(true)
    setVideoPlaying(false)
    setVideoCurrentTime(0)
    videoStateRef.current = { url: "", playing: false, currentTime: 0, ts: 0 }

    safeSendPpt(wasVideo ? { action: "video_stop" } : { action: "stop" })

    setMessages((prev) => [
      ...prev,
      {
        id: `sys-ppt-end-${Date.now()}`,
        from: "system",
        text: wasVideo ? "Video ended" : "Slide presentation ended",
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [presentKind, safeSendPpt])

  const broadcastMicControl = useCallback((payload: MuteAction) => {
    if (connectionState !== ConnectionState.Connected) return false
    try {
      sendMuteAll(enc.encode(JSON.stringify(payload)), { reliable: true })
      return true
    } catch {
      return false
    }
  }, [connectionState, sendMuteAll])

  const patchParticipantMic = useCallback(async (identity: string, enabled: boolean) => {
    const res = await fetch(
      `/api/tutor/sessions/${sessionId}/participants/${encodeURIComponent(identity)}/mic`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(err.message ?? "Could not update microphone")
    }
  }, [sessionId])

  const handleSetParticipantMic = useCallback(async (identity: string, name: string, enabled: boolean) => {
    if (!isTutor) return
    try {
      await patchParticipantMic(identity, enabled)
      // Give LiveKit a moment to apply publish permissions before the student publishes.
      if (enabled) {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      const ok = broadcastMicControl({ action: "set-mic", identity, enabled, from: localName })
      if (!ok) throw new Error("Could not notify the student")
      toast.success(enabled ? `${name}'s microphone is on` : `${name}'s microphone is off`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update microphone")
    }
  }, [isTutor, patchParticipantMic, broadcastMicControl, localName])

  // ── Request-to-speak (tutor approves/denies; student asks) ─────────────────
  const handleAcceptSpeak = useCallback((identity: string, name: string) => {
    if (!isTutor) return
    setSpeakRequests((prev) => prev.filter((r) => r.identity !== identity))
    const ok = broadcastMicControl({ action: "accept-speak", identity, from: localName })
    if (!ok) {
      toast.error("Could not notify the student")
      return
    }
    toast.success(`Accepted ${name}'s request`, {
      description: "Their microphone stays off until you enable it from the participant controls.",
    })
  }, [isTutor, broadcastMicControl, localName])

  const handleDenySpeak = useCallback((identity: string, name: string) => {
    if (!isTutor) return
    setSpeakRequests((prev) => prev.filter((r) => r.identity !== identity))
    broadcastMicControl({ action: "deny-speak", identity, from: localName })
    toast.info(`Declined ${name}'s request to speak`)
  }, [isTutor, broadcastMicControl, localName])

  // Student asks to be unmuted. Throttled so a double-tap doesn't spam the tutor.
  const lastSpeakRequestRef = useRef(0)
  const handleRequestToSpeak = useCallback(() => {
    if (isTutor) return
    if (localParticipant.isMicrophoneEnabled) return
    const now = Date.now()
    if (now - lastSpeakRequestRef.current < 5000) {
      toast.info("Request already sent — give your tutor a moment")
      return
    }
    lastSpeakRequestRef.current = now
    const ok = broadcastMicControl({ action: "request-speak", identity: localParticipant.identity, name: localName })
    if (ok) {
      toast.info("Asked to speak ✋", { description: "Waiting for your tutor to turn your mic on." })
    } else {
      toast.error("Couldn't send your request — try again in a moment")
    }
  }, [isTutor, broadcastMicControl, localParticipant, localName])

  // Tidy the pending list if a requester leaves the room before being answered.
  useEffect(() => {
    if (!isTutor || speakRequests.length === 0) return
    const present = new Set(participants.map((p) => p.identity))
    setSpeakRequests((prev) => {
      const next = prev.filter((r) => present.has(r.identity))
      return next.length === prev.length ? prev : next
    })
  }, [isTutor, participants, speakRequests.length])

  // ── Mute-all handler (tutor only) ──────────────────────────────────────────
  const handleMuteAll = useCallback(async () => {
    if (!isTutor) return
    if (connectionState !== ConnectionState.Connected) return

    const students = participants.filter((p) => p.metadata !== "tutor")
    try {
      await Promise.all(students.map((p) => patchParticipantMic(p.identity, false)))
      if (!broadcastMicControl({ action: "mute-all", from: localName })) {
        throw new Error("Could not notify students")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't mute all students")
      return
    }

    toast.success("Every student's microphone has been muted.")
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-mute-${Date.now()}`,
        from: "system",
        text: "Tutor muted everyone's microphone 🔇",
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [isTutor, connectionState, localName, participants, patchParticipantMic, broadcastMicControl])

  const handleUnmuteAll = useCallback(async () => {
    if (!isTutor) return
    if (connectionState !== ConnectionState.Connected) return

    const students = participants.filter((p) => p.metadata !== "tutor")
    try {
      await Promise.all(students.map((p) => patchParticipantMic(p.identity, true)))
      const from = localName
      const sent = students.every((p) =>
        broadcastMicControl({ action: "set-mic", identity: p.identity, enabled: true, from })
      )
      if (!sent) throw new Error("Could not notify students")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't unmute all students")
      return
    }

    toast.success("Every student's microphone has been turned on.")
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-unmute-${Date.now()}`,
        from: "system",
        text: "Tutor turned on everyone's microphone 🎙️",
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [isTutor, connectionState, localName, participants, patchParticipantMic, broadcastMicControl])

  // ── Refresh-for-everyone flow (tutor only) ────────────────────────────────
  // Two-step: button opens a shadcn Dialog; user confirms inside the dialog,
  // which broadcasts and then reloads the tutor after a short delay so the
  // signal has time to leave the wire before the tutor's page unmounts.

  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false)

  const handleRefreshAll = useCallback(() => {
    if (!isTutor) return
    if (connectionState !== ConnectionState.Connected) {
      toast.error("Not connected to the room yet — try again in a moment.")
      return
    }
    setRefreshConfirmOpen(true)
  }, [isTutor, connectionState])

  const confirmRefreshAll = useCallback(() => {
    if (!isTutor) return
    if (connectionState !== ConnectionState.Connected) {
      toast.error("Not connected to the room yet — try again in a moment.")
      setRefreshConfirmOpen(false)
      return
    }
    try {
      const payload: SessionControlAction = { action: "refresh", from: localName }
      sendControl(enc.encode(JSON.stringify(payload)), { reliable: true })
    } catch {
      toast.error("Couldn't send the refresh signal — try again.")
      return
    }
    setRefreshConfirmOpen(false)
    toast.info("Refreshing the classroom for everyone…")
    setTimeout(() => window.location.reload(), 800)
  }, [isTutor, connectionState, localName, sendControl])

  // ── Whiteboard handlers (start/stop/clear tutor-only; draw when allowed) ───

  const canWriteWhiteboard = isTutor || whiteboardStudentWrite

  const safeSendWhiteboard = useCallback((data: WhiteboardAction) => {
    if (connectionState !== ConnectionState.Connected) return
    if (typeof sendWhiteboard !== "function") return
    try {
      // Cursor/presence frames are high-churn and disposable — send lossily so
      // they never queue up behind (or delay) reliable document diffs.
      const result = sendWhiteboard(enc.encode(JSON.stringify(data)), {
        reliable: data.action !== "presence",
      }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore transient LiveKit errors */ })
      }
    } catch { /* ignore */ }
  }, [connectionState, sendWhiteboard])

  const handleToggleWhiteboard = useCallback(() => {
    if (!isTutor) return
    if (whiteboardActive) {
      setWhiteboardActive(false)
      setWhiteboardStudentWrite(false)
      wbApiRef.current = null
      wbPendingRef.current = { changes: [] }
      safeSendWhiteboard({ action: "stop" })
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-wb-stop-${Date.now()}`,
          from: "system",
          text: "Whiteboard closed",
          ts: Date.now(),
          type: "system",
        },
      ])
    } else {
      // Close any active presentation first — mutually exclusive surfaces.
      if (pptActive) {
        setPptActive(false)
        setPptUrl(null)
        setPresentKind(null)
        safeSendPpt({ action: "stop" })
      }
      setWhiteboardActive(true)
      setWhiteboardStudentWrite(false)
      safeSendWhiteboard({ action: "start" })
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-wb-start-${Date.now()}`,
          from: "system",
          text: "Tutor opened the whiteboard ✏️ — only the tutor can draw for now.",
          ts: Date.now(),
          type: "system",
        },
      ])
    }
    // safeSendPpt lives above — adding it to deps keeps useCallback coherent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, whiteboardActive, pptActive, safeSendWhiteboard])

  const handleToggleStudentWrite = useCallback(() => {
    if (!isTutor || !whiteboardActive) return
    const enabled = !whiteboardStudentWrite
    setWhiteboardStudentWrite(enabled)
    safeSendWhiteboard({ action: "student_write", enabled })
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-wb-write-${Date.now()}`,
        from: "system",
        text: enabled
          ? "Tutor let students write on the whiteboard ✏️"
          : "Tutor took back whiteboard control — students can view only.",
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [isTutor, whiteboardActive, whiteboardStudentWrite, safeSendWhiteboard])

  // Broadcast a local tldraw store diff to everyone (called by TldrawBoard).
  const handleWhiteboardSend = useCallback((action: WhiteboardAction) => {
    safeSendWhiteboard(action)
  }, [safeSendWhiteboard])

  // Late-joining student asks the tutor for the current whiteboard state.
  const hasSentWhiteboardSync = useRef(false)
  useEffect(() => {
    if (isTutor || hasSentWhiteboardSync.current) return
    if (connectionState !== ConnectionState.Connected) return
    const timer = setTimeout(() => {
      hasSentWhiteboardSync.current = true
      try {
        sendWhiteboard(enc.encode(JSON.stringify({ action: "sync_request" })), { reliable: true })
      } catch {
        hasSentWhiteboardSync.current = false
      }
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState])

  // Drop a peer's whiteboard cursor when they leave the room, so stale cursors
  // don't linger on the canvas. (Presence records are keyed off identity.)
  const prevWbPeers = useRef<Set<string>>(new Set())
  useEffect(() => {
    const current = new Set(participants.map((p) => p.identity))
    for (const id of prevWbPeers.current) {
      if (!current.has(id)) wbApiRef.current?.removePeer(id)
    }
    prevWbPeers.current = current
  }, [participants])

  // ── Keyboard shortcuts for slide navigation ────────────────────────────────
  // Video mode owns its own keyboard (native <video> controls handle seek/space),
  // so we only attach this listener when slides are on screen.
  useEffect(() => {
    if (!isTutor || !pptActive || presentKind !== "slides") return
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        handlePptNext()
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        handlePptPrev()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isTutor, pptActive, presentKind, handlePptNext, handlePptPrev])

  // ── Breakout handlers (tutor only) ─────────────────────────────────────────

  const safeSendBreakout = useCallback((data: BreakoutAction) => {
    if (connectionState !== ConnectionState.Connected) return
    if (typeof sendBreakout !== "function") return
    try {
      const result = sendBreakout(enc.encode(JSON.stringify(data)), { reliable: true }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore */ })
      }
    } catch { /* ignore */ }
  }, [connectionState, sendBreakout])

  const handleStartBreakouts = useCallback((groups: BreakoutGroup[], durationMin: number | null) => {
    if (!isTutor) return
    const startedAt = Date.now()
    setBreakoutsActive(true)
    setBreakoutGroups(groups)
    setVisitingGroupId(null)
    setBreakoutStartedAt(startedAt)
    setBreakoutDurationMin(durationMin)
    setBreakoutClosingAt(null)
    setBreakoutsPanelOpen(false)
    setBreakoutMonitorOpen(true)
    setParticipantsOpen(true)
    safeSendBreakout({
      action: "start",
      groups,
      visitingGroupId: null,
      startedAt,
      durationMin: durationMin ?? null,
    })
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-bo-start-${Date.now()}`,
        from: "system",
        text: `Breakouts started — ${groups.length} group${groups.length !== 1 ? "s" : ""} 👥`,
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [isTutor, safeSendBreakout])

  const handleUpdateBreakouts = useCallback((groups: BreakoutGroup[]) => {
    if (!isTutor) return
    const snap = breakoutStateRef.current
    const startedAt = snap.startedAt ?? Date.now()
    if (!snap.startedAt) setBreakoutStartedAt(startedAt)
    setBreakoutsActive(true)
    setBreakoutGroups(groups)
    safeSendBreakout({
      action: "update",
      groups,
      startedAt,
      durationMin: snap.durationMin,
    })
    toast.success("Breakout assignments shared with the class")
  }, [isTutor, safeSendBreakout])

  // A student who drops off Wi-Fi comes back as a brand-new LiveKit identity and
  // has no idea breakouts are running. They do ask for a sync on connect, but
  // that request can land before the tutor's handler is wired up or be dropped
  // outright — so the tutor also pushes the current snapshot whenever a new
  // participant appears while breakouts are live. Membership is keyed on the
  // stable user id, so the returning student drops straight back into the same
  // group with no action from the tutor.
  const knownIdentitiesRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!isTutor) return
    const current = new Set(participants.map((p) => p.identity))
    const newcomers = [...current].filter((id) => !knownIdentitiesRef.current.has(id))
    knownIdentitiesRef.current = current
    if (newcomers.length === 0) return

    const snap = breakoutStateRef.current
    if (!snap.active) return

    // Small delay so the newcomer's data-channel handlers are listening.
    const timer = setTimeout(() => {
      safeSendBreakout({
        action: "sync_response",
        active: snap.active,
        groups: snap.groups,
        visitingGroupId: snap.visitingGroupId,
        startedAt: snap.startedAt,
        durationMin: snap.durationMin,
        closingAt: snap.closingAt,
      })
    }, 1200)
    return () => clearTimeout(timer)
  }, [isTutor, participants, safeSendBreakout])

  // Push the deadline out without tearing the rooms down. Broadcasts the whole
  // recomputed timer rather than a delta, so a client that missed an earlier
  // extension still lands on the same deadline as everyone else.
  const handleExtendBreakouts = useCallback((extraMin: number) => {
    if (!isTutor || !Number.isFinite(extraMin) || extraMin <= 0) return
    const snap = breakoutStateRef.current
    if (!snap.active) return

    const now = Date.now()
    const currentDeadline =
      snap.closingAt ??
      (snap.startedAt && snap.durationMin ? snap.startedAt + snap.durationMin * 60_000 : null)
    // Extend from the later of now and the existing deadline: adding time to a
    // breakout that already expired (or is mid wrap-up) still buys a full block.
    const newDeadline = Math.max(currentDeadline ?? now, now) + extraMin * 60_000
    const startedAt = snap.startedAt ?? now
    // Kept fractional on purpose — rounding to whole minutes would drift the
    // clock a little further every time the tutor adds time.
    const durationMin = (newDeadline - startedAt) / 60_000

    setBreakoutStartedAt(startedAt)
    setBreakoutDurationMin(durationMin)
    setBreakoutClosingAt(null)
    safeSendBreakout({ action: "extend", startedAt, durationMin, addedMin: extraMin })

    toast.success(`Added ${extraMin} more minute${extraMin !== 1 ? "s" : ""}`, {
      description: "Everyone's countdown has been updated.",
    })
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-bo-extend-${Date.now()}`,
        from: "system",
        text: `Breakouts extended by ${extraMin} minute${extraMin !== 1 ? "s" : ""} ⏱️`,
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [isTutor, safeSendBreakout])

  const handleVisitBreakout = useCallback((groupId: string | null) => {
    if (!isTutor) return
    setVisitingGroupId(groupId)
    safeSendBreakout({ action: "visit", groupId })
    if (groupId) {
      const g = breakoutStateRef.current.groups.find((x) => x.id === groupId)
      if (g) toast.info(`You joined ${g.name}`, { description: "Students in this group hear your mic now." })
    } else {
      toast.info("Left breakout group — back to main room")
    }
  }, [isTutor, safeSendBreakout])

  const finalizeStopBreakouts = useCallback(() => {
    if (!isTutor) return
    setBreakoutsActive(false)
    setBreakoutGroups([])
    setVisitingGroupId(null)
    setBreakoutStartedAt(null)
    setBreakoutDurationMin(null)
    setBreakoutClosingAt(null)
    setBreakoutsPanelOpen(false)
    setBreakoutMonitorOpen(false)
    safeSendBreakout({ action: "stop" })
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-bo-end-${Date.now()}`,
        from: "system",
        text: "Breakouts ended — everyone's back together",
        ts: Date.now(),
        type: "system",
      },
    ])
  }, [isTutor, safeSendBreakout])

  /** Tutor clicked End — start a visible wrap-up countdown, then return to main room. */
  const handleRequestEndBreakouts = useCallback(() => {
    if (!isTutor || !breakoutsActive) return
    if (breakoutClosingAt) return
    const endsAt = Date.now() + BREAKOUT_WRAP_UP_SEC * 1000
    setBreakoutClosingAt(endsAt)
    safeSendBreakout({ action: "closing", endsAt })
    toast.info(`Ending breakouts in ${BREAKOUT_WRAP_UP_SEC} seconds`, {
      description: "Students can finish signing — click End now to skip the wait.",
    })
  }, [isTutor, breakoutsActive, breakoutClosingAt, safeSendBreakout])

  // ── Nudge handler (tutor only) ─────────────────────────────────────────────
  // Sends a short attention signal to the whole class, or to a specific
  // breakout group when `groupId` is provided. Also echoes locally so the
  // tutor visually confirms the ping went out.
  const handleNudge = useCallback((opts?: { groupId?: string | null; message?: string }) => {
    if (!isTutor) return
    if (connectionState !== ConnectionState.Connected) {
      toast.error("Not connected yet — try again in a second.")
      return
    }
    const payload: NudgeAction = {
      action: "nudge",
      from: localName,
      groupId: opts?.groupId ?? null,
      message: opts?.message ?? null,
    }
    try {
      sendNudge(enc.encode(JSON.stringify(payload)), { reliable: true })
    } catch {
      toast.error("Couldn't send the nudge — please try again.")
      return
    }
    // Local echo so the tutor sees the same flash their students will.
    setActiveNudge({ id: Date.now(), from: localName, message: opts?.message ?? null })
    if (opts?.groupId) {
      const g = breakoutStateRef.current.groups.find((x) => x.id === opts.groupId)
      toast.success(g ? `Nudged ${g.name}` : "Nudge sent")
    } else {
      toast.success("Nudged the whole class")
    }
  }, [isTutor, connectionState, localName, sendNudge])

  // ── Screen share privacy handlers ─────────────────────────────────────────

  const safeSendScreen = useCallback((data: ScreenAction) => {
    if (connectionState !== ConnectionState.Connected) return
    if (typeof sendScreen !== "function") return
    try {
      const result = sendScreen(enc.encode(JSON.stringify(data)), { reliable: true }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore */ })
      }
    } catch { /* ignore */ }
  }, [connectionState, sendScreen])

  const handleToggleScreenPrivacy = useCallback(() => {
    if (!isTutor) return
    const next = !screenPrivate
    setScreenPrivate(next)
    safeSendScreen({ action: "privacy", private: next })
    toast.info(
      next
        ? "Screen is now private — students see a placeholder."
        : "Screen is now visible to students."
    )
  }, [isTutor, screenPrivate, safeSendScreen])

  // Student: ask for current privacy state when joining while screen share is live
  const hasSentScreenSync = useRef(false)
  useEffect(() => {
    if (isTutor || hasSentScreenSync.current) return
    if (connectionState !== ConnectionState.Connected) return
    const timer = setTimeout(() => {
      hasSentScreenSync.current = true
      try {
        sendScreen(enc.encode(JSON.stringify({ action: "sync_request" })), { reliable: true })
      } catch {
        hasSentScreenSync.current = false
      }
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState])

  // ── Breakout-derived filters (everyone) ────────────────────────────────────
  // Used to gate audio + participant tiles. The tutor identity is resolved via
  // metadata so we don't need a separate prop plumbing.

  const tutorIdentity = useMemo(
    () => participants.find((p) => p.metadata === "tutor")?.identity ?? null,
    [participants]
  )

  const ownBreakoutGroup = useMemo(
    () => breakoutGroups.find((g) => g.memberIds.includes(localBaseId)) ?? null,
    [breakoutGroups, localBaseId]
  )

  // Student: remember which breakout group we're in. `sessionStorage` outlives a
  // reload and a re-login in the same tab, which is what lets the sync handler
  // above tell a return apart from a first placement.
  useEffect(() => {
    if (isTutor) return
    try {
      if (!breakoutsActive) sessionStorage.removeItem(breakoutGroupStorageKey(sessionId))
      else if (ownBreakoutGroup) {
        sessionStorage.setItem(breakoutGroupStorageKey(sessionId), ownBreakoutGroup.id)
      }
    } catch { /* storage may be disabled */ }
  }, [isTutor, breakoutsActive, ownBreakoutGroup, sessionId])

  // Is the tutor present in *this* client's breakout context? Sending the class
  // into breakouts must not leave the tutor sitting inside every room: they only
  // arrive in a group once they explicitly visit it. A student who was never
  // assigned to a group stays behind with the tutor in the main room, so they
  // aren't stranded alone. Both audio and video gating read this one predicate
  // so the two can never drift apart.
  const tutorPresentForMe = useMemo(() => {
    if (!breakoutsActive || isTutor || !tutorIdentity) return false
    if (ownBreakoutGroup) return visitingGroupId === ownBreakoutGroup.id
    return visitingGroupId === null
  }, [breakoutsActive, isTutor, tutorIdentity, ownBreakoutGroup, visitingGroupId])

  // `null` → no filtering, play/show everyone (the default pre-breakout behaviour).
  const audibleIdentities = useMemo<Set<string> | null>(() => {
    if (!breakoutsActive) return null
    const audible = new Set<string>()
    if (isTutor) {
      // Tutor hears only the group they're currently visiting. Focused-student
      // audio in the monitor is rendered separately inside BreakoutMonitor.
      if (visitingGroupId) {
        const g = breakoutGroups.find((x) => x.id === visitingGroupId)
        if (g) liveIdentitiesFor(g.memberIds).forEach((id) => audible.add(id))
      }
    } else {
      // Student: own group-mates + tutor (only if tutor is visiting this group).
      if (ownBreakoutGroup) {
        liveIdentitiesFor(ownBreakoutGroup.memberIds).forEach((id) => audible.add(id))
      }
      if (tutorIdentity && tutorPresentForMe) audible.add(tutorIdentity)
    }
    audible.delete(localParticipant.identity)
    return audible
  }, [breakoutsActive, isTutor, visitingGroupId, breakoutGroups, ownBreakoutGroup, tutorIdentity, tutorPresentForMe, liveIdentitiesFor, localParticipant.identity])

  const visibleIdentities = useMemo<Set<string> | null>(() => {
    if (!breakoutsActive) return null
    if (isTutor) return null   // tutors see everyone in the participants strip
    const visible = new Set<string>()
    if (ownBreakoutGroup) liveIdentitiesFor(ownBreakoutGroup.memberIds).forEach((id) => visible.add(id))
    // Same rule as audio: the tutor appears only once they join this group.
    if (tutorIdentity && tutorPresentForMe) visible.add(tutorIdentity)
    return visible
  }, [breakoutsActive, isTutor, ownBreakoutGroup, tutorIdentity, tutorPresentForMe, liveIdentitiesFor])

  // A pin or a pop-out survives the move into breakouts, so a student who had
  // the tutor pinned (or was pinned onto them by a spotlight) would keep the
  // tutor on screen regardless of the tile filter. Drop anyone this client may
  // no longer see; they come back the moment the tutor visits the group.
  useEffect(() => {
    if (!visibleIdentities || !pinnedId) return
    if (pinnedId === localParticipant.identity) return
    if (!visibleIdentities.has(pinnedId)) setPinnedId(null)
  }, [visibleIdentities, pinnedId, localParticipant.identity])

  useEffect(() => {
    if (!visibleIdentities) return
    setPoppedOutIds((prev) => {
      const next = prev.filter(
        (id) => id === localParticipant.identity || visibleIdentities.has(id),
      )
      return next.length === prev.length ? prev : next
    })
  }, [visibleIdentities, localParticipant.identity])

  // Whether this client may render the tutor's camera at all. Drives the
  // split-screen inset used by whiteboard / slides / screen-share modes.
  const tutorCameraVisible = !visibleIdentities || !tutorIdentity || visibleIdentities.has(tutorIdentity)

  const groupLabels = useMemo(() => {
    if (!breakoutsActive || breakoutGroups.length === 0) return null
    const palette = ["#60a5fa", "#f472b6", "#fb923c", "#34d399", "#a78bfa", "#facc15", "#22d3ee", "#f87171"]
    const map = new Map<string, { name: string; color: string }>()
    breakoutGroups.forEach((g, idx) => {
      const color = palette[idx % palette.length]
      liveIdentitiesFor(g.memberIds).forEach((id) => map.set(id, { name: g.name, color }))
    })
    return map
  }, [breakoutsActive, breakoutGroups, liveIdentitiesFor])

  // One-shot warning so students & tutor get a heads-up before auto-close.
  const endWarningShownRef = useRef<number | null>(null)

  // Wall-clock deadline shown on the countdown — session timer and/or wrap-up.
  const breakoutEndsAt = useMemo(() => {
    if (breakoutClosingAt) return breakoutClosingAt
    if (!breakoutsActive || !breakoutStartedAt || !breakoutDurationMin) return null
    return breakoutStartedAt + breakoutDurationMin * 60_000
  }, [breakoutsActive, breakoutStartedAt, breakoutDurationMin, breakoutClosingAt])

  // During breakouts, students see a group-mate (or visiting tutor) on the main stage.
  const studentBreakoutMainId = useMemo(() => {
    if (isTutor || !breakoutsActive || !ownBreakoutGroup) return null
    if (visitingGroupId === ownBreakoutGroup.id && tutorIdentity) return tutorIdentity
    return liveIdentitiesFor(ownBreakoutGroup.memberIds).find((id) => id !== localParticipant.identity) ?? null
  }, [
    isTutor,
    breakoutsActive,
    ownBreakoutGroup,
    visitingGroupId,
    tutorIdentity,
    liveIdentitiesFor,
    localParticipant.identity,
  ])

  // Auto-close when the timer expires. Only the tutor client drives the stop
  // broadcast so students don't race with each other to fire it. Also shows
  // a one-time 30-second warning toast to everyone so nobody is surprised.
  useEffect(() => {
    if (!breakoutsActive || !breakoutEndsAt) {
      endWarningShownRef.current = null
      return
    }

    const tick = () => {
      const remaining = breakoutEndsAt - Date.now()

      if (remaining <= 30_000 && remaining > 0 && endWarningShownRef.current !== breakoutEndsAt) {
        endWarningShownRef.current = breakoutEndsAt
        toast.info("Breakouts ending in 30 seconds", {
          description: "Wrap up — we'll return to the main room shortly.",
        })
      }

      if (remaining <= 0 && isTutor) {
        if (breakoutClosingAt) {
          finalizeStopBreakouts()
        } else if (breakoutDurationMin && breakoutStartedAt) {
          handleRequestEndBreakouts()
        }
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [
    breakoutsActive,
    breakoutEndsAt,
    breakoutClosingAt,
    breakoutDurationMin,
    breakoutStartedAt,
    isTutor,
    finalizeStopBreakouts,
    handleRequestEndBreakouts,
  ])

  // Student list (no tutor) — used by the manager panel. Keyed by the stable
  // user id, so assignments made here survive a student's reconnect, and a
  // student caught mid-reconnect (old + new connection both present) shows up
  // once rather than twice.
  const studentList = useMemo(() => {
    const byBaseId = new Map<string, { identity: string; name: string }>()
    for (const p of participants) {
      if (p.metadata === "tutor") continue
      const base = participantBaseId(p.identity)
      byBaseId.set(base, { identity: base, name: p.name ?? base })
    }
    return [...byBaseId.values()]
  }, [participants])

  const studentCount = participants.filter((p) => p.metadata !== "tutor").length

  // Camera panel shown beside the whiteboard, the slides, or a shared screen.
  // Normally the tutor, so students can read BSL alongside the material. During
  // breakouts a student sees their own group here instead — the lesson material
  // stays on screen and they practise it with each other, which is the whole
  // point of sending them into a group. `studentBreakoutMainId` already resolves
  // to the visiting tutor when the tutor has joined that group.
  const splitStageId = pinnedId ?? studentBreakoutMainId
  const splitCameraPanel = splitStageId ? (
    <PinnedVideoArea
      identity={splitStageId}
      localIdentity={localParticipant.identity}
      containerRef={videoContainerRef}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      onUnpin={() => setPinnedId(null)}
      showSpotlight={isTutor && splitStageId !== localParticipant.identity}
      spotlightActive={spotlightedId === splitStageId}
      onToggleSpotlight={handleToggleSpotlight}
      handRaised={raisedHandIds.has(splitStageId)}
      onLowerHand={isTutor ? handleLowerHand : undefined}
    />
  ) : (
    <TutorCameraInset
      hidden={!tutorCameraVisible}
      breakoutGroupName={!isTutor && breakoutsActive ? ownBreakoutGroup?.name ?? null : null}
    />
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white flex flex-col overflow-hidden z-50">
      <AudioRenderer audibleIdentities={audibleIdentities} />

      {/* Brand watermark — visible to all participants. Top-left so it doesn't
          collide with the controls bar at the bottom. */}
      <LogoWatermark className="top-3 left-3" size={44} />

      {/* ── Attention nudge overlay (everyone, triggered by tutor) ── */}
      {activeNudge && (
        <NudgeOverlay
          key={activeNudge.id}
          from={activeNudge.from}
          message={activeNudge.message}
          onDismiss={() => setActiveNudge(null)}
        />
      )}

      {/* ── Breakouts manager (tutor only) ── */}
      {isTutor && breakoutsPanelOpen && (
        <BreakoutsPanel
          students={studentList}
          active={breakoutsActive}
          initialGroups={breakoutGroups}
          visitingGroupId={visitingGroupId}
          endsAt={breakoutEndsAt}
          onStart={handleStartBreakouts}
          onUpdate={handleUpdateBreakouts}
          onVisit={handleVisitBreakout}
          onStop={handleRequestEndBreakouts}
          onEndNow={finalizeStopBreakouts}
          onExtend={handleExtendBreakouts}
          closingAt={breakoutClosingAt}
          onClose={() => setBreakoutsPanelOpen(false)}
        />
      )}

      {/* ── Breakout monitor (tutor only, observe every group's signing) ── */}
      {isTutor && breakoutsActive && breakoutMonitorOpen && (
        <BreakoutMonitor
          groups={breakoutGroups}
          visitingGroupId={visitingGroupId}
          onVisit={handleVisitBreakout}
          onClose={() => setBreakoutMonitorOpen(false)}
          onNudgeGroup={(groupId) => handleNudge({ groupId })}
          onExtend={handleExtendBreakouts}
          endsAt={breakoutEndsAt}
        />
      )}

      {/* ── Upload panel overlay (tutor only) ── */}
      {showUpload && isTutor && (
        <SlideUploadPanel
          sessionId={sessionId}
          onSlidesReady={handleSlidesUploaded}
          onClose={() => setShowUpload(false)}
          previousSlides={uploadedSlidesRef.current}
        />
      )}

      {/* ── Invite second teacher (tutor only) ── */}
      {isTutor && inviteCoTutorOpen && (
        <InviteCoTutorModal
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          onClose={() => setInviteCoTutorOpen(false)}
        />
      )}

      {/* ── Slide picker overlay (tutor only, after upload) ── */}
      {pickerData && isTutor && (
        <SlidePicker
          fileUrl={pickerData.url}
          mimeType={pickerData.mimeType}
          fileName={pickerData.fileName}
          totalPages={pickerData.total}
          onConfirm={handleSlidesPicked}
          onCancel={() => setPickerData(null)}
        />
      )}

      {/* ── Top bar ── */}
      <header className="h-11 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-2 sm:px-4 shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <Radio className="size-3.5 text-rose-500 animate-pulse shrink-0" />
          <span className="font-bold text-sm truncate max-w-[40vw] sm:max-w-xs">{sessionTitle}</span>
          {isTutor && recordingStarted && (
            <span
              className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/55 border border-white/15 text-[10px] font-semibold text-white shrink-0"
              aria-live="polite"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  recordingPaused ? "bg-amber-400" : "bg-rose-500 animate-pulse",
                )}
              />
              {recordingPaused ? "Paused" : "Recording"}
            </span>
          )}
          {pptActive && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
              <Presentation className="size-3" />
              Presenting
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {!isTutor && (
            <button
              type="button"
              onClick={handleToggleHand}
              className={cn(
                "flex items-center gap-1.5 px-2.5 sm:px-3 h-8 rounded-xl text-xs font-medium transition-all shrink-0",
                handRaised
                  ? "bg-amber-500/30 text-amber-300 border border-amber-500/50 animate-pulse"
                  : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-transparent",
              )}
              title={handRaised ? "Lower your hand" : "Raise your hand — your tutor will be notified"}
              aria-label={handRaised ? "Lower hand" : "Raise hand"}
            >
              <HandMetal className="size-3.5 shrink-0" />
              <span className="hidden sm:inline">{handRaised ? "Lower Hand" : "Raise Hand"}</span>
            </button>
          )}
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

      {/* ── Student breakout banner ── */}
      {!isTutor && breakoutsActive && (
        ownBreakoutGroup ? (
          <BreakoutBanner
            group={ownBreakoutGroup}
            allParticipantNames={new Map(participants.map((p) => [participantBaseId(p.identity), p.name ?? p.identity]))}
            tutorVisiting={visitingGroupId === ownBreakoutGroup.id}
            endsAt={breakoutEndsAt}
          />
        ) : (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-[90%] px-4 py-2 rounded-full bg-amber-500/20 border border-amber-500/40 text-xs font-semibold text-amber-100 text-center">
            Breakouts are live — waiting for your group assignment
          </div>
        )
      )}

      {/* ── Requests to speak (tutor only) ── */}
      {isTutor && speakRequests.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 flex-wrap px-3 py-2 bg-sky-500/15 border-b border-sky-500/30">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
            <Mic className="size-3.5 shrink-0" />
            Wants to speak:
          </span>
          {speakRequests.map((r) => (
            <span key={r.identity} className="flex items-center gap-1 bg-sky-500/20 rounded-full pl-2.5 pr-1 py-0.5">
              <span className="text-xs text-sky-100">{r.name}</span>
              <button
                onClick={() => handleAcceptSpeak(r.identity, r.name)}
                className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-200 hover:text-white bg-emerald-500/30 hover:bg-emerald-500/60 rounded-full px-1.5 py-0.5 transition-colors"
                title={`Accept ${r.name}'s request without turning their microphone on`}
              >
                <Check className="size-3" /> Accept
              </button>
              <button
                onClick={() => handleDenySpeak(r.identity, r.name)}
                className="flex items-center gap-0.5 text-[11px] font-semibold text-rose-200 hover:text-white bg-rose-500/30 hover:bg-rose-500/60 rounded-full px-1.5 py-0.5 transition-colors"
                title={`Decline ${r.name}'s request`}
              >
                <X className="size-3" /> Deny
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Main body ── */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative flex-col md:flex-row">

        {/* Stage + participants — left column; chat sits alongside at full height. */}
        <div className="flex flex-1 flex-col overflow-hidden min-h-0 min-w-0">

          {/* Stage row: slides / video / whiteboard. On phones we stack camera/content
              vertically; from md+ we use the side-by-side BSL layout. */}
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0 relative">

          {whiteboardActive ? (
            // ── Whiteboard mode: same deaf-first layout as PPT. Tutor camera on
            // the LEFT so signing stays visible while everyone draws on the RIGHT.
            <>
              <div className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden bg-zinc-900 relative">
                {splitCameraPanel}
              </div>

              <div className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden relative border-t md:border-t-0 md:border-l border-zinc-800">
                <TldrawBoard
                  isTutor={isTutor}
                  canWrite={canWriteWhiteboard}
                  studentsCanWrite={whiteboardStudentWrite}
                  onToggleStudentWrite={handleToggleStudentWrite}
                  onStop={handleToggleWhiteboard}
                  sessionId={sessionId}
                  localIdentity={localParticipant.identity}
                  localName={localName}
                  send={handleWhiteboardSend}
                  registerApi={registerWhiteboardApi}
                  onShareToChat={(attachment) =>
                    handleSend("🖼️ Whiteboard snapshot", "text", attachment)
                  }
                />
              </div>
            </>

          ) : pptActive && pptUrl ? (
            // ── PPT mode: Deaf-culture convention — signer on the LEFT, content on the RIGHT.
            <>
              {/* Camera panel — LEFT. Pinned student if set, otherwise tutor for BSL */}
              <div className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden bg-zinc-900 relative">
                {splitCameraPanel}
              </div>

              {/* Presentation column — RIGHT. Slides or video, decided by `presentKind`. */}
              <div
                ref={slideAreaRef}
                className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden relative border-t md:border-t-0 md:border-l border-zinc-800"
                onPointerMove={handleSlidePointerMove}
                onPointerLeave={handleSlidePointerLeave}
                style={isTutor && pointerMode ? { cursor: "none" } : undefined}
              >
                {presentKind === "video" ? (
                  <VideoPlayer
                    isTutor={isTutor}
                    url={pptUrl}
                    playing={videoPlaying}
                    currentTime={videoCurrentTime}
                    asOf={videoAsOf}
                    onPlayPause={handleVideoPlayPause}
                    onSeek={handleVideoSeek}
                  />
                ) : (
                  <PptSlideViewer
                    fileUrl={pptUrl}
                    currentPage={pptCurrentPage}
                    onTotalPages={(total) => {
                      if (total !== pptTotalPages) setPptTotalPages(total)
                    }}
                  />
                )}

                {/* Hand pointer overlay — shown to everyone while tutor is pointing.
                    lucide's Pointer icon is a hand with the index fingertip near the
                    top of the 24×24 viewBox (≈ (4, 2)), so we anchor that spot at
                    the reported coordinate via the transform. */}
                {livePointer && (
                  <div
                    className="absolute pointer-events-none z-40"
                    style={{
                      left: `${livePointer.x * 100}%`,
                      top:  `${livePointer.y * 100}%`,
                      transform: "translate(-16.7%, -8.3%)",
                      filter: "drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000) drop-shadow(0 2px 6px rgba(0,0,0,0.85))",
                      transition: isTutor ? "none" : "left 60ms linear, top 60ms linear",
                    }}
                    aria-hidden
                  >
                    <Pointer
                      className="size-9 text-white"
                      strokeWidth={2.25}
                      style={{ fill: "rgb(255 255 255 / 0.95)", stroke: "#000" }}
                    />
                  </div>
                )}

                {/* Slide number badge — slides only */}
                {presentKind === "slides" && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none">
                    Slide {pptCurrentPage} of {pptTotalPages}
                  </div>
                )}
                {/* Captions during presentation */}
              </div>

              {/* Live thumbnail tray — slides only, tutor-only */}
              {isTutor && presentKind === "slides" && pptUrl && pptTotalPages > 0 && (
                <SlideTray
                  fileUrl={pptUrl}
                  totalPages={pptTotalPages}
                  selectedSlides={selectedSlides}
                  currentPage={pptCurrentPage}
                  onJump={handlePptJump}
                  onToggleSelected={handleToggleSelected}
                  collapsed={!slideTrayOpen}
                  onToggleCollapse={() => setSlideTrayOpen((v) => !v)}
                />
              )}
            </>

          ) : screenSharing ? (
            // ── Screen share mode: camera LEFT so the tutor can keep signing,
            // screen content RIGHT. Students see a placeholder when private.
            <>
              <div className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden bg-zinc-900 relative">
                {splitCameraPanel}
              </div>

              <div className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden relative border-t md:border-t-0 md:border-l border-zinc-800 bg-zinc-950">
                {!isTutor && screenPrivate ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
                    <Monitor className="size-12 opacity-20" />
                    <span className="text-sm opacity-60">Tutor is preparing content…</span>
                  </div>
                ) : tutorScreenTrack ? (
                  <VideoTrack trackRef={tutorScreenTrack} className="w-full h-full object-contain" />
                ) : null}
              </div>
            </>

          ) : (
            // ── Normal mode: tutor video, pinned student, or (during breakouts)
            // a group-mate on the main stage so students can sign with each other.
            <div className="flex-1 flex flex-col overflow-hidden relative">
              <div className="flex-1 overflow-hidden">
                {(() => {
                  const mainStageId = pinnedId ?? studentBreakoutMainId
                  if (mainStageId) {
                    return (
                      <PinnedVideoArea
                        identity={mainStageId}
                        localIdentity={localParticipant.identity}
                        containerRef={videoContainerRef}
                        isFullscreen={isFullscreen}
                        onToggleFullscreen={toggleFullscreen}
                        onUnpin={() => setPinnedId(null)}
                        showSpotlight={isTutor && mainStageId !== localParticipant.identity}
                        spotlightActive={spotlightedId === mainStageId}
                        onToggleSpotlight={handleToggleSpotlight}
                        handRaised={raisedHandIds.has(mainStageId)}
                        onLowerHand={isTutor ? handleLowerHand : undefined}
                      />
                    )
                  }
                  // Unassigned student while the tutor is off visiting a group:
                  // there is nobody for them to watch, so don't fall through to
                  // the tutor's feed.
                  if (breakoutsActive && !isTutor && !tutorCameraVisible && !ownBreakoutGroup) {
                    return (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400 px-6 text-center">
                        <Users2 className="size-12 opacity-30" />
                        <p className="text-sm font-semibold text-zinc-200">Breakouts are running</p>
                        <p className="text-xs text-zinc-500 max-w-sm">
                          The tutor is visiting a group. They&apos;ll be back in the main room shortly.
                        </p>
                      </div>
                    )
                  }
                  if (breakoutsActive && !isTutor && ownBreakoutGroup) {
                    return (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400 px-6 text-center">
                        <Users2 className="size-12 opacity-30" />
                        <p className="text-sm font-semibold text-zinc-200">
                          You&apos;re in {ownBreakoutGroup.name}
                        </p>
                        <p className="text-xs text-zinc-500 max-w-sm">
                          Turn on your camera — when teammates join, they&apos;ll appear here and in the strip below.
                        </p>
                      </div>
                    )
                  }
                  return (
                    <TutorVideoArea
                      containerRef={videoContainerRef}
                      isFullscreen={isFullscreen}
                      onToggleFullscreen={toggleFullscreen}
                    />
                  )
                })()}
              </div>
            </div>
          )}

          <CaptionsOverlay />
          </div>

          {/* Bottom strip: participants row. Height grows with `tileSize` so the
              tiles inside (16:9) scale with the strip. */}
          <div className={cn(
            "shrink-0 border-t border-zinc-800 bg-zinc-900 transition-[height] duration-200 overflow-hidden",
            !participantsOpen && "h-9",
            participantsOpen && tileSize === "sm" && "h-20",
            participantsOpen && tileSize === "md" && "h-28",
            participantsOpen && tileSize === "lg" && "h-40",
            participantsOpen && tileSize === "xl" && "h-56",
          )}>
            <ParticipantsPanel
              pinnedId={pinnedId}
              onPin={setPinnedId}
              collapsed={!participantsOpen}
              onToggleCollapse={() => setParticipantsOpen((v) => !v)}
              isLocalTutor={isTutor}
              spotlightedId={spotlightedId}
              onToggleSpotlight={handleToggleSpotlightFor}
              onPopOut={handlePopOut}
              poppedOutIds={poppedOutIds}
              onRemoveParticipant={handleRequestRemove}
              onToggleParticipantMic={isTutor ? handleSetParticipantMic : undefined}
              raisedHandIds={raisedHandIds}
              onLowerHand={isTutor ? handleLowerHand : undefined}
              visibleIdentities={visibleIdentities}
              groupLabels={groupLabels}
              tileSize={tileSize}
              onTileSizeChange={handleTileSizeChange}
            />
          </div>
        </div>

        {/* Chat column — full-height sidebar on desktop; mobile full-screen overlay. */}
        <div className={cn(
          "flex flex-col overflow-hidden bg-zinc-900 transition-all duration-200 border-zinc-800",
          "md:relative md:h-full md:shrink-0 md:border-l md:flex",
          chatOpen ? "md:w-72" : "md:w-10",
          chatOpen
            ? "max-md:absolute max-md:inset-0 max-md:z-30 max-md:w-full max-md:shadow-2xl"
            : "max-md:hidden",
        )}>
          <ChatPanel
            messages={messages}
            localName={localName}
            raisedHands={raisedHands}
            onSend={handleSend}
            flash={chatFlash}
            collapsed={!chatOpen}
            onToggleCollapse={() => setChatOpen((v) => !v)}
            isTutor={isTutor}
            sessionId={sessionId}
            onLowerHand={isTutor ? handleLowerHand : undefined}
            onLowerAllHands={isTutor ? handleLowerAllHands : undefined}
          />
        </div>

        {/* Mobile-only floating chat toggle — visible when chat is closed. */}
        {!chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            className={cn(
              "md:hidden absolute bottom-3 right-3 z-40 size-12 rounded-full bg-primary text-white shadow-xl flex items-center justify-center active:scale-95 transition-transform",
              // Ring it while breakouts run so it reads as "your group chat is here".
              breakoutsActive && "ring-2 ring-white/70",
              chatFlash && "animate-pulse"
            )}
            aria-label="Open chat"
          >
            <MessageSquare className="size-5" />
          </button>
        )}
      </div>

      {/* ── Floating, draggable, resizable video pop-outs ── */}
      {poppedOutIds.map((id, i) => (
        <FloatingVideoWindow
          key={id}
          identity={id}
          localIdentity={localParticipant.identity}
          initial={{ x: 80 + i * 28, y: 80 + i * 28 }}
          onClose={() => handleClosePopOut(id)}
          handRaised={raisedHandIds.has(id)}
          onLowerHand={isTutor ? handleLowerHand : undefined}
        />
      ))}

      {/* ── Refresh-everyone confirmation (tutor only, shadcn Dialog) ── */}
      <Dialog open={refreshConfirmOpen} onOpenChange={setRefreshConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-4 text-amber-500" />
              Refresh the classroom for everyone?
            </DialogTitle>
            <DialogDescription>
              Every student&rsquo;s page will reload, and so will yours. Use this
              only if the session has frozen — it takes a few seconds for
              everyone to reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefreshConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmRefreshAll}>
              <RefreshCw className="size-3.5" />
              Refresh everyone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove-participant confirmation (tutor only) ── */}
      {pendingRemoval && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="size-5 text-rose-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white">Remove from session?</h2>
                <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
                  <span className="font-semibold text-zinc-200">{pendingRemoval.name}</span> will be
                  disconnected immediately. They can rejoin unless you also cancel their access.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setPendingRemoval(null)}
                disabled={removingParticipant}
                className="px-4 h-9 rounded-lg text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveParticipant}
                disabled={removingParticipant}
                className="px-4 h-9 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <UserMinus className="size-3.5" />
                {removingParticipant ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-12 bg-zinc-950 border-t border-zinc-800/60 shrink-0 flex items-center px-2 sm:px-3">
        <ControlsBar
          isTutor={isTutor}
          onLeave={onLeave}
          studentCount={studentCount}
          onMuteAll={handleMuteAll}
          onUnmuteAll={handleUnmuteAll}
          onRefreshAll={handleRefreshAll}
          onInviteCoTutor={() => setInviteCoTutorOpen(true)}
          onRequestToSpeak={handleRequestToSpeak}
          pptActive={pptActive}
          presentKind={presentKind}
          presentationIdx={presentationIdx}
          selectedCount={selectedSlides.length}
          hasNextSlide={hasNextSlide}
          hasPrevSlide={hasPrevSlide}
          onShowUpload={() => setShowUpload(true)}
          onPptNext={handlePptNext}
          onPptPrev={handlePptPrev}
          onPptStop={handlePptStop}
          pointerMode={pointerMode}
          onTogglePointer={handleTogglePointer}
          whiteboardActive={whiteboardActive}
          onToggleWhiteboard={handleToggleWhiteboard}
          breakoutsActive={breakoutsActive}
          onOpenBreakoutsPanel={() => setBreakoutsPanelOpen(true)}
          onOpenBreakoutMonitor={() => setBreakoutMonitorOpen(true)}
          onNudgeClass={() => handleNudge()}
          screenSharing={screenSharing}
          screenPrivate={screenPrivate}
          onToggleScreenPrivacy={handleToggleScreenPrivacy}
          blurEnabled={blurEnabled}
          blurBusy={blurBusy}
          onToggleBlur={handleToggleBlur}
          recordingStarted={recordingStarted}
          recordingPaused={recordingPaused}
          recordingBusy={recordingBusy}
          onToggleRecording={handleToggleRecording}
        />
      </div>
    </div>
  )
}
