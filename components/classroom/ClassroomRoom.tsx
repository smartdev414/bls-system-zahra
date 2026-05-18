"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import {
  useParticipants,
  useLocalParticipant,
  useDataChannel,
  useConnectionState,
  useTracks,
  VideoTrack,
} from "@livekit/components-react"
import { ConnectionState, Track } from "livekit-client"
import { cn } from "@/lib/utils"
import {
  Radio, Users, Presentation, UserPlus, Pointer, UserMinus, AlertTriangle, RefreshCw, Monitor,
  MessageSquare,
} from "lucide-react"
import { toast } from "sonner"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"
import { PptSlideViewer } from "./PptSlideViewer"
import { SlidePicker } from "./SlidePicker"

import {
  CHAT_TOPIC, HAND_TOPIC, PPT_TOPIC, POINTER_TOPIC, SPOTLIGHT_TOPIC, MUTE_TOPIC, CONTROL_TOPIC, WHITEBOARD_TOPIC,
  BREAKOUT_TOPIC, NUDGE_TOPIC, SCREEN_TOPIC,
  POINTER_SEND_INTERVAL_MS, POINTER_AUTO_HIDE_MS,
  enc, dec,
} from "./room/constants"
import type {
  ChatMsg, MsgType, RaisedHand, JoinRequest,
  PptAction, PointerAction, SpotlightAction, MuteAction, SessionControlAction,
  UploadedSlides, WhiteboardAction, WhiteboardShape,
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
import { WhiteboardPanel }      from "./room/WhiteboardPanel"
import { BreakoutsPanel }       from "./room/BreakoutsPanel"
import { BreakoutMonitor }      from "./room/BreakoutMonitor"
import { BreakoutBanner }       from "./room/BreakoutBanner"
import { NudgeOverlay }          from "./room/NudgeOverlay"
import { LogoWatermark }        from "@/components/layout/logo"
import { readBlurPreference, writeBlurPreference } from "./blurPreference"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

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

  // Reactive screen share state — works for both tutor and student clients.
  // `onlySubscribed: false` includes the tutor's own locally-published track.
  const allScreenTracks  = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })
  const tutorScreenTrack = allScreenTracks.find((t) => t.participant.metadata === "tutor") ?? null
  const screenSharing    = !!tutorScreenTrack

  const localName = localParticipant.name ?? localParticipant.identity

  // ── Chat / hand state ──────────────────────────────────────────────────────
  const [messages,         setMessages]         = useState<ChatMsg[]>([])
  const [raisedHands,      setRaisedHands]      = useState<RaisedHand[]>([])
  const [handRaised,       setHandRaised]       = useState(false)
  // Fast O(1) membership lookup for tile/overlay badges.
  const raisedHandIds = useMemo(
    () => new Set(raisedHands.map((h) => h.identity)),
    [raisedHands]
  )
  const [chatFlash,        setChatFlash]        = useState(false)
  const [isFullscreen,     setIsFullscreen]     = useState(false)
  const [pinnedId,         setPinnedId]         = useState<string | null>(null)
  const [participantsOpen, setParticipantsOpen] = useState(true)
  const [chatOpen,         setChatOpen]         = useState(true)
  const [requestsOpen,     setRequestsOpen]     = useState(false)

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
  // `whiteboardActive` toggles the shared drawing surface for everyone.
  // `whiteboardShapes` is the whole surface — strokes + text, in order.
  // Mutually exclusive with slides/video: only one "main area" resource runs
  // at a time, handled in the render branch below.
  const [whiteboardActive, setWhiteboardActive] = useState(false)
  const [whiteboardShapes, setWhiteboardShapes] = useState<WhiteboardShape[]>([])
  // Ref mirrors for the sync_response handler so it always sees latest values.
  const whiteboardStateRef = useRef({ active: false, shapes: [] as WhiteboardShape[] })
  useEffect(() => {
    whiteboardStateRef.current = { active: whiteboardActive, shapes: whiteboardShapes }
  }, [whiteboardActive, whiteboardShapes])

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
  const [breakoutsPanelOpen, setBreakoutsPanelOpen] = useState(false)
  const [breakoutMonitorOpen,setBreakoutMonitorOpen]= useState(false)
  // Mirrors for sync_response so the handler always sees the latest values.
  const breakoutStateRef = useRef({
    active: false,
    groups: [] as BreakoutGroup[],
    visitingGroupId: null as string | null,
    startedAt: null as number | null,
    durationMin: null as number | null,
  })
  useEffect(() => {
    breakoutStateRef.current = {
      active: breakoutsActive,
      groups: breakoutGroups,
      visitingGroupId,
      startedAt: breakoutStartedAt,
      durationMin: breakoutDurationMin,
    }
  }, [breakoutsActive, breakoutGroups, visitingGroupId, breakoutStartedAt, breakoutDurationMin])

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

  // ── Data channel: mute-all ─────────────────────────────────────────────────
  // Tutor broadcasts `mute-all`; every student self-mutes their own mic on receipt
  // and gets a toast so they know *why* their mic just cut out.

  const { send: sendMuteAll } = useDataChannel(MUTE_TOPIC, (msg) => {
    // Tutors originate this signal, so skip their own echo.
    if (isTutor) return
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as MuteAction
      if (data.action !== "mute-all") return
      // Only do anything if the mic is currently live — avoids surprise toasts
      // for students who were already muted.
      if (!localParticipant.isMicrophoneEnabled) return
      localParticipant.setMicrophoneEnabled(false).catch(() => { /* ignore */ })
      toast.info(`${data.from} muted everyone's microphone`, {
        description: "You can unmute yourself again whenever you need to speak.",
      })
    } catch { /* ignore malformed */ }
  })

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
  // All participants can add/update/delete shapes; only the tutor can start,
  // stop, or clear. Everyone echoes their own actions locally first, so we
  // de-dupe here by only applying shapes we don't already have.

  const { send: sendWhiteboard } = useDataChannel(WHITEBOARD_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as WhiteboardAction

      if (data.action === "start") {
        setWhiteboardActive(true)
        return
      }
      if (data.action === "stop") {
        setWhiteboardActive(false)
        setWhiteboardShapes([])
        return
      }
      if (data.action === "clear") {
        setWhiteboardShapes([])
        return
      }
      if (data.action === "add") {
        setWhiteboardShapes((prev) =>
          prev.some((s) => s.id === data.shape.id) ? prev : [...prev, data.shape]
        )
        return
      }
      if (data.action === "delete") {
        setWhiteboardShapes((prev) => prev.filter((s) => s.id !== data.id))
        return
      }

      // Late joiner asked the tutor for current state
      if (data.action === "sync_request" && isTutor) {
        const snapshot = whiteboardStateRef.current
        const response: WhiteboardAction = {
          action: "sync_response",
          active: snapshot.active,
          shapes: snapshot.shapes,
        }
        try {
          sendWhiteboard(enc.encode(JSON.stringify(response)), { reliable: true })
        } catch { /* ignore */ }
        return
      }
      if (data.action === "sync_response" && !isTutor) {
        setWhiteboardActive(data.active)
        setWhiteboardShapes(data.shapes)
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
          const ownGroup = data.groups.find((g) => g.memberIds.includes(localParticipant.identity))
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
        setBreakoutGroups(data.groups)
        if (!isTutor) {
          const ownGroup = data.groups.find((g) => g.memberIds.includes(localParticipant.identity))
          if (ownGroup) {
            toast.info(`Group updated — you're now in ${ownGroup.name}`)
          }
        }
        return
      }

      if (data.action === "visit") {
        setVisitingGroupId(data.groupId)
        if (!isTutor) {
          const group = data.groupId ? breakoutStateRef.current.groups.find((g) => g.id === data.groupId) : null
          const ownGroup = breakoutStateRef.current.groups.find((g) => g.memberIds.includes(localParticipant.identity))
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
        return
      }
    } catch { /* ignore malformed */ }
  })

  // Student: ask the tutor for the current breakout state after joining.
  const hasSentBreakoutSync = useRef(false)
  useEffect(() => {
    if (isTutor || hasSentBreakoutSync.current) return
    if (connectionState !== ConnectionState.Connected) return
    const timer = setTimeout(() => {
      hasSentBreakoutSync.current = true
      try {
        sendBreakout(enc.encode(JSON.stringify({ action: "sync_request" })), { reliable: true })
      } catch {
        hasSentBreakoutSync.current = false
      }
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState])

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
        const own = breakoutStateRef.current.groups.find((g) => g.memberIds.includes(localParticipant.identity))
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const liveTrack = track as any
      if (blurEnabled) {
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
      const proc = mod.BackgroundProcessor({ mode: "background-blur", blurRadius: 12 })
      await liveTrack.setProcessor(proc)
      blurProcessorRef.current = proc
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
    toast.info("Click Start Rec in the controls when you're ready to record this session.", {
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

  // ── Mute-all handler (tutor only) ──────────────────────────────────────────
  // Broadcasts a single data-channel message; every student self-mutes on receipt.
  // Posts a system chat line so it's visible in history.

  const handleMuteAll = useCallback(() => {
    if (!isTutor) return
    if (connectionState !== ConnectionState.Connected) return
    try {
      const payload: MuteAction = { action: "mute-all", from: localName }
      sendMuteAll(enc.encode(JSON.stringify(payload)), { reliable: true })
    } catch {
      toast.error("Couldn't send the mute signal — please try again.")
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
  }, [isTutor, connectionState, localName, sendMuteAll])

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

  // ── Whiteboard handlers (start/stop tutor-only; add/update/delete for all) ─
  // Each action applies optimistically to the local state and then broadcasts.
  // The receive handler de-dupes by id so echoes don't duplicate shapes.

  const safeSendWhiteboard = useCallback((data: WhiteboardAction) => {
    if (connectionState !== ConnectionState.Connected) return
    if (typeof sendWhiteboard !== "function") return
    try {
      const result = sendWhiteboard(enc.encode(JSON.stringify(data)), { reliable: true }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore transient LiveKit errors */ })
      }
    } catch { /* ignore */ }
  }, [connectionState, sendWhiteboard])

  const handleToggleWhiteboard = useCallback(() => {
    if (!isTutor) return
    if (whiteboardActive) {
      setWhiteboardActive(false)
      setWhiteboardShapes([])
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
      safeSendWhiteboard({ action: "start" })
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-wb-start-${Date.now()}`,
          from: "system",
          text: "Tutor opened the whiteboard ✏️ — everyone can draw and type.",
          ts: Date.now(),
          type: "system",
        },
      ])
    }
    // safeSendPpt lives above — adding it to deps keeps useCallback coherent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, whiteboardActive, pptActive, safeSendWhiteboard])

  const handleAddShape = useCallback((shape: WhiteboardShape) => {
    setWhiteboardShapes((prev) =>
      prev.some((s) => s.id === shape.id) ? prev : [...prev, shape]
    )
    safeSendWhiteboard({ action: "add", shape })
  }, [safeSendWhiteboard])

  const handleDeleteShape = useCallback((id: string) => {
    setWhiteboardShapes((prev) => prev.filter((s) => s.id !== id))
    safeSendWhiteboard({ action: "delete", id })
  }, [safeSendWhiteboard])

  const handleClearBoard = useCallback(() => {
    if (!isTutor) return
    setWhiteboardShapes([])
    safeSendWhiteboard({ action: "clear" })
  }, [isTutor, safeSendWhiteboard])

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
    setBreakoutsPanelOpen(false)
    setBreakoutMonitorOpen(true)
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
    setBreakoutGroups(groups)
    safeSendBreakout({ action: "update", groups })
    toast.success("Breakout assignments updated")
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

  const handleStopBreakouts = useCallback(() => {
    if (!isTutor) return
    setBreakoutsActive(false)
    setBreakoutGroups([])
    setVisitingGroupId(null)
    setBreakoutStartedAt(null)
    setBreakoutDurationMin(null)
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
    () => breakoutGroups.find((g) => g.memberIds.includes(localParticipant.identity)) ?? null,
    [breakoutGroups, localParticipant.identity]
  )

  // `null` → no filtering, play/show everyone (the default pre-breakout behaviour).
  const audibleIdentities = useMemo<Set<string> | null>(() => {
    if (!breakoutsActive) return null
    const audible = new Set<string>()
    if (isTutor) {
      // Tutor hears only the group they're currently visiting. Focused-student
      // audio in the monitor is rendered separately inside BreakoutMonitor.
      if (visitingGroupId) {
        const g = breakoutGroups.find((x) => x.id === visitingGroupId)
        g?.memberIds.forEach((id) => audible.add(id))
      }
    } else {
      // Student: own group-mates + tutor (only if tutor is visiting this group).
      if (ownBreakoutGroup) {
        ownBreakoutGroup.memberIds.forEach((id) => audible.add(id))
      }
      if (tutorIdentity) {
        const tutorInMyGroup =
          visitingGroupId && ownBreakoutGroup && visitingGroupId === ownBreakoutGroup.id
        // If unassigned *and* tutor hasn't entered any group, tutor is in main —
        // keep them audible so the student isn't silently stranded.
        const tutorInMainRoom = visitingGroupId === null
        if (tutorInMyGroup || (!ownBreakoutGroup && tutorInMainRoom)) {
          audible.add(tutorIdentity)
        }
      }
    }
    audible.delete(localParticipant.identity)
    return audible
  }, [breakoutsActive, isTutor, visitingGroupId, breakoutGroups, ownBreakoutGroup, tutorIdentity, localParticipant.identity])

  const visibleIdentities = useMemo<Set<string> | null>(() => {
    if (!breakoutsActive) return null
    if (isTutor) return null   // tutors see everyone in the participants strip
    const visible = new Set<string>()
    if (ownBreakoutGroup) ownBreakoutGroup.memberIds.forEach((id) => visible.add(id))
    if (tutorIdentity) visible.add(tutorIdentity)
    return visible
  }, [breakoutsActive, isTutor, ownBreakoutGroup, tutorIdentity])

  const groupLabels = useMemo(() => {
    if (!breakoutsActive || breakoutGroups.length === 0) return null
    const palette = ["#60a5fa", "#f472b6", "#fb923c", "#34d399", "#a78bfa", "#facc15", "#22d3ee", "#f87171"]
    const map = new Map<string, { name: string; color: string }>()
    breakoutGroups.forEach((g, idx) => {
      const color = palette[idx % palette.length]
      g.memberIds.forEach((id) => map.set(id, { name: g.name, color }))
    })
    return map
  }, [breakoutsActive, breakoutGroups])

  // One-shot warning so students & tutor get a heads-up before auto-close.
  const endWarningShownRef = useRef<number | null>(null)

  // Absolute wall-clock deadline for the active breakout, or null when none.
  // Derived (not stored) so any state update to startedAt/duration re-renders.
  const breakoutEndsAt = useMemo(() => {
    if (!breakoutsActive || !breakoutStartedAt || !breakoutDurationMin) return null
    return breakoutStartedAt + breakoutDurationMin * 60_000
  }, [breakoutsActive, breakoutStartedAt, breakoutDurationMin])

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
        handleStopBreakouts()
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [breakoutsActive, breakoutEndsAt, isTutor, handleStopBreakouts])

  // Student list (no tutor) — used by the manager panel.
  const studentList = useMemo(
    () =>
      participants
        .filter((p) => p.metadata !== "tutor")
        .map((p) => ({ identity: p.identity, name: p.name ?? p.identity })),
    [participants]
  )

  const studentCount = participants.filter((p) => p.metadata !== "tutor").length

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white flex flex-col overflow-hidden z-50">
      <AudioRenderer audibleIdentities={audibleIdentities} />

      {/* Brand watermark — visible to all participants. Top-left so it doesn't
          collide with the controls bar at the bottom. */}
      <LogoWatermark className="top-3 left-3" size={44} />

      {/* Recording reminder — tutor only, until they start recording. */}
      {isTutor && !recordingStarted && (
        <div
          className="absolute top-3 right-3 z-30 flex items-center gap-2 max-w-xs px-3 py-2 rounded-xl bg-amber-500/15 backdrop-blur-sm border border-amber-400/40 text-[11px] font-medium text-amber-100 shadow"
          role="status"
        >
          <span className="size-2 shrink-0 rounded-full bg-amber-400" />
          Click <span className="font-semibold">Start Rec</span> below when you&apos;re ready to record this session.
        </div>
      )}

      {/* Recording indicator — tutor only, after recording has started. */}
      {isTutor && recordingStarted && (
        <div
          className="absolute top-3 right-3 z-30 pointer-events-none flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm border border-white/15 text-[11px] font-semibold text-white shadow"
          aria-live="polite"
        >
          <span
            className={cn(
              "size-2 rounded-full",
              recordingPaused
                ? "bg-amber-400"
                : "bg-rose-500 animate-pulse",
            )}
          />
          {recordingPaused ? "Paused" : "Recording"}
        </div>
      )}

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
          onStop={handleStopBreakouts}
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
          {pptActive && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
              <Presentation className="size-3" />
              Presenting
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
      {!isTutor && breakoutsActive && ownBreakoutGroup && (
        <BreakoutBanner
          group={ownBreakoutGroup}
          allParticipantNames={new Map(participants.map((p) => [p.identity, p.name ?? p.identity]))}
          tutorVisiting={visitingGroupId === ownBreakoutGroup.id}
          endsAt={breakoutEndsAt}
        />
      )}

      {/* ── Main body ── */}
      <div className="flex flex-1 overflow-hidden flex-col min-h-0">

        {/* Top row: slides / video / whiteboard + chat sidebar.
            On phones (default) we stack camera/content vertically; from md+
            we revert to the side-by-side BSL layout. `relative` is required
            so the mobile chat overlay can pin to this row. */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0 relative">

          {whiteboardActive ? (
            // ── Whiteboard mode: same deaf-first layout as PPT. Tutor camera on
            // the LEFT so signing stays visible while everyone draws on the RIGHT.
            <>
              <div className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden bg-zinc-900 relative">
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
                    handRaised={raisedHandIds.has(pinnedId)}
                    onLowerHand={isTutor ? handleLowerHand : undefined}
                  />
                ) : (
                  <TutorCameraInset />
                )}
              </div>

              <div className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden relative border-t md:border-t-0 md:border-l border-zinc-800">
                <WhiteboardPanel
                  isTutor={isTutor}
                  localIdentity={localParticipant.identity}
                  shapes={whiteboardShapes}
                  onAdd={handleAddShape}
                  onDelete={handleDeleteShape}
                  onClear={handleClearBoard}
                  onStop={handleToggleWhiteboard}
                />
                <CaptionsOverlay />
              </div>
            </>

          ) : pptActive && pptUrl ? (
            // ── PPT mode: Deaf-culture convention — signer on the LEFT, content on the RIGHT.
            <>
              {/* Camera panel — LEFT. Pinned student if set, otherwise tutor for BSL */}
              <div className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden bg-zinc-900 relative">
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
                    handRaised={raisedHandIds.has(pinnedId)}
                    onLowerHand={isTutor ? handleLowerHand : undefined}
                  />
                ) : (
                  <TutorCameraInset />
                )}
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
                <CaptionsOverlay />
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
                    handRaised={raisedHandIds.has(pinnedId)}
                    onLowerHand={isTutor ? handleLowerHand : undefined}
                  />
                ) : (
                  <TutorCameraInset />
                )}
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
                    handRaised={raisedHandIds.has(pinnedId)}
                    onLowerHand={isTutor ? handleLowerHand : undefined}
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

          {/* Chat column — desktop sidebar; mobile full-screen overlay.
              When closed on mobile we hide it entirely and surface a floating
              chat-toggle button (below) so the camera/content stay unobstructed. */}
          <div className={cn(
            "flex flex-col overflow-hidden bg-zinc-900 transition-all duration-200 border-zinc-800",
            // Desktop: inline sidebar, always part of layout
            "md:relative md:h-full md:border-l md:flex",
            chatOpen ? "md:w-72" : "md:w-10",
            // Mobile: overlay when open, hidden when closed
            chatOpen
              ? "absolute inset-y-0 right-0 z-30 w-full shadow-2xl md:shadow-none"
              : "hidden"
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
              onLowerHand={isTutor ? handleLowerHand : undefined}
              onLowerAllHands={isTutor ? handleLowerAllHands : undefined}
            />
          </div>

          {/* Mobile-only floating chat toggle — visible when chat is closed.
              On desktop the collapsed w-10 strip handles this affordance. */}
          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              className={cn(
                "md:hidden absolute bottom-3 right-3 z-30 size-12 rounded-full bg-primary text-white shadow-xl flex items-center justify-center active:scale-95 transition-transform",
                chatFlash && "animate-pulse"
              )}
              aria-label="Open chat"
            >
              <MessageSquare className="size-5" />
            </button>
          )}
        </div>

        {/* Bottom strip: participants row. Height grows with `tileSize` so the
            tiles inside (aspect-square) scale with the strip. */}
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
            raisedHandIds={raisedHandIds}
            onLowerHand={isTutor ? handleLowerHand : undefined}
            visibleIdentities={visibleIdentities}
            groupLabels={groupLabels}
            tileSize={tileSize}
            onTileSizeChange={handleTileSizeChange}
          />
        </div>
      </div>

      {/* ── Floating, draggable, resizable video pop-outs ── */}
      {poppedOutIds.map((id, i) => (
        <FloatingVideoWindow
          key={id}
          identity={id}
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
          handRaised={handRaised}
          onToggleHand={handleToggleHand}
          onLeave={onLeave}
          studentCount={studentCount}
          onMuteAll={handleMuteAll}
          onRefreshAll={handleRefreshAll}
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
