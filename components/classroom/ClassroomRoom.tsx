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
  useIsRecording,
} from "@livekit/components-react"
import { ConnectionState, RoomEvent, Track } from "livekit-client"
import { cn } from "@/lib/utils"
import { isLiveVideo } from "@/components/classroom/localCameraView"
import {
  Radio, Users, Users2, Presentation, UserPlus, Pointer, UserMinus, AlertTriangle, RefreshCw, Monitor,
  MessageSquare, X, Hand, Mic, Check, PencilLine, Maximize2,
} from "lucide-react"
import { toast } from "sonner"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"
import { usePoll } from "@/hooks/use-poll"
import { PptSlideViewer } from "./PptSlideViewer"
import { SlidePicker } from "./SlidePicker"

import {
  CHAT_TOPIC, HAND_TOPIC, PPT_TOPIC, POINTER_TOPIC, SPOTLIGHT_TOPIC, MUTE_TOPIC, CONTROL_TOPIC, WHITEBOARD_TOPIC,
  BREAKOUT_TOPIC, NUDGE_TOPIC, SCREEN_TOPIC, ORDER_TOPIC, VIEW_TOPIC,
  BREAKOUT_WRAP_UP_SEC, CHAT_HISTORY_LIMIT,
  POINTER_SEND_INTERVAL_MS, POINTER_STALE_MS, POINTER_KEEPALIVE_MS, POINTER_SMOOTHING_MS,
  enc, dec,
} from "./room/constants"
import type {
  ChatMsg, MsgType, RaisedHand, HandAction, JoinRequest,
  PptAction, PointerAction, SpotlightAction, MuteAction, SessionControlAction,
  UploadedSlides, WhiteboardAction, WhiteboardSnapshot, WhiteboardDiff,
  WhiteboardPresence,
  BreakoutAction, BreakoutGroup, NudgeAction, ScreenAction, OrderAction,
  ViewAction,
} from "./room/types"
import { AudioRenderer }        from "./room/AudioRenderer"
import { ConnectionBanner }     from "./room/ConnectionBanner"
import { NoiseFilter }          from "./room/NoiseFilter"
import { useSlideContentBox }   from "./room/useSlideContentBox"
import {
  useStageSplit, landscapeCameraSplit, splitDirectionClass, splitDividerClass,
} from "./room/useStageSplit"
import { TutorVideoArea }       from "./room/TutorVideoArea"
import { TutorCameraInset }     from "./room/TutorCameraInset"
import { ParticipantsPanel }    from "./room/ParticipantsPanel"
import { PinnedVideoArea }      from "./room/PinnedVideoArea"
import { StagePair }            from "./room/StagePair"
import { FloatingVideoWindow }  from "./room/FloatingVideoWindow"
import { useStudentsPip, StudentsPipPortal } from "./room/StudentsPip"
import { ChatPanel }            from "./room/ChatPanel"
import { SlideUploadPanel }     from "./room/SlideUploadPanel"
import { SlideTray }            from "./room/SlideTray"
import { VideoPlayer }          from "./room/VideoPlayer"
import { ControlsBar }          from "./room/ControlsBar"
import { CaptionsOverlay }      from "./room/CaptionsOverlay"
import { JoinRequestsPopover }  from "./room/JoinRequestsPopover"
import { RaisedHandsPopover }   from "./room/RaisedHandsPopover"
import type { WhiteboardApi }   from "./room/TldrawBoard"
import { BreakoutsPanel }       from "./room/BreakoutsPanel"
import { BreakoutMonitor }      from "./room/BreakoutMonitor"
import { BreakoutBanner }       from "./room/BreakoutBanner"
import { BreakoutCountdown }    from "./room/BreakoutCountdown"
import { BreakoutSelfStage }    from "./room/BreakoutSelfStage"
import { NudgeOverlay }          from "./room/NudgeOverlay"
import { SelfViewInset }        from "./room/SelfViewInset"
import { ScreenShareView }      from "./room/ScreenShareView"
import { InviteCoTutorModal }    from "./InviteCoTutorModal"
import { LogoWatermark }        from "@/components/layout/logo"
import { readBlurPreference, writeBlurPreference } from "./blurPreference"
import { participantBaseId } from "@/lib/participant-identity"
import {
  fetchPreparedPresentation, registerPresentation, toUploadedSlides,
} from "@/lib/slide-upload"
import {
  fetchStageState, publishStageState, type StageState, type StagePayload,
} from "@/lib/live-state"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

// Where a chat message goes during breakouts. See `chatAudience` in the room.
type ChatAudience = {
  groupId: string
  groupName: string
  /** LiveKit identities the live message is addressed to. */
  identities: string[]
}

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

// The tutor's breakout setup, remembered per session and per tab. See the
// restore effect next to the breakout state.
const breakoutStateStorageKey = (sessionId: string) => `classroom:breakouts:${sessionId}`
type StoredBreakouts = {
  active: boolean
  groups: BreakoutGroup[]
  visitingGroupId: string | null
  startedAt: number | null
  durationMin: number | null
  closingAt: number | null
}

// What's on the shared screen, remembered per session and per tab. A class-wide
// refresh reloads the tutor too, and the tutor is the only source of truth for
// the presentation — without this, "refresh the classroom" wipes the slides for
// everyone and nobody can put them back except by re-uploading.
const presentationStorageKey = (sessionId: string) => `classroom:presentation:${sessionId}`
// Last slide shown for each deck this session, keyed by deck URL, so closing the
// slides (say, to go to gallery) and presenting the same deck again resumes
// where the tutor left off instead of back at the start.
const deckPositionsStorageKey = (sessionId: string) => `classroom:deck-positions:${sessionId}`

// How long the stage must be quiet — no slide/video event from the tutor — before
// a student double-checks the stored stage against what they're showing, and how
// often that check runs. Slow on purpose: it's a safety net for a lost packet,
// not the primary sync path.
const STAGE_QUIET_MS = 15_000
const STAGE_RECONCILE_MS = 20_000

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
  isOwner = true,
  sessionId,
  sessionTitle,
  onLeave,
}: {
  isTutor: boolean
  /**
   * True for the teacher who owns the session, false for a co-teacher they
   * invited. Both are `isTutor` and both get the teaching controls; the
   * difference is the handful of things only the host may do — inviting a
   * further co-teacher is one, and the API enforces it. Defaults to true so a
   * caller that doesn't distinguish keeps today's behaviour.
   */
  isOwner?: boolean
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
  const allCameraTracks  = useTracks([Track.Source.Camera],      { onlySubscribed: false })
  const tutorScreenTrack = allScreenTracks.find((t) => t.participant.metadata === "tutor") ?? null
  const screenSharing    = !!tutorScreenTrack

  // Is *this* client the one sharing, and is their camera live? Drives the
  // self-view inset so a teacher never loses sight of themselves while sharing.
  const localScreenSharing = allScreenTracks.some(
    (t) => t.participant.identity === localParticipant.identity,
  )
  const localCameraRef = allCameraTracks.find(
    (t) => t.participant.identity === localParticipant.identity && isLiveVideo(t),
  ) ?? null

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
  // Gallery view: the class takes the whole stage and nobody is shown big. A
  // teacher asked for it — in spotlight they mostly watch their own camera
  // filling the screen, when what they want is every student's face at once.
  // The tutor chooses and the class follows (see the view data channel), and
  // it is not remembered: the next lesson starts back in spotlight, where the
  // signer is. The stage stays mounted underneath (just hidden), so a
  // whiteboard or deck on it keeps running while it is away.
  const [galleryView,      setGalleryView]      = useState(false)
  const galleryViewRef = useRef(false)
  useEffect(() => { galleryViewRef.current = galleryView }, [galleryView])
  // Gallery is the class panel, so it is open whatever the chevron last said.
  const classPanelOpen = participantsOpen || galleryView
  const [chatOpen,         setChatOpen]         = useState(true)
  // While the chat is hidden, new messages are counted on the floating chat
  // button and announced with a pop-up that opens the chat when tapped.
  const [chatUnread,       setChatUnread]       = useState(0)
  const chatOpenRef = useRef(chatOpen)
  useEffect(() => {
    chatOpenRef.current = chatOpen
    if (chatOpen) {
      setChatUnread(0)
      toast.dismiss("chat-new")
    }
  }, [chatOpen])
  const [requestsOpen,     setRequestsOpen]     = useState(false)
  // Tutor-only: a dedicated queue of raised hands, separate from the chat
  // panel's inline strip — the strip scrolls out of view once messages pile
  // up, and taking turns fairly means the tutor can check who's been waiting
  // longest without hunting through the conversation for it.
  const [raisedHandsOpen,  setRaisedHandsOpen]  = useState(false)
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
  // Always-on-top window of the class, for a teacher sharing another tab.
  const studentsPip = useStudentsPip()

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
  // usePoll rather than a bare interval: on a weak link a stalled request must
  // not be joined by a second one every eight seconds, and coming back to the
  // tab should refresh at once rather than after the rest of the interval.
  usePoll(() => refetchRequests(), 8000, { enabled: isTutor, immediate: false })

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
  // A deck the tutor prepared before the lesson (uploaded and slide-picked on
  // the session page). Armed on join so "Present" starts it immediately —
  // no upload, no conversion wait, no picking slides in front of the class.
  const [preparedDeck, setPreparedDeck] = useState<
    { slides: UploadedSlides; selectedPages: number[] } | null
  >(null)
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
      restoredPresentationRef.current = true
    } catch { /* corrupt or unavailable storage — come up with a blank stage */ }
  }, [sessionId])

  // Pull in whatever the tutor prepared on the session page before class. This
  // only arms the "Present" button — nothing goes on screen until they press it,
  // so opening the room early never puts slides in front of arriving students.
  useEffect(() => {
    if (!isTutor) return
    let cancelled = false
    ;(async () => {
      try {
        const resource = await fetchPreparedPresentation(sessionId)
        if (cancelled || !resource) return
        const slides = toUploadedSlides(resource)
        if (!slides) return
        setPreparedDeck({ slides, selectedPages: resource.selectedPages ?? [] })
        // Also feed the upload panel's "Resume previous" shortcut.
        uploadedSlidesRef.current = slides
      } catch { /* a prepared deck is a convenience — never block the room on it */ }
    })()
    return () => { cancelled = true }
  }, [isTutor, sessionId])

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

  // ── Resume a deck where it was left ────────────────────────────────────────
  const deckPositionsRef = useRef<Record<string, number>>({})
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(deckPositionsStorageKey(sessionId))
      const saved = raw ? JSON.parse(raw) : null
      deckPositionsRef.current = saved && typeof saved === "object" ? saved : {}
    } catch { deckPositionsRef.current = {} }
  }, [sessionId])
  useEffect(() => {
    if (!pptActive || presentKind !== "slides" || !pptUrl) return
    if (deckPositionsRef.current[pptUrl] === pptCurrentPage) return
    deckPositionsRef.current = { ...deckPositionsRef.current, [pptUrl]: pptCurrentPage }
    try {
      sessionStorage.setItem(deckPositionsStorageKey(sessionId), JSON.stringify(deckPositionsRef.current))
    } catch { /* storage disabled — resume still works until the page reloads */ }
  }, [pptActive, presentKind, pptUrl, pptCurrentPage, sessionId])

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

  // ── Stage state from the server ────────────────────────────────────────────
  // The data channel only carries "from now on", so it cannot tell a student
  // who joins late — or who reloads while the tutor's own tab is reloading —
  // what is currently on screen. The tutor mirrors every stage change to
  // `/api/sessions/[id]/live-state`; this reads it back.
  //
  // `stageTouchedRef` records that we have heard from the tutor live on this
  // mount. Once we have, the live channel is authoritative and the stored row
  // (which may lag by the publish debounce) never overrides it again.
  const stageTouchedRef = useRef(false)
  // When we last heard the tutor on the data channel. The reconcile poll below
  // only speaks up after a quiet spell, so it can never fight a tutor who is
  // mid-way through flicking through a deck.
  const lastLiveStageRef = useRef(0)
  // What this client has on stage right now. Read by the hydrate and reconcile
  // paths below so a stored row is only ever applied as a *correction*, never
  // as a reason to reshuffle a room that is already showing the right thing.
  const stageLocalRef = useRef<{
    active: boolean
    kind: "slides" | "video" | null
    url: string | null
    page: number
  }>({ active: false, kind: null, url: null, page: 1 })
  useEffect(() => {
    stageLocalRef.current = {
      active: pptActive, kind: presentKind, url: pptUrl, page: pptCurrentPage,
    }
  }, [pptActive, presentKind, pptUrl, pptCurrentPage])

  const applyStageState = useCallback((state: StageState) => {
    if (state.active && state.kind === "slides" && state.url) {
      setPresentKind("slides")
      setPptUrl(state.url)
      setPptTotalPages(state.totalPages)
      setPptCurrentPage(state.page > 0 ? state.page : 1)
      if (state.selectedPages.length > 0) setSelectedSlides(state.selectedPages)
      setPptActive(true)
      return
    }
    if (state.active && state.kind === "video" && state.url) {
      setPresentKind("video")
      setPptUrl(state.url)
      setPptActive(true)
      setVideoPlaying(state.videoPlaying)
      setVideoCurrentTime(state.videoTime)
      // Treat the stored position as "as of now" rather than trusting the
      // server clock against this browser's. The tutor re-broadcasts
      // `video_state` every few seconds, which corrects any drift.
      setVideoAsOf(Date.now())
      return
    }
    // Nothing on stage. Reached when a student restored a slide from storage
    // that the tutor has since stopped presenting.
    setPptActive(false)
    setPresentKind(null)
    setPptUrl(null)
    setPptCurrentPage(1)
    setPptTotalPages(0)
  }, [])

  const hydrateStage = useCallback(async () => {
    if (stageTouchedRef.current) return
    try {
      const state = await fetchStageState(sessionId)
      if (!state || stageTouchedRef.current) return
      // Nothing on stage and nothing showing — no correction to make.
      if (!state.active && !stageLocalRef.current.active) return
      // The tutor drives the stage, so only hydrate them when they have nothing
      // restored locally — reopening the room on another device, say. Never let
      // a stale row blank out a lesson the tutor is actively presenting.
      if (isTutor && (restoredPresentationRef.current || !state.active)) return
      applyStageState(state)
      // The tutor picking their lesson back up on a new device is a restore as
      // far as the rest of the room is concerned: let the existing re-announce
      // effect push it out over the data channel too.
      if (isTutor) restoredPresentationRef.current = true
    } catch {
      /* offline, or the row doesn't exist yet — the peer sync path still covers
         the common case where the tutor is connected. */
    }
  }, [sessionId, isTutor, applyStageState])

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
  // Local-only: the "–" button hides the board from this client's stage without
  // ending it for the class (that's what Close is for). Not synced or saved —
  // a view preference, same as the style panel's dragged position — and it
  // resets whenever the board closes so the next open starts visible.
  const [whiteboardMinimized, setWhiteboardMinimized] = useState(false)
  useEffect(() => {
    if (!whiteboardActive) setWhiteboardMinimized(false)
  }, [whiteboardActive])
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
  const wbPendingRef = useRef<{
    snapshot?: WhiteboardSnapshot
    changes: WhiteboardDiff[]
    presence?: WhiteboardPresence
  }>({ changes: [] })
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
    if (pending.presence) {
      api.applyPresence(pending.presence)
      pending.presence = undefined
    }
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

  // ── Breakouts survive a tutor reload ───────────────────────────────────────
  // The tutor is the only source of truth for breakouts. Without this a refresh
  // comes back with no groups and no monitor, while the students are still
  // sitting in their groups with nobody able to manage or end them.
  const restoredBreakoutsRef = useRef(false)
  const hadBreakoutsRef = useRef(false)
  useEffect(() => {
    if (!isTutor) return
    try {
      const raw = sessionStorage.getItem(breakoutStateStorageKey(sessionId))
      if (!raw) return
      const saved = JSON.parse(raw) as StoredBreakouts
      if (!saved?.active || !Array.isArray(saved.groups)) return
      setBreakoutsActive(true)
      setBreakoutGroups(saved.groups)
      setVisitingGroupId(saved.visitingGroupId ?? null)
      setBreakoutStartedAt(saved.startedAt ?? null)
      setBreakoutDurationMin(saved.durationMin ?? null)
      setBreakoutClosingAt(saved.closingAt ?? null)
      // Reopen the monitor unless the tutor was inside a group, where it was
      // deliberately closed so they could see the room they'd walked into.
      if (!saved.visitingGroupId) setBreakoutMonitorOpen(true)
      restoredBreakoutsRef.current = true
    } catch { /* corrupt or unavailable storage — come up with no breakouts */ }
  }, [isTutor, sessionId])

  useEffect(() => {
    if (!isTutor) return
    try {
      if (breakoutsActive) {
        hadBreakoutsRef.current = true
        const record: StoredBreakouts = {
          active: true,
          groups: breakoutGroups,
          visitingGroupId,
          startedAt: breakoutStartedAt,
          durationMin: breakoutDurationMin,
          closingAt: breakoutClosingAt,
        }
        sessionStorage.setItem(breakoutStateStorageKey(sessionId), JSON.stringify(record))
        return
      }
      // Same guard as the presentation: the first render after a reload is
      // still empty and must not wipe the record being restored.
      if (!hadBreakoutsRef.current) return
      sessionStorage.removeItem(breakoutStateStorageKey(sessionId))
    } catch { /* storage disabled — breakouts just won't survive a reload */ }
  }, [isTutor, breakoutsActive, breakoutGroups, visitingGroupId, breakoutStartedAt, breakoutDurationMin, breakoutClosingAt, sessionId])

  // Students: keep the participant strip open during breakouts so group cameras
  // stay visible — and open the chat too. Chat is the main channel in a BSL
  // classroom, and on phones/tablets it starts collapsed, so a student sent
  // into a breakout would otherwise land in a room with no visible way to talk
  // to their group.
  //
  // The same applies on the way back: when breakouts end, everyone lands in the
  // main room at once and expects to see each other. Leaving the strip however
  // it happened to be left — collapsed to a 36px bar, easy to miss — had
  // students hunting for the control instead of watching the class, so the
  // strip is reopened for everybody as the groups close.
  const breakoutsWereActive = useRef(false)
  useEffect(() => {
    if (!isTutor && breakoutsActive) {
      setParticipantsOpen(true)
      setChatOpen(true)
    }
    if (breakoutsWereActive.current && !breakoutsActive) {
      setParticipantsOpen(true)
    }
    breakoutsWereActive.current = breakoutsActive
  }, [isTutor, breakoutsActive])

  // ── Finger pointer state ───────────────────────────────────────────────────
  const [pointerMode,   setPointerMode]   = useState(false)
  const [livePointer,   setLivePointer]   = useState<{ x: number; y: number } | null>(null)
  const slideAreaRef    = useRef<HTMLDivElement>(null)
  const lastPointerSent = useRef(0)
  const pointerHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The element the slide is actually drawn into, reported by whichever viewer
  // is mounted. Pointer coordinates are normalised against this rather than
  // against the panel — see `useSlideContentBox` for why that matters.
  const [slideContentEl, setSlideContentEl] = useState<HTMLElement | null>(null)
  const handleSlideContentElement = useCallback((el: HTMLElement | null) => {
    setSlideContentEl(el)
  }, [])
  const slideContentBox = useSlideContentBox(slideAreaRef, slideContentEl)

  // Which way the stage is cut in half. Measured from the stage itself rather
  // than from a viewport breakpoint, so the camera and the presentation come
  // out the same shape as each other on every device — see `useStageSplit`.
  const stageRowRef = useRef<HTMLDivElement>(null)
  const stageSplit  = useStageSplit(stageRowRef)
  const splitAxis   = stageSplit.axis
  const splitDirection = splitDirectionClass(splitAxis)
  const splitDivider   = splitDividerClass(splitAxis)

  // How the stage is divided while slides or the whiteboard are up: the camera
  // gets the share that keeps its own panel landscape, the material gets the
  // rest. See `landscapeCameraSplit`.
  const cameraSplit = landscapeCameraSplit(stageSplit)

  // ── Where the class goes: a band beneath the stage ──────────────────────────
  //
  // Tutor (and slides/whiteboard) stay on the stage, the roster is a band
  // underneath — that's the layout tutors know and asked to keep. The one real
  // complaint it had (#19: a single row with horizontal scroll past ~10
  // students) is still fixed: the band packs every tile into a grid via
  // `packGrid` instead of a scrolling row, so nothing is ever off screen. The
  // +/- control on the panel sets the band's height; `CLASS_BAND_PX` below.

  // Stacked beneath the stage, the +/- control sets a height. Taller than the
  // old strip at every step: two rows of faces is the point.
  const CLASS_BAND_PX: Record<TileSize, number> = { sm: 104, md: 148, lg: 200, xl: 264 }

  // How the stage is divided while a screen is being shared.
  //
  // A shared screen is mostly text, and text is only ever as big as the panel
  // it lands in. An even split puts it in half of an already-narrow column,
  // which is where "the students can't read it" comes from. So hand the content
  // roughly two thirds and leave the signer a real panel — not the corner inset
  // wide mode falls back to, which is too small to sign from in a BSL lesson.
  //
  // Only when the stage is cut left/right. A stacked stage gives each panel a
  // wide, short box that already fits a 16:9 screen with almost nothing wasted,
  // and there is far less height to take off the signer before they stop being
  // legible. Anyone who wants more can still widen, zoom or go fullscreen.
  const screenSplit = splitAxis === "row"
    ? { camera: { flex: "35 1 0%" }, content: { flex: "65 1 0%" } }
    : { camera: { flex: "1 1 0%" },  content: { flex: "1 1 0%"  } }
  const slideContentBoxRef = useRef(slideContentBox)
  slideContentBoxRef.current = slideContentBox

  // Trailing edge of the send throttle. The original threw away every move
  // inside the throttle window, which meant the *last* position before the
  // tutor stopped moving was usually never sent at all — so students were left
  // looking at wherever the pointer happened to be one sample earlier. Holding
  // the most recent position and flushing it when the window closes is what
  // makes the pointer land where the tutor is actually pointing.
  const pendingPointer   = useRef<{ x: number; y: number } | null>(null)
  const pointerFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Send counter, so a reordered datagram cannot drag the pointer backwards. */
  const pointerSeq     = useRef(0)
  const lastPointerSeq = useRef(-1)
  const lastPointerAt  = useRef(0)
  /** Who is currently pointing, so the hand goes when they leave the room. */
  const pointerOwner   = useRef<string | null>(null)
  // Mirror for the keepalive timer, which fires outside React's render cycle.
  const livePointerRef = useRef<{ x: number; y: number } | null>(null)
  livePointerRef.current = livePointer

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
  // What everyone else sees. LiveKit flags the room while an egress is running,
  // so students learn they are on camera in a recording without the tutor's
  // local state being broadcast. Pausing stops the egress, which clears it.
  const roomIsRecording = useIsRecording()
  // The tutor's own flag lives in component state, so a reload (theirs, or
  // "Refresh all") dropped it while the egress kept running: the header lost
  // its badge and the button offered "Start Rec" for a recording that could no
  // longer be paused. The room flag carries it across the reload.
  const recordingActive = recordingStarted || roomIsRecording

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

  // ── Wide shared screen (persisted per-user) ───────────────────────────────
  // The stage already leans toward the shared screen while one is running (see
  // `screenSplit`), which is as far as it goes while the signer still needs a
  // panel to sign in. Wide mode is the step past that: the whole stage to the
  // share, signer down to a corner inset. Everyone chooses for themselves — a
  // student squinting at a spreadsheet can widen it without changing what
  // anyone else sees — and the choice is remembered for next lesson.
  const [screenWide, setScreenWide] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem("classroom:screenWide") === "1") setScreenWide(true)
    } catch { /* ignore — private mode or quota */ }
  }, [])
  const handleToggleScreenWide = useCallback(() => {
    setScreenWide((prev) => {
      const next = !prev
      try { window.localStorage.setItem("classroom:screenWide", next ? "1" : "0") } catch { /* ignore */ }
      return next
    })
  }, [])

  // ── Spotlight state (tutor-initiated, seen by everyone) ───────────────────
  const [spotlightedId, setSpotlightedId] = useState<string | null>(null)
  const spotlightRef = useRef<string | null>(null)

  // ── Class order (tutor-initiated, seen by everyone) ───────────────────────
  // The tutor's drag-to-reorder of the participants grid. Null until they drag,
  // which leaves everyone on the default sort — computed identically on every
  // client, so the room already agrees without anyone sending anything.
  //
  // It lives up here rather than in the panel because it is room state, not
  // view state: an order held locally by the teacher is exactly the thing that
  // made the teacher's room stop matching the class's.
  const [classOrder, setClassOrder] = useState<string[] | null>(null)
  const classOrderRef = useRef<string[] | null>(null)
  // Remember uploaded slides so tutor can resume without re-uploading
  const uploadedSlidesRef = useRef<UploadedSlides | null>(null)

  // Refs used for sync_response when participants join late
  const pptStateRef = useRef({ active: false, url: "", total: 0, page: 1 })

  const videoContainerRef = useRef<HTMLDivElement>(null)

  // ── Data channel: chat ─────────────────────────────────────────────────────
  // Messages are durable in Postgres (`LiveSessionChatMessage`) and also fan out
  // over LiveKit for live delivery. Stable client-generated `id`s keep the two
  // paths from duplicating the same bubble after a refresh / late join.

  // Breakout chat is scoped to the group it was sent in: a message typed in
  // Group A used to appear in every group, live and again after a reload.
  // Sending addresses the live message to the group only (see `chatAudience`),
  // and history is fetched for the groups this student has been placed in —
  // remembered per tab so a reload mid-breakout still brings their group's
  // conversation back, and kept after breakouts end so it stays readable.
  const chatGroupsStorageKey = `classroom:chat-groups:${sessionId}`
  const chatGroupIdsRef = useRef<Set<string>>(new Set())
  const chatGroupsLoadedRef = useRef(false)
  if (!chatGroupsLoadedRef.current) {
    chatGroupsLoadedRef.current = true
    try {
      const saved = typeof window !== "undefined" ? sessionStorage.getItem(chatGroupsStorageKey) : null
      const parsed = saved ? (JSON.parse(saved) as unknown) : null
      if (Array.isArray(parsed)) chatGroupIdsRef.current = new Set(parsed.filter((g) => typeof g === "string"))
    } catch { /* storage unavailable — group history just won't survive a reload */ }
  }
  // Where a message typed right now goes. Null = the whole class.
  const chatAudienceRef = useRef<ChatAudience | null>(null)

  const { send: sendChat } = useDataChannel(CHAT_TOPIC, (msg) => {
    try {
      const raw = JSON.parse(dec.decode(msg.payload)) as Partial<ChatMsg> & { ts?: unknown }
      if (!raw?.from) return

      const type = raw.type === "text" || raw.type === "reaction" || raw.type === "system" ? raw.type : "text"
      const ts = typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : Date.now()
      const id = raw.id ? String(raw.id) : `recv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      const data: ChatMsg = {
        id,
        from: String(raw.from),
        text: typeof raw.text === "string" ? raw.text : "",
        ts,
        type,
        ...(raw.attachment ? { attachment: raw.attachment } : {}),
        ...(typeof raw.groupId === "string" && raw.groupId
          ? { groupId: raw.groupId, ...(typeof raw.groupName === "string" ? { groupName: raw.groupName } : {}) }
          : {}),
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev
        return [...prev, data]
      })
      setChatFlash(true)
      setTimeout(() => setChatFlash(false), 800)
      if (!chatOpenRef.current && data.type !== "system") {
        setChatUnread((n) => n + 1)
        const preview =
          data.type === "reaction" ? `reacted ${data.text}`
            : data.text || (data.attachment ? "sent a file" : "")
        // One pop-up at a time: a newer message replaces the last one.
        toast(data.from, {
          id: "chat-new",
          description: preview.length > 90 ? `${preview.slice(0, 90)}…` : preview,
          icon: <MessageSquare className="size-4 text-primary" />,
          duration: 6000,
          action: { label: "Open chat", onClick: () => setChatOpen(true) },
        })
      }
    } catch { /* ignore malformed */ }
  })

  // Hydrate history so refreshes and late joiners see the conversation that
  // already happened — the live channel only covers "from now on". Messages
  // carry stable client-generated ids, so merging can never double up a bubble.
  const hydrateChat = useCallback(async () => {
    try {
      // Students get only their own breakout groups' messages back — see
      // `chatGroupIdsRef` below.
      const groups = [...chatGroupIdsRef.current].join(",")
      const qs = groups ? `?groups=${encodeURIComponent(groups)}` : ""
      const res = await fetch(`/api/sessions/${sessionId}/chat${qs}`, { cache: "no-store" })
      if (!res.ok) return
      const body = await res.json() as { messages?: ChatMsg[] }
      const history = Array.isArray(body.messages) ? body.messages : []
      if (history.length === 0) return
      setMessages((prev) => {
        if (prev.length === 0) return history
        const seen = new Set(prev.map((m) => m.id))
        const merged = [...prev]
        for (const m of history) {
          if (!seen.has(m.id)) {
            seen.add(m.id)
            merged.push(m)
          }
        }
        merged.sort((a, b) => a.ts - b.ts)
        return merged
      })
    } catch { /* offline / transient — live chat still works */ }
  }, [sessionId])

  // On mount, and again on every reconnect: a student whose connection dropped
  // mid-lesson missed every message sent while they were away, and those only
  // exist server-side.
  useEffect(() => {
    if (connectionState === ConnectionState.Disconnected) return
    void hydrateChat()
  }, [hydrateChat, connectionState])

  // ── Data channel: hand raise ───────────────────────────────────────────────

  // Mirrors so the sync_response handler below always sees current values.
  const raisedHandsRef = useRef<RaisedHand[]>([])
  useEffect(() => { raisedHandsRef.current = raisedHands }, [raisedHands])
  const handRaisedRef = useRef(false)
  useEffect(() => { handRaisedRef.current = handRaised }, [handRaised])

  const { send: sendHand } = useDataChannel(HAND_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as HandAction

      // A late joiner (or someone back from a reload) asks who has a hand up.
      if ("action" in data) {
        if (data.action === "sync_request" && isTutor) {
          const response: HandAction = { action: "sync_response", hands: raisedHandsRef.current }
          sendHand(enc.encode(JSON.stringify(response)), { reliable: true })
        } else if (data.action === "sync_response" && !isTutor) {
          // Never let the snapshot drop this student's own hand: their
          // re-announcement after a reload can still be in flight.
          const mine = { identity: localParticipant.identity, name: localName }
          setRaisedHands(
            handRaisedRef.current && !data.hands.some((h) => h.identity === mine.identity)
              ? [...data.hands, mine]
              : data.hands,
          )
        }
        return
      }

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
        // A raised hand used to pin the student to the main stage on the spot,
        // which wiped out the slide, board or video the tutor was mid-sentence
        // on. Announce it quietly in the side toast rail instead and let the
        // tutor bring the student up when they reach a natural break.
        if (data.raised) {
          toast.info(`${data.name} raised their hand ✋`, {
            id: `hand-${data.identity}`,
            description: "They'll wait — bring them up when you're ready.",
            // Stays until the tutor acts on it (Show / close) or the student
            // lowers their hand. On a timer it vanished while the tutor was
            // mid-sign, and a missed hand is a student left waiting.
            duration: Infinity,
            closeButton: true,
            action: { label: "Show", onClick: () => setPinnedId(data.identity) },
          })
        } else {
          // Hand's down: drop the stale prompt, and the pin if it was taken.
          toast.dismiss(`hand-${data.identity}`)
          setPinnedId((prev) => prev === data.identity ? null : prev)
        }
      }
      const text = data.raised ? `${data.name} raised their hand ✋` : `${data.name} lowered their hand`
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, from: "system", text, ts: Date.now(), type: "system" },
      ])
    } catch { /* ignore */ }
  })

  useEffect(() => {
    if (raisedHands.length === 0) return
    const present = new Set(participants.map((p) => p.identity))
    setRaisedHands((prev) => {
      const next = prev.filter((h) => present.has(h.identity))
      return next.length === prev.length ? prev : next
    })
  }, [participants, raisedHands.length])

  // ── Data channel: PPT sync ─────────────────────────────────────────────────

  const { send: sendPpt } = useDataChannel(PPT_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as PptAction

      // Anything the tutor pushes live is fresher than the stored stage row,
      // so stop the server hydrate from overriding it. `sync_request` is a
      // student asking, not the tutor answering, so it doesn't count.
      if (data.action !== "sync_request") {
        stageTouchedRef.current = true
        lastLiveStageRef.current = Date.now()
      }

      // ── Slides ───────────────────────────────────────────────────────────
      if (data.action === "start") {
        setPresentKind("slides")
        setPptUrl(data.url)
        setPptTotalPages(data.total)
        setPptCurrentPage(data.page)
        setPptActive(true)
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
          return
        }
        // Nothing on stage — say so, so a student who restored a slide from
        // storage while the tutor was stopping it doesn't keep showing it.
        sendPpt(enc.encode(JSON.stringify({ action: "sync_idle" } as PptAction)), { reliable: true })
        return
      }

      if (data.action === "sync_idle" && !isTutor) {
        setPptActive(false)
        setPresentKind(null)
        setPptUrl(null)
        setPptCurrentPage(1)
        setPptTotalPages(0)
        setVideoPlaying(false)
        setVideoCurrentTime(0)
        return
      }

      if (data.action === "sync_response" && !isTutor) {
        setPresentKind("slides")
        setPptUrl(data.url)
        setPptTotalPages(data.total)
        setPptCurrentPage(data.page)
        setPptActive(true)
        return
      }

      if (data.action === "video_sync_response" && !isTutor) {
        setPresentKind("video")
        setPptUrl(data.url)
        setPptActive(true)
        setVideoPlaying(data.playing)
        setVideoCurrentTime(data.currentTime)
        setVideoAsOf(data.ts)
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
        pointerOwner.current = msg.from?.identity ?? null
        // Moves ride the lossy channel, which is right for a cursor — a dropped
        // sample is replaced 33ms later — but lossy also means unordered. An
        // older packet arriving after a newer one used to yank the hand back to
        // where it had already been, which reads exactly like lag.
        if (typeof data.n === "number") {
          // Reordering only happens between packets in flight together, so a
          // pause longer than any plausible flight time means this is a fresh
          // gesture — very often from a tutor who rejoined and whose counter
          // has started again from zero. Trust it and resynchronise.
          const stale = Date.now() - lastPointerAt.current > 1_000
          const behind = lastPointerSeq.current - data.n
          if (!stale && behind >= 0) return
          lastPointerSeq.current = data.n
          lastPointerAt.current = Date.now()
        }
        setLivePointer({ x: data.x, y: data.y })
        if (pointerHideTimer.current) clearTimeout(pointerHideTimer.current)
        // Not a fade-out: see POINTER_STALE_MS. This only fires when the
        // keepalive has stopped entirely, which means the teacher is gone.
        pointerHideTimer.current = setTimeout(() => setLivePointer(null), POINTER_STALE_MS)
      } else if (data.action === "hide") {
        setLivePointer(null)
        pointerOwner.current = null
        lastPointerSeq.current = -1
        lastPointerAt.current = 0
        if (pointerHideTimer.current) clearTimeout(pointerHideTimer.current)
      }
    } catch { /* ignore malformed */ }
  })

  // Turn the pointer off automatically when slides stop
  useEffect(() => {
    if (!pptActive && pointerMode) setPointerMode(false)
    if (!pptActive) setLivePointer(null)
  }, [pptActive, pointerMode])

  /**
   * The pointer stays up until it is taken down — so something has to take it
   * down when the person holding it walks out. Without this, a teacher who
   * closes the tab mid-gesture leaves a hand stuck on everyone's slide until
   * the stale guard eventually notices; this is the immediate, certain path.
   */
  useEffect(() => {
    if (isTutor) return
    const onLeft = (participant: { identity: string }) => {
      if (pointerOwner.current !== participant.identity) return
      pointerOwner.current = null
      setLivePointer(null)
      if (pointerHideTimer.current) clearTimeout(pointerHideTimer.current)
    }
    room.on(RoomEvent.ParticipantDisconnected, onLeft)
    return () => { room.off(RoomEvent.ParticipantDisconnected, onLeft) }
  }, [room, isTutor])

  // ── Data channel: spotlight ─────────────────────────────────────────────────

  const { send: sendSpotlight } = useDataChannel(SPOTLIGHT_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as SpotlightAction

      // The ref is written here as well as by its sync effect: a clear that
      // lands right behind a set would otherwise read the stale value and
      // leave the student pinned to someone nobody is spotlighting.
      if (data.action === "set") {
        spotlightRef.current = data.identity
        setSpotlightedId(data.identity)
        if (!isTutor) setPinnedId(data.identity)
        return
      }
      if (data.action === "clear") {
        const was = spotlightRef.current
        spotlightRef.current = null
        setSpotlightedId(null)
        if (!isTutor && was) setPinnedId((prev) => (prev === was ? null : prev))
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

  // ── Data channel: class order ──────────────────────────────────────────────
  // Only the tutor sends `set`; everyone applies it. A student who joins late
  // asks for the current arrangement, and the tutor answers from the ref so the
  // reply doesn't depend on this closure's copy of the state.

  const { send: sendOrder } = useDataChannel(ORDER_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as OrderAction

      if (data.action === "set") {
        // Applied by everyone, co-teachers included: a room where one teacher
        // rearranges and the other doesn't move is the same split this fixes.
        // Our own sends never come back to us, so this can't clobber the drag
        // that produced it.
        setClassOrder(Array.isArray(data.order) ? data.order : null)
        return
      }
      if (data.action === "sync_request" && isTutor) {
        const response: OrderAction = { action: "sync_response", order: classOrderRef.current }
        try {
          sendOrder(enc.encode(JSON.stringify(response)), { reliable: true })
        } catch { /* ignore */ }
        return
      }
      if (data.action === "sync_response" && !isTutor) {
        setClassOrder(Array.isArray(data.order) ? data.order : null)
        return
      }
    } catch { /* ignore malformed */ }
  })

  // ── Data channel: gallery / spotlight ──────────────────────────────────────
  // Only tutors send `set`; everyone applies it, co-teachers included. Answers
  // to a late joiner come from the ref, not this closure's copy of the state.

  const { send: sendView } = useDataChannel(VIEW_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as ViewAction
      if (data.action === "set" || (data.action === "sync_response" && !isTutor)) {
        setGalleryView(data.view === "gallery")
        return
      }
      if (data.action === "sync_request" && isTutor) {
        const response: ViewAction = {
          action: "sync_response",
          view: galleryViewRef.current ? "gallery" : "spotlight",
        }
        try {
          sendView(enc.encode(JSON.stringify(response)), { reliable: true })
        } catch { /* ignore */ }
      }
    } catch { /* ignore malformed */ }
  })

  // ── Data channel: tutor-controlled microphones ─────────────────────────────
  // Server permission updates can lag the data-channel command by a few hundred ms.
  // Retry enabling so publish doesn't fail silently while the UI still looks "on".
  // `micEnableRunRef` supersedes an in-flight attempt when a newer one starts
  // (the permission-change listener below can fire mid-retry) so two loops can't
  // race to publish or both report the same failure.
  const micEnableRunRef = useRef(0)
  const enableStudentMic = useCallback(async () => {
    const run = ++micEnableRunRef.current
    const retryDelaysMs = [0, 500, 1200, 2500, 4000, 6000]
    for (let i = 0; i < retryDelaysMs.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[i]! - retryDelaysMs[i - 1]!))
      }
      if (run !== micEnableRunRef.current) return
      if (!micAllowedByTutorRef.current) return
      try {
        await localParticipant.setMicrophoneEnabled(true)
        if (localParticipant.isMicrophoneEnabled) return
      } catch {
        // Permission may not have propagated yet — retry.
      }
    }
    if (run !== micEnableRunRef.current) return
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
          id: `speak-${data.identity}`,
          description: "Accept to turn their microphone on, or deny to leave them muted.",
          duration: 20000,
          action: { label: "Accept", onClick: () => { void handleAcceptSpeak(data.identity, data.name) } },
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
          description: "Turning your microphone on\u2026",
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

  // The tutor's `set-mic` command travels over the data channel while the matching
  // publish permission travels over the signalling connection, and the command
  // regularly wins that race — the student then tries to publish before the server
  // will let them and the tutor's "yes" silently does nothing. LiveKit tells us the
  // moment the new permission actually lands, so retry then instead of hoping one of
  // the fixed retry delays happens to line up.
  useEffect(() => {
    if (isTutor) return
    const onPermissionsChanged = (
      _prev: unknown,
      participant: { identity: string },
    ) => {
      if (participant.identity !== localParticipant.identity) return
      if (!micAllowedByTutorRef.current) return
      if (localParticipant.isMicrophoneEnabled) return
      void enableStudentMic()
    }
    room.on(RoomEvent.ParticipantPermissionsChanged, onPermissionsChanged)
    return () => { room.off(RoomEvent.ParticipantPermissionsChanged, onPermissionsChanged) }
  }, [isTutor, room, localParticipant, enableStudentMic])

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
      // Trust the sender's token metadata, not a single remembered identity:
      // with a co-tutor in the room the "first tutor" lookup could pick the
      // wrong one, and control messages were previously accepted from anyone.
      const isFromTutor = msg.from?.metadata === "tutor"
      const studentWriteAllowed = () => whiteboardStateRef.current.studentWrite

      // Lifecycle + permission changes only ever come from a tutor.
      if (
        !isFromTutor &&
        (data.action === "start" ||
          data.action === "stop" ||
          data.action === "student_write" ||
          data.action === "sync_response")
      ) return

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
        if (!isFromTutor && !studentWriteAllowed()) return
        if (wbApiRef.current) wbApiRef.current.applyChanges(data.changes)
        else wbPendingRef.current.changes.push(data.changes)
        return
      }

      // Live cursor from a peer. Cursors are applied regardless of write
      // permission, but a view-only student's scribbles are stripped: tldraw
      // keeps the laser tool usable in readonly mode, and its fading trail
      // looked like students drawing over the tutor. Dropped (not buffered) if
      // the board isn't mounted yet — presence is ephemeral and the next frame
      // is ~60ms out.
      if (data.action === "presence") {
        const presence = isFromTutor || studentWriteAllowed()
          ? data.presence
          : { ...data.presence, scribbles: [], brush: null }
        wbApiRef.current?.applyPresence(presence)
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
          // Presence carries the tutor's camera + screen bounds. Without it a
          // late joiner (or a student whose board mounted after the first
          // cursor frame) would stay at 100% zoom while the tutor is zoomed
          // out around a picture.
          presence: wbApiRef.current?.getPresence() ?? undefined,
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
        if (data.presence) {
          if (wbApiRef.current) wbApiRef.current.applyPresence(data.presence)
          else wbPendingRef.current.presence = data.presence
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

  const [activeNudge, setActiveNudge] = useState<
    { id: number; from: string; message: string | null; self: boolean } | null
  >(null)

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
      // Respect a targeted nudge. A single-student nudge is the narrowest
      // target and wins outright: nobody but that student renders it, tutors
      // included — otherwise a private "look up" turns into a class-wide flash.
      if (data.targetId) {
        if (data.targetId !== localBaseId) return
      } else if (data.groupId && !isTutor) {
        // Group nudge: only members of that group. The tutor always sees their
        // own nudge echo so they know it fired.
        const own = breakoutStateRef.current.groups.find((g) => g.memberIds.includes(localBaseId))
        if (!own || own.id !== data.groupId) return
      }
      setActiveNudge({ id: Date.now(), from: data.from, message: data.message ?? null, self: false })
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

  // Keep classOrderRef in sync so the sync_response handler answers with the
  // arrangement that is live now, not the one captured when it was registered.
  useEffect(() => {
    classOrderRef.current = classOrder
  }, [classOrder])

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

  // ── Everyone: pull the current stage on (re)connect ────────────────────────
  // Two independent sources, because either one can be unavailable:
  //   • the stored stage row — works even when the tutor's tab is reloading
  //   • a `sync_request` to the tutor — works even when the row was never written
  // Runs on every transition into Connected, so a student who dropped mid-lesson
  // is put back on the right slide instead of on whatever they last saw.
  useEffect(() => {
    // While we are not connected we are missing stage events, so let the stored
    // row speak again on the way back in rather than trusting what we last saw.
    if (connectionState !== ConnectionState.Connected) {
      stageTouchedRef.current = false
      return
    }
    void hydrateStage()
    if (isTutor) return
    const id = setTimeout(() => {
      try {
        sendPpt(enc.encode(JSON.stringify({ action: "sync_request" } as PptAction)), { reliable: true })
      } catch { /* connection may have dropped again */ }
    }, 600)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState, isTutor, hydrateStage])

  // ── Student: keep asking while the stage is empty ──────────────────────────
  // Retry rather than asking once. A class-wide refresh reloads everyone at the
  // same moment, so a single request 2s after connecting routinely lands while
  // the tutor's own page is still coming back up — and the student would then
  // sit in front of a blank stage for the rest of the lesson. Backs off after
  // the first minute rather than giving up: a student can join well before the
  // tutor starts presenting, and must still get the slides when they do.
  const pptSyncAttempts = useRef(0)
  useEffect(() => {
    if (isTutor || connectionState !== ConnectionState.Connected) return
    if (pptActive) {
      pptSyncAttempts.current = 0
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = () => {
      pptSyncAttempts.current += 1
      try {
        sendPpt(enc.encode(JSON.stringify({ action: "sync_request" } as PptAction)), { reliable: true })
      } catch { /* ignore */ }
      void hydrateStage()
      // Fast while a late joiner is waiting to catch up, then slow so a student
      // who is simply early doesn't poll all lesson at 6s intervals.
      timer = setTimeout(tick, pptSyncAttempts.current < 10 ? 6000 : 30000)
    }

    timer = setTimeout(tick, 2000)
    return () => { if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTutor, connectionState, pptActive, hydrateStage])

  // ── Student: reconcile the stage while a lesson is on screen ───────────────
  // The retry loop above stops the moment something is showing, which leaves one
  // hole: a stage event that never lands. A packet sent while this tab was
  // asleep, or during a reconnect the student never noticed, is simply gone —
  // and they would sit on a stale slide for the rest of the lesson with nothing
  // to correct them. So re-read the stored stage now and then, but only after a
  // quiet spell (never fight a tutor mid-deck) and only apply a real difference.
  // Guards against overlapping reconciles. `fetchStageState` now has a deadline,
  // but a link slow enough to take five seconds would still stack ticks.
  const stageReconcileInFlight = useRef(false)
  useEffect(() => {
    if (isTutor || connectionState !== ConnectionState.Connected) return
    if (!pptActive) return

    const id = setInterval(() => {
      if (Date.now() - lastLiveStageRef.current < STAGE_QUIET_MS) return
      if (stageReconcileInFlight.current) return
      void (async () => {
        stageReconcileInFlight.current = true
        try {
          const state = await fetchStageState(sessionId)
          // The tutor may have spoken while the request was in flight.
          if (!state || Date.now() - lastLiveStageRef.current < STAGE_QUIET_MS) return
          const local = stageLocalRef.current

          if (!state.active) {
            if (local.active) applyStageState(state)
            return
          }
          if (state.kind === "slides") {
            if (local.kind !== "slides" || local.url !== state.url || local.page !== state.page) {
              applyStageState(state)
            }
            return
          }
          // Video: only a different clip is worth acting on. Re-applying the
          // stored position would yank a student who is perfectly in sync back
          // to a sample that can be several seconds old.
          if (state.kind === "video" && (local.kind !== "video" || local.url !== state.url)) {
            applyStageState(state)
          }
        } catch { /* transient — the next tick tries again */ }
        finally { stageReconcileInFlight.current = false }
      })()
    }, STAGE_RECONCILE_MS)

    return () => clearInterval(id)
  }, [isTutor, connectionState, pptActive, sessionId, applyStageState])

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
      const msg: ChatMsg = {
        id: (typeof crypto !== "undefined" && "randomUUID" in crypto)
          ? crypto.randomUUID()
          : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        from: localName,
        text,
        ts: Date.now(),
        type,
        attachment,
      }
      const audience = chatAudienceRef.current
      if (audience) {
        msg.groupId = audience.groupId
        msg.groupName = audience.groupName
      }
      // Optimistic local append + live fan-out.
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
      try {
        if (!audience) {
          sendChat(enc.encode(JSON.stringify(msg)), { reliable: true })
        } else if (audience.identities.length > 0) {
          // Never send with an empty list: LiveKit reads that as "everyone".
          sendChat(enc.encode(JSON.stringify(msg)), {
            reliable: true,
            destinationIdentities: audience.identities,
          })
        }
      } catch { /* connection may have dropped */ }

      // Persist so refreshes / late joiners can hydrate. Fire-and-forget; the
      // live channel already delivered the message to everyone currently in-room.
      void fetch(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      }).catch(() => { /* ignore — durability best-effort */ })
    },
    [localName, sendChat, sessionId]
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

  // ── Hand raise survives a reload ───────────────────────────────────────────
  // A reconnect issues a brand-new LiveKit identity, so a student who reloads
  // with their hand up comes back as a stranger with no hand raised. Remember
  // the flag per session/tab and re-announce it once reconnected.
  const handStorageKey = `classroom:hand:${sessionId}`
  const handRestoredRef = useRef(false)

  useEffect(() => {
    if (isTutor) return
    try {
      if (sessionStorage.getItem(handStorageKey) === "1") handRestoredRef.current = true
    } catch { /* storage disabled — the hand just won't survive a reload */ }
    // Read once, on mount, before the mirror effect below can clear it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isTutor) return
    try {
      if (handRaised) sessionStorage.setItem(handStorageKey, "1")
      else sessionStorage.removeItem(handStorageKey)
    } catch { /* ignore */ }
  }, [isTutor, handRaised, handStorageKey])

  useEffect(() => {
    if (isTutor || connectionState !== ConnectionState.Connected) return

    const timers: ReturnType<typeof setTimeout>[] = []

    if (handRestoredRef.current) {
      handRestoredRef.current = false
      timers.push(setTimeout(() => {
        const evt: HandAction = { identity: localParticipant.identity, name: localName, raised: true }
        try { sendHand(enc.encode(JSON.stringify(evt)), { reliable: true }) } catch { /* ignore */ }
        setHandRaised(true)
        setRaisedHands((prev) => (
          prev.some((h) => h.identity === localParticipant.identity)
            ? prev
            : [...prev, { identity: localParticipant.identity, name: localName }]
        ))
      }, 800))
    }

    // Then ask the tutor who else has a hand up, so a late joiner sees the class
    // as it actually is rather than as it was from this moment on.
    timers.push(setTimeout(() => {
      try {
        sendHand(enc.encode(JSON.stringify({ action: "sync_request" } as HandAction)), { reliable: true })
      } catch { /* ignore */ }
    }, 1400))

    return () => { for (const t of timers) clearTimeout(t) }
  }, [isTutor, connectionState, localParticipant.identity, localName, sendHand])

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
    // Our own send doesn't come back through the receiver, so clear the side
    // prompt here — otherwise it lingers for a hand that is already down.
    toast.dismiss(`hand-${identity}`)
  }, [isTutor, raisedHands, sendHand])

  const handleLowerAllHands = useCallback(() => {
    if (!isTutor || raisedHands.length === 0) return
    for (const h of raisedHands) {
      const evt = { identity: h.identity, name: h.name, raised: false }
      sendHand(enc.encode(JSON.stringify(evt)), { reliable: true })
    }
    for (const h of raisedHands) toast.dismiss(`hand-${h.identity}`)
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

  // ── Tutor: mirror the stage to the server ─────────────────────────────────
  // Every change to what's on screen is written to `/api/sessions/[id]/live-state`
  // so a student who joins late, or reloads while this tab is also reloading,
  // can read it back instead of waiting for a peer to answer. Coalesced through
  // one timer: flicking through slides must not turn into a write per keypress.
  const stagePendingRef = useRef<StagePayload | null>(null)
  const stagePublishTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publishStage = useCallback((payload: StagePayload, delay = 0) => {
    if (!isTutor) return
    stagePendingRef.current = payload
    if (stagePublishTimer.current) clearTimeout(stagePublishTimer.current)
    stagePublishTimer.current = setTimeout(() => {
      const pending = stagePendingRef.current
      stagePendingRef.current = null
      if (!pending) return
      void publishStageState(sessionId, pending).catch(() => {
        /* best effort — the live channel already reached everyone in the room */
      })
    }, delay)
  }, [isTutor, sessionId])

  useEffect(() => () => {
    if (stagePublishTimer.current) clearTimeout(stagePublishTimer.current)
  }, [])

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
    videoStateRef.current = { url, playing: false, currentTime: 0, ts: now }

    safeSendPpt({ action: "video_start", url })
    publishStage({ active: true, kind: "video", url, videoPlaying: false, videoTime: 0 })

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
  }, [safeSendPpt, publishStage])

  const handleSlidesUploaded = useCallback((data: UploadedSlides) => {
    setShowUpload(false)
    uploadedSlidesRef.current = data
    if (data.kind === "video") {
      handleVideoStart(data.url)
      return
    }
    setPickerData(data)
  }, [handleVideoStart])

  // Puts a deck on the stage for everyone. Shared by the post-upload picker and
  // by a deck prepared before the lesson, so both paths behave identically.
  const startSlides = useCallback((deck: SlidesUpload, selected: number[]) => {
    if (selected.length === 0) return

    const { url, total } = deck
    // Same deck as before → pick up on the slide it was closed on, as long as
    // that slide is still in the chosen set.
    const lastPage = deckPositionsRef.current[url]
    const firstPage = lastPage && selected.includes(lastPage) ? lastPage : selected[0]

    setPickerData(null)
    setPresentKind("slides")
    setSelectedSlides(selected)
    setPptUrl(url)
    setPptTotalPages(total)
    setPptCurrentPage(firstPage)
    setPptActive(true)
    setSlideTrayOpen(true)

    safeSendPpt({ action: "start", url, total, page: firstPage })
    publishStage({
      active: true, kind: "slides", url, page: firstPage, totalPages: total, selectedPages: selected,
    })

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
  }, [safeSendPpt, publishStage])

  const handleSlidesPicked = useCallback((selected: number[]) => {
    if (!pickerData) return
    startSlides(pickerData, selected)
    // Remember the choice on the session so this deck is ready to go next time
    // — including after a mid-lesson upload. Best effort: presenting has already
    // started, and a failed write must not interrupt the lesson.
    setPreparedDeck({ slides: pickerData, selectedPages: selected })
    void registerPresentation(sessionId, {
      fileUrl:  pickerData.url,
      fileName: pickerData.fileName,
      mimeType: pickerData.mimeType,
      selectedPages: selected,
      totalPages: pickerData.total,
    }).catch(() => { /* the lesson carries on regardless */ })
  }, [pickerData, startSlides, sessionId])

  // One-click start for a deck prepared ahead of the lesson.
  const handlePresentPrepared = useCallback(() => {
    if (!preparedDeck) return
    const { slides, selectedPages } = preparedDeck
    if (slides.kind === "video") {
      handleVideoStart(slides.url)
      return
    }
    // No explicit pick recorded (the tutor uploaded but never chose) — show all.
    const pages = selectedPages.length > 0
      ? selectedPages
      : Array.from({ length: slides.total }, (_, i) => i + 1)
    startSlides(slides, pages)
  }, [preparedDeck, handleVideoStart, startSlides])

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

  // Tutor: keep the stored stage row on the current page. An effect rather than
  // a call inside every handler, so next/prev, tray jumps and mid-lesson changes
  // to the included set all land the same way. Debounced — flicking through a
  // deck must not become a write per slide.
  useEffect(() => {
    if (!isTutor) return
    if (!pptActive || presentKind !== "slides" || !pptUrl) return
    publishStage({
      active: true,
      kind: "slides",
      url: pptUrl,
      page: pptCurrentPage,
      totalPages: pptTotalPages,
      selectedPages: selectedSlides,
    }, 700)
  }, [
    isTutor, pptActive, presentKind, pptUrl,
    pptCurrentPage, pptTotalPages, selectedSlides, publishStage,
  ])

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
    // Long debounce: a late joiner only needs a position within a few seconds,
    // and the tutor's live broadcasts correct them the moment they arrive.
    if (url) {
      publishStage(
        { active: true, kind: "video", url, videoPlaying: playing, videoTime: currentTime },
        5000,
      )
    }
  }, [isTutor, pptUrl, safeSendPpt, publishStage])

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

  /** Push the most recent position out now, and reset the throttle window. */
  const flushPointer = useCallback(() => {
    if (pointerFlushTimer.current) {
      clearTimeout(pointerFlushTimer.current)
      pointerFlushTimer.current = null
    }
    const p = pendingPointer.current
    if (!p) return
    pendingPointer.current = null
    lastPointerSent.current = Date.now()
    pointerSeq.current += 1
    safeSendPointer({ action: "move", x: p.x, y: p.y, n: pointerSeq.current })
  }, [safeSendPointer])

  /**
   * Throttle with a trailing edge. Sends immediately when the window is open,
   * and otherwise holds the newest position and sends it the moment the window
   * closes — so the final resting place of the tutor's hand always goes out,
   * which is the position the students are being asked to look at.
   */
  const queuePointer = useCallback((x: number, y: number) => {
    pendingPointer.current = { x, y }
    const waited = Date.now() - lastPointerSent.current
    if (waited >= POINTER_SEND_INTERVAL_MS) { flushPointer(); return }
    if (pointerFlushTimer.current) return
    pointerFlushTimer.current = setTimeout(flushPointer, POINTER_SEND_INTERVAL_MS - waited)
  }, [flushPointer])

  const cancelPendingPointer = useCallback(() => {
    pendingPointer.current = null
    if (pointerFlushTimer.current) {
      clearTimeout(pointerFlushTimer.current)
      pointerFlushTimer.current = null
    }
  }, [])

  const handleTogglePointer = useCallback(() => {
    const next = !pointerMode
    setPointerMode(next)
    if (!next) {
      cancelPendingPointer()
      setLivePointer(null)
      safeSendPointer({ action: "hide" })
    }
  }, [pointerMode, safeSendPointer, cancelPendingPointer])

  const handleSlidePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTutor || !pointerMode) return
    const host = slideAreaRef.current
    if (!host) return
    const hostRect = host.getBoundingClientRect()
    if (hostRect.width === 0 || hostRect.height === 0) return

    // Measure against the drawn slide when we know where it is. Falling back to
    // the panel keeps the legacy PPTX path working exactly as before.
    const box = slideContentBoxRef.current
    const originX = hostRect.left + (box?.left ?? 0)
    const originY = hostRect.top  + (box?.top  ?? 0)
    const width   = box?.width  ?? hostRect.width
    const height  = box?.height ?? hostRect.height
    if (width < 1 || height < 1) return

    // Clamped rather than discarded. Out of range means the cursor is over the
    // letterbox beside the slide; freezing the hand at its last position there
    // is precisely the "it doesn't follow me" complaint, whereas tracking to the
    // slide edge is both truthful and what the tutor expects.
    const x = Math.min(1, Math.max(0, (e.clientX - originX) / width))
    const y = Math.min(1, Math.max(0, (e.clientY - originY) / height))

    setLivePointer({ x, y })
    queuePointer(x, y)
  }, [isTutor, pointerMode, queuePointer])

  // There is deliberately no `onPointerLeave` handler any more. Taking the hand
  // down when the teacher's cursor wandered off the slide meant it vanished
  // every time they reached for the slide controls, the chat, or their notes —
  // while they were still talking about the thing they had just marked. The
  // pointer is a placed marker, not a cursor mirror: it stays where it was put
  // until the teacher turns it off, ends the presentation, or leaves.

  /**
   * Keep saying where the hand is while it is still.
   *
   * A cursor that is not moving emits no events, so without this the students'
   * copy rests on the last packet that happened to arrive — and one dropped
   * datagram at the end of a gesture leaves them looking at the wrong place for
   * as long as the tutor holds there, which is exactly when it matters most. It
   * also delivers the pointer to anyone who joined or reconnected mid-gesture.
   */
  useEffect(() => {
    if (!isTutor || !pointerMode) return
    const id = setInterval(() => {
      const p = livePointerRef.current
      if (!p) return
      pointerSeq.current += 1
      safeSendPointer({ action: "move", x: p.x, y: p.y, n: pointerSeq.current })
    }, POINTER_KEEPALIVE_MS)
    return () => clearInterval(id)
  }, [isTutor, pointerMode, safeSendPointer])

  // Never leave a scheduled send behind on unmount.
  useEffect(() => cancelPendingPointer, [cancelPendingPointer])

  /**
   * Where to draw the hand. Positioned with a transform rather than percentage
   * offsets: it is composited instead of triggering layout on every sample, and
   * the smoothing transition is matched to the send interval so the hand glides
   * between samples without falling behind during a continuous sweep.
   */
  const pointerStyle = useMemo<React.CSSProperties | null>(() => {
    if (!livePointer) return null
    const base: React.CSSProperties = {
      filter: "drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000) drop-shadow(0 2px 6px rgba(0,0,0,0.85))",
      // The tutor's own hand tracks their cursor exactly; only the copy that
      // arrived over the network needs smoothing between samples.
      transition: isTutor ? "none" : `transform ${POINTER_SMOOTHING_MS}ms linear`,
      willChange: "transform",
    }
    // lucide's Pointer icon puts the index fingertip near (4, 2) of its 24×24
    // viewBox, so the second translate moves that spot onto the coordinate.
    const anchor = "translate(-16.7%, -8.3%)"
    if (slideContentBox) {
      const px = slideContentBox.left + livePointer.x * slideContentBox.width
      const py = slideContentBox.top  + livePointer.y * slideContentBox.height
      return { ...base, left: 0, top: 0, transform: `translate3d(${px}px, ${py}px, 0) ${anchor}` }
    }
    return {
      ...base,
      left: `${livePointer.x * 100}%`,
      top:  `${livePointer.y * 100}%`,
      transform: anchor,
    }
  }, [livePointer, slideContentBox, isTutor])

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
    // A reload mid-breakout (or mid-recording) isn't "entering" the class —
    // the reminder is noise there, and it lands on top of the breakout
    // monitor's controls.
    if (recordingActive || breakoutsActive) return
    toast.info("Click Start Rec in the controls bar when you're ready to record this session.", {
      id: "recording-reminder",
      duration: 12_000,
      // Sonner pauses the timer while hovered, so without a close button a
      // toast sitting over other controls could never be got rid of.
      closeButton: true,
    })
  }, [isTutor, connectionState, recordingActive, breakoutsActive])

  // Drop the reminder once it no longer applies — the room's recording flag
  // can arrive just after connect, and breakouts put the monitor under it.
  useEffect(() => {
    if (recordingActive || breakoutsActive) toast.dismiss("recording-reminder")
  }, [recordingActive, breakoutsActive])

  // Tutor starts, pauses, or resumes recording. Each pause/resume creates a
  // separate MP4 segment in S3.
  const handleToggleRecording = useCallback(async () => {
    if (!isTutor || recordingBusy) return
    setRecordingBusy(true)

    const prevStarted = recordingActive
    const prevPaused = recordingPaused

    if (!recordingActive) {
      setRecordingStarted(true)
      setRecordingPaused(false)
    } else {
      setRecordingStarted(true)
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
  }, [isTutor, recordingBusy, recordingActive, recordingPaused, sessionId])

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

  // ── Class order handler (tutor only) ───────────────────────────────────────

  // `useDataChannel` memoises its sender on the message callback, which is a
  // fresh closure every render — so `sendOrder` has a new identity every render
  // too. Held in a ref and read at call time, so `safeSendOrder` stays stable
  // and the effects below can schedule a timer that actually survives to fire.
  const sendOrderRef = useRef(sendOrder)
  useEffect(() => { sendOrderRef.current = sendOrder })

  const safeSendOrder = useCallback((data: OrderAction) => {
    if (connectionState !== ConnectionState.Connected) return
    const send = sendOrderRef.current
    if (typeof send !== "function") return
    try {
      const result = send(enc.encode(JSON.stringify(data)), { reliable: true }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore */ })
      }
    } catch { /* ignore */ }
  }, [connectionState])

  // Applied locally first so the tile lands under the cursor without waiting for
  // the round trip, then mirrored to the room.
  const handleReorderClass = useCallback((order: string[]) => {
    if (!isTutor) return
    setClassOrder(order)
    classOrderRef.current = order
    safeSendOrder({ action: "set", order })
  }, [isTutor, safeSendOrder])

  // A student who joins (or reloads) mid-lesson asks for the arrangement the
  // room is already using. Without it they sit on the default sort while
  // everyone else is on the tutor's, which is the same mismatch by another
  // route. Delayed like the hand sync so it doesn't race the data channel
  // coming up.
  useEffect(() => {
    if (isTutor || connectionState !== ConnectionState.Connected) return
    const timer = setTimeout(() => {
      safeSendOrder({ action: "sync_request" })
    }, 1400)
    return () => clearTimeout(timer)
  }, [isTutor, connectionState, safeSendOrder])

  // A tutor who reloads comes back on the default sort, so there is nothing to
  // re-announce; if they still hold an arrangement after a reconnect, the room
  // gets it again rather than drifting until the next drag. The ref is cleared
  // on the way down so each connected episode re-announces exactly once.
  const orderRebroadcastRef = useRef(false)
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      orderRebroadcastRef.current = false
      return
    }
    if (!isTutor || orderRebroadcastRef.current) return
    const order = classOrderRef.current
    if (!order) return
    orderRebroadcastRef.current = true
    safeSendOrder({ action: "set", order })
  }, [isTutor, connectionState, safeSendOrder])

  // ── Gallery / spotlight (tutor sets it for the room) ──────────────────────
  // Same stable-sender arrangement as `safeSendOrder`.
  const sendViewRef = useRef(sendView)
  useEffect(() => { sendViewRef.current = sendView })

  const safeSendView = useCallback((data: ViewAction) => {
    if (connectionState !== ConnectionState.Connected) return
    const send = sendViewRef.current
    if (typeof send !== "function") return
    try {
      const result = send(enc.encode(JSON.stringify(data)), { reliable: true }) as unknown as Promise<void> | void
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => { /* ignore */ })
      }
    } catch { /* ignore */ }
  }, [connectionState])

  // Tutor: switch locally, then take the room with them. A student's own
  // switch (only a pin can cause one) stays on their screen until the tutor
  // next changes the view.
  const handleSetGalleryView = useCallback((next: boolean) => {
    setGalleryView(next)
    galleryViewRef.current = next
    if (isTutor) safeSendView({ action: "set", view: next ? "gallery" : "spotlight" })
  }, [isTutor, safeSendView])

  // A student joining (or reloading) mid-lesson asks which view the room is in.
  useEffect(() => {
    if (isTutor || connectionState !== ConnectionState.Connected) return
    const timer = setTimeout(() => {
      safeSendView({ action: "sync_request" })
    }, 1400)
    return () => clearTimeout(timer)
  }, [isTutor, connectionState, safeSendView])

  // A tutor announces their view once per connected episode. Unlike the class
  // order this includes spotlight: a tutor who reloads comes back in
  // spotlight, and a class left in gallery would otherwise stay there with no
  // way back.
  const viewAnnouncedRef = useRef(false)
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      viewAnnouncedRef.current = false
      return
    }
    if (!isTutor || viewAnnouncedRef.current) return
    const timer = setTimeout(() => {
      viewAnnouncedRef.current = true
      safeSendView({ action: "set", view: galleryViewRef.current ? "gallery" : "spotlight" })
    }, 1400)
    return () => clearTimeout(timer)
  }, [isTutor, connectionState, safeSendView])

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
  //
  // Pins the student on the tutor's own stage too. Without that the tutor was
  // the one person in the room who didn't see the pair, and the "tutor
  // unpinned, so stop the spotlight" effect below cleared it straight away —
  // sending a clear the students' stage never acted on, leaving them stuck.
  const handleToggleSpotlightFor = useCallback((identity: string) => {
    if (!isTutor) return
    if (spotlightedId === identity) {
      setSpotlightedId(null)
      setPinnedId((prev) => (prev === identity ? null : prev))
      safeSendSpotlight({ action: "clear" })
    } else {
      setPinnedId(identity)
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
    setVideoPlaying(false)
    setVideoCurrentTime(0)
    videoStateRef.current = { url: "", playing: false, currentTime: 0, ts: 0 }

    safeSendPpt(wasVideo ? { action: "video_stop" } : { action: "stop" })
    publishStage({ active: false })

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
  }, [presentKind, safeSendPpt, publishStage])

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
      // Turning the mic on from the participant menu answers a pending request
      // too — otherwise its banner and toast stayed on the tutor's screen.
      if (enabled) {
        setSpeakRequests((prev) => prev.filter((r) => r.identity !== identity))
        toast.dismiss(`speak-${identity}`)
      }
      toast.success(enabled ? `${name}'s microphone is on` : `${name}'s microphone is off`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update microphone")
    }
  }, [isTutor, patchParticipantMic, broadcastMicControl, localName])

  // ── Request-to-speak (tutor approves/denies; student asks) ─────────────────
  // Accepting a request IS the permission to speak: it grants the mic. Sending
  // only an acknowledgement left the student muted with no way to talk, so from
  // their side the tutor's "yes" did nothing. `accept-speak` still goes out
  // first so they see the answer even if the mic grant itself then fails.
  const handleAcceptSpeak = useCallback(async (identity: string, name: string) => {
    if (!isTutor) return
    setSpeakRequests((prev) => prev.filter((r) => r.identity !== identity))
    toast.dismiss(`speak-${identity}`)
    broadcastMicControl({ action: "accept-speak", identity, from: localName })
    await handleSetParticipantMic(identity, name, true)
  }, [isTutor, broadcastMicControl, localName, handleSetParticipantMic])

  const handleDenySpeak = useCallback((identity: string, name: string) => {
    if (!isTutor) return
    setSpeakRequests((prev) => prev.filter((r) => r.identity !== identity))
    toast.dismiss(`speak-${identity}`)
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
    // Skip the lobby on the way back in. The tutor is the only source of truth
    // for the stage, so every second they spend sitting on a "Start session"
    // screen is a second the class is looking at nothing.
    try {
      sessionStorage.setItem(`classroom:auto-rejoin:${sessionId}`, String(Date.now()))
    } catch { /* storage may be disabled */ }
    setTimeout(() => window.location.reload(), 800)
  }, [isTutor, connectionState, localName, sendControl, sessionId])

  // Student (and tutor) self-refresh: reload this tab only, then auto-rejoin so
  // the lobby is skipped. Chat history comes back from the API; slides/video
  // are re-synced from the tutor via the existing sync_request flow.
  const handleRefreshSelf = useCallback(() => {
    toast.info("Refreshing your classroom…")
    try {
      sessionStorage.setItem(`classroom:auto-rejoin:${sessionId}`, String(Date.now()))
    } catch { /* storage may be disabled */ }
    setTimeout(() => window.location.reload(), 400)
  }, [sessionId])

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
        // Clear the stored stage too, or a student joining while the whiteboard
        // is up would hydrate the deck the tutor just closed.
        publishStage({ active: false })
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

  // Re-assert the write permission whenever the tutor is (re)connected. A
  // "take back control" sent mid-reconnect is silently dropped by
  // safeSendWhiteboard, which left students able to draw while the tutor's
  // button read "Let them write".
  useEffect(() => {
    if (!isTutor || !whiteboardActive) return
    if (connectionState !== ConnectionState.Connected) return
    safeSendWhiteboard({ action: "student_write", enabled: whiteboardStudentWrite })
  }, [isTutor, whiteboardActive, whiteboardStudentWrite, connectionState, safeSendWhiteboard])

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

  // After a reload restored breakouts, re-announce them once the tutor is back
  // on the data channel. Students kept their own copy through the reload, so
  // this just makes sure it matches — including the case where the timer ran
  // out while the tutor was away and the snapshot now says "not active".
  useEffect(() => {
    if (!isTutor || !restoredBreakoutsRef.current) return
    if (connectionState !== ConnectionState.Connected) return
    const timer = setTimeout(() => {
      restoredBreakoutsRef.current = false
      const snap = breakoutStateRef.current
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
  }, [isTutor, connectionState, safeSendBreakout])

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
      // Joining a group means being *in* the room with them, so drop the
      // full-screen overlays the visit was launched from. Left open they sit on
      // top of the classroom: the teacher loses their own camera and the chat
      // sidebar behind a grid of student tiles, which is exactly what teachers
      // reported. The controls bar reopens either overlay in one click.
      setBreakoutMonitorOpen(false)
      setBreakoutsPanelOpen(false)
      // Below `md` the chat is a full-screen overlay, and opening it here hid
      // the very room the teacher had just walked into.
      if (window.matchMedia("(min-width: 768px)").matches) setChatOpen(true)
      setParticipantsOpen(true)
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

  // When a student is pinned on the tutor's stage, the class-nudge button
  // targets only that student. The tutor is already focused on them, and a
  // room-wide flash would interrupt everyone else. Unpinning restores the
  // whole-class ping. Tutors and the local participant are never a target —
  // those tiles can't be pinned from the UI, but keep the guard anyway.
  const pinnedStudent = useMemo(() => {
    if (!pinnedId || pinnedId === localParticipant.identity) return null
    const p = participants.find((x) => x.identity === pinnedId)
    if (!p || p.metadata === "tutor") return null
    return { identity: p.identity, name: p.name ?? p.identity }
  }, [pinnedId, participants, localParticipant.identity])

  // ── Nudge handler (tutor only) ─────────────────────────────────────────────
  // Sends a short attention signal to the whole class, to a specific breakout
  // group when `groupId` is provided, or to a single student when `identity`
  // is provided. Also echoes locally so the tutor visually confirms the ping
  // went out.
  const handleNudge = useCallback((opts?: {
    identity?: string | null
    name?: string
    groupId?: string | null
    message?: string
  }) => {
    if (!isTutor) return
    if (connectionState !== ConnectionState.Connected) {
      toast.error("Not connected yet — try again in a second.")
      return
    }
    // Send the *base* id so the nudge still lands on a student who reconnected
    // under a fresh identity between the tutor opening the menu and clicking.
    const targetId = opts?.identity ? participantBaseId(opts.identity) : null
    const payload: NudgeAction = {
      action: "nudge",
      from: localName,
      targetId,
      // A single-student nudge is never also a group nudge — receivers give
      // `targetId` precedence, but don't send a contradictory pair.
      groupId: targetId ? null : (opts?.groupId ?? null),
      message: opts?.message ?? null,
    }
    try {
      sendNudge(enc.encode(JSON.stringify(payload)), { reliable: true })
    } catch {
      toast.error("Couldn't send the nudge — please try again.")
      return
    }
    // Local echo so the tutor knows the ping went out. Deliberately the compact
    // "self" variant — the tutor is mid-lesson and shouldn't have their own view
    // blocked by the full-screen alert the students get.
    setActiveNudge({ id: Date.now(), from: localName, message: opts?.message ?? null, self: true })
    if (targetId) {
      toast.success(opts?.name ? `Nudged ${opts.name}` : "Nudge sent", {
        description: "Only they can see it.",
      })
    } else if (opts?.groupId) {
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

  // Every teacher in the room, not just the first: with a co-tutor present,
  // pairing the stage with "the tutor" must not put the same person on it twice.
  const tutorIdentities = useMemo(
    () => new Set(participants.filter((p) => p.metadata === "tutor").map((p) => p.identity)),
    [participants]
  )

  // Is there a teacher camera to pair with at all? With every teacher camera
  // off, a second panel would only hold a placeholder — better to give the
  // whole stage to the person who is actually signing.
  const tutorCameraLive = useMemo(
    () => allCameraTracks.some((t) => t.participant.metadata === "tutor"),
    [allCameraTracks]
  )

  const ownBreakoutGroup = useMemo(
    () => breakoutGroups.find((g) => g.memberIds.includes(localBaseId)) ?? null,
    [breakoutGroups, localBaseId]
  )

  // Who chat reaches during breakouts, mirroring who can hear whom:
  //   - a student in a group → that group, plus the teachers;
  //   - a student left unassigned → the others left in the main room, plus the
  //     teachers;
  //   - a teacher visiting a group → that group;
  //   - a teacher not visiting → everyone, so announcements still land.
  // Teachers receive every group's messages so they can follow all of them.
  const chatAudience = useMemo<ChatAudience | null>(() => {
    if (!breakoutsActive) return null
    const teacherIds = participants.filter((p) => p.metadata === "tutor").map((p) => p.identity)
    const withTeachers = (ids: string[]) =>
      [...new Set([...ids, ...teacherIds])].filter((id) => id !== localParticipant.identity)

    if (isTutor) {
      const visiting = visitingGroupId ? breakoutGroups.find((g) => g.id === visitingGroupId) : null
      if (!visiting) return null
      return { groupId: visiting.id, groupName: visiting.name, identities: withTeachers(liveIdentitiesFor(visiting.memberIds)) }
    }
    if (ownBreakoutGroup) {
      return {
        groupId: ownBreakoutGroup.id,
        groupName: ownBreakoutGroup.name,
        identities: withTeachers(liveIdentitiesFor(ownBreakoutGroup.memberIds)),
      }
    }
    const assigned = new Set(breakoutGroups.flatMap((g) => g.memberIds))
    const mainRoom = participants
      .filter((p) => p.metadata !== "tutor" && !assigned.has(participantBaseId(p.identity)))
      .map((p) => p.identity)
    return {
      // Per breakout round, so one round's main-room chat doesn't follow a
      // student who is placed in a group the next time.
      groupId: `main-${breakoutStartedAt ?? 0}`,
      groupName: "Main room",
      identities: withTeachers(mainRoom),
    }
  }, [breakoutsActive, participants, isTutor, visitingGroupId, breakoutGroups, ownBreakoutGroup, breakoutStartedAt, liveIdentitiesFor, localParticipant.identity])

  // Captions follow the same boundary as chat and audio: during breakouts a
  // student sees their own group's speech (and the teachers'), not every other
  // pair's. Teachers see everyone, so they can tell who is talking instead of
  // signing.
  const captionSpeakers = useMemo<ReadonlySet<string> | null>(() => {
    if (isTutor || !chatAudience) return null
    return new Set([...chatAudience.identities, localParticipant.identity])
  }, [isTutor, chatAudience, localParticipant.identity])

  useEffect(() => {
    chatAudienceRef.current = chatAudience
    // A student placed in a group they haven't been in before: remember it, and
    // fetch history again so a reload mid-breakout gets the group's earlier
    // messages back (the first fetch ran before we knew the group).
    if (isTutor || !chatAudience || chatGroupIdsRef.current.has(chatAudience.groupId)) return
    chatGroupIdsRef.current.add(chatAudience.groupId)
    try {
      sessionStorage.setItem(chatGroupsStorageKey, JSON.stringify([...chatGroupIdsRef.current]))
    } catch { /* storage unavailable */ }
    void hydrateChat()
  }, [chatAudience, isTutor, chatGroupsStorageKey, hydrateChat])

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

  // The group the tutor is sitting in right now, if any.
  const tutorVisitingGroup = useMemo(
    () => (isTutor && breakoutsActive && visitingGroupId
      ? breakoutGroups.find((g) => g.id === visitingGroupId) ?? null
      : null),
    [isTutor, breakoutsActive, visitingGroupId, breakoutGroups],
  )

  const visibleIdentities = useMemo<Set<string> | null>(() => {
    if (!breakoutsActive) return null
    if (isTutor) {
      // Monitoring from the main room: the whole class, so every group can be
      // read at a glance.
      if (!tutorVisitingGroup) return null
      // Inside a group: the people in that group, the same room the tutor now
      // hears. Showing the whole class here squeezed the visited group into a
      // handful of unreadable thumbnails among everyone else — the tutor was
      // "in the room" and couldn't see who with.
      const visible = new Set(liveIdentitiesFor(tutorVisitingGroup.memberIds))
      tutorIdentities.forEach((id) => visible.add(id))
      return visible
    }
    const visible = new Set<string>()
    if (ownBreakoutGroup) liveIdentitiesFor(ownBreakoutGroup.memberIds).forEach((id) => visible.add(id))
    // Same rule as audio: the tutor appears only once they join this group.
    if (tutorIdentity && tutorPresentForMe) visible.add(tutorIdentity)
    return visible
  }, [breakoutsActive, isTutor, tutorVisitingGroup, tutorIdentities, ownBreakoutGroup, tutorIdentity, tutorPresentForMe, liveIdentitiesFor])

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

  // During breakouts, students see a group-mate (or visiting tutor) on the main
  // stage, and a tutor visiting a group sees one of its members — paired with
  // their own camera, so it is the same picture the group has of them.
  const breakoutStageId = useMemo(() => {
    if (tutorVisitingGroup) {
      return liveIdentitiesFor(tutorVisitingGroup.memberIds)
        .find((id) => id !== localParticipant.identity && !tutorIdentities.has(id)) ?? null
    }
    if (isTutor || !breakoutsActive || !ownBreakoutGroup) return null
    if (visitingGroupId === ownBreakoutGroup.id && tutorIdentity) return tutorIdentity
    return liveIdentitiesFor(ownBreakoutGroup.memberIds).find((id) => id !== localParticipant.identity) ?? null
  }, [
    tutorVisitingGroup,
    tutorIdentities,
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

  // Should the person on the stage share it with the teacher's camera?
  //
  // Selecting a student to sign used to hand them the camera slot outright and
  // take the teacher off screen, which leaves the class watching one side of a
  // signed exchange. So whenever the stage camera belongs to somebody who isn't
  // a teacher, the teacher keeps a panel beside them — for everyone in the
  // room, not just for the teacher's own client.
  //
  // Skipped when there is no teacher camera to show, and during breakouts when
  // this client isn't currently allowed to see the teacher at all: the second
  // panel would be a placeholder taking half the stage off a live signer.
  const pairWithTutor = (id: string | null): id is string =>
    !!id && !tutorIdentities.has(id) && tutorCameraVisible && tutorCameraLive

  /**
   * The stage tile for whoever is pinned (or, in breakouts, the group-mate a
   * student is put with).
   *
   * `fit` is how it fills its box when it has the box to itself; see the prop's
   * own note. Sharing the box with the teacher always fits the whole picture —
   * half a box is never the shape of a camera, and cropping to fill it takes a
   * signer's hands off the sides. `paired` also hands fullscreen to the pair
   * (going fullscreen on half a conversation drops the other half) and drops
   * the "back to tutor" wording, which promises a view the viewer already has.
   */
  const stageCameraTile = (
    id: string,
    { fit, paired }: { fit: "cover" | "contain"; paired: boolean },
  ) => (
    <PinnedVideoArea
      fit={paired ? "contain" : fit}
      identity={id}
      localIdentity={localParticipant.identity}
      containerRef={paired ? undefined : videoContainerRef}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      onUnpin={() => setPinnedId(null)}
      unpinLabel={paired ? "Close" : undefined}
      unpinTitle={paired ? "Close — give the whole stage back to the teacher" : undefined}
      showSpotlight={isTutor && id !== localParticipant.identity}
      spotlightActive={spotlightedId === id}
      onToggleSpotlight={handleToggleSpotlight}
      handRaised={raisedHandIds.has(id)}
      onLowerHand={isTutor ? handleLowerHand : undefined}
    />
  )

  // Camera panel shown beside the whiteboard, the slides, or a shared screen.
  // Normally the tutor, so students can read BSL alongside the material — and,
  // once a student is selected to sign, the tutor *and* that student. During
  // breakouts a student sees their own group here instead — the lesson material
  // stays on screen and they practise it with each other, which is the whole
  // point of sending them into a group. `breakoutStageId` already resolves
  // to the visiting tutor when the tutor has joined that group.
  const splitStageId = pinnedId ?? breakoutStageId
  const splitCameraPanel = pairWithTutor(splitStageId) ? (
    <StagePair
      containerRef={videoContainerRef}
      first={<TutorCameraInset />}
      second={stageCameraTile(splitStageId, { fit: "contain", paired: true })}
    />
  ) : splitStageId ? (
    // Half a split stage, beside slides or a whiteboard: fit the whole picture
    // rather than cropping it to fill. A cropped signer loses their hands off
    // the sides, and a filled camera next to a letterboxed slide is the
    // mismatch teachers reported.
    stageCameraTile(splitStageId, { fit: "contain", paired: false })
  ) : (
    <TutorCameraInset
      hidden={!tutorCameraVisible}
      breakoutGroupName={!isTutor && breakoutsActive ? ownBreakoutGroup?.name ?? null : null}
    />
  )

  // Whether the split camera panel is already showing this client's own camera.
  // It shows the tutor's camera (their own, for a teacher) with nothing pinned,
  // and still shows it beside a pinned student. What takes it away is pinning
  // *a teacher* — including yourself, since a pinned tile prefers the screen
  // share over the camera.
  const insetTutorCameraIdentity = useMemo(() => {
    const tutorCams = allCameraTracks.filter((t) => t.participant.metadata === "tutor")
    const own = tutorCams.find((t) => t.participant.identity === localParticipant.identity)
    return (own ?? tutorCams[0])?.participant.identity ?? null
  }, [allCameraTracks, localParticipant.identity])

  // A pinned tile used to take the panel away outright; paired with the teacher
  // it no longer does, so a sharing teacher already has their own feed on stage.
  const splitPanelShowsMyCamera =
    (!splitStageId || pairWithTutor(splitStageId)) &&
    tutorCameraVisible &&
    insetTutorCameraIdentity === localParticipant.identity

  // Self-view for whoever is sharing their screen, shown only when their camera
  // isn't already on the stage. Without it a teacher who has pinned a student
  // has no view of themselves for as long as the share runs.
  const selfViewTrack =
    localScreenSharing && localCameraRef && !splitPanelShowsMyCamera ? localCameraRef : null

  // A student looking at the "preparing content…" placeholder has nothing to
  // widen, so wide mode stands down until the share is actually visible.
  const screenShareHidden  = !isTutor && screenPrivate
  const screenWideActive   = screenWide && !screenShareHidden

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      // Marked so NudgeOverlay can shake the whole room without dragging its own
      // fixed-position alert along with it.
      data-classroom-shell
      className="fixed inset-0 bg-zinc-950 text-white flex flex-col overflow-hidden z-50"
    >
      <AudioRenderer audibleIdentities={audibleIdentities} />

      {/* Says out loud what a frozen picture means. Nothing is rendered while
          the connection is healthy. */}
      <ConnectionBanner />
      <NoiseFilter />

      {/* Brand watermark — visible to all participants. Top-left so it doesn't
          collide with the controls bar at the bottom. */}
      <LogoWatermark className="top-3 left-3" size={52} />

      {/* ── Attention nudge overlay (everyone, triggered by tutor) ── */}
      {activeNudge && (
        <NudgeOverlay
          key={activeNudge.id}
          from={activeNudge.from}
          message={activeNudge.message}
          self={activeNudge.self}
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
      {isTutor && isOwner && inviteCoTutorOpen && (
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
          initialSelected={pickerData.selectedPages}
          onConfirm={handleSlidesPicked}
          // Back to the library, not back to an empty stage. Cancelling here
          // almost always means "wrong deck", and dropping the tutor into the
          // room made them reopen the panel and start the search again.
          onCancel={() => { setPickerData(null); setShowUpload(true) }}
        />
      )}

      {/* ── Top bar ── */}
      {/* Left padding clears the 44px logo watermark pinned at top-3 left-3 —
          without it the badge sat on top of the live dot and title. */}
      <header className="h-11 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between pl-16 pr-2 sm:pr-4 shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <Radio className="size-3.5 text-rose-500 animate-pulse shrink-0" />
          <span className="font-bold text-sm truncate max-w-[40vw] sm:max-w-xs">{sessionTitle}</span>
          {isTutor && recordingActive && (
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
          {!isTutor && roomIsRecording && (
            <span
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/55 border border-white/15 text-[10px] font-semibold text-white shrink-0"
              title="This lesson is being recorded"
              aria-live="polite"
            >
              <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="hidden sm:inline">Recording</span>
              <span className="sm:hidden">REC</span>
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
          {/* The student's raise-hand button lives on their own tile in the
              class panel (top-right). It only comes back up here while that
              panel is hidden, so it is never out of reach. */}
          {!isTutor && !classPanelOpen && (
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
              <Hand className="size-3.5 shrink-0" />
              <span className="hidden sm:inline">{handRaised ? "Lower Hand" : "Raise Hand"}</span>
            </button>
          )}
          {isTutor && (
            <div className="relative">
              <button
                onClick={() => setRaisedHandsOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors",
                  raisedHands.length > 0
                    ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                )}
                aria-label="Raised hands"
              >
                <Hand className="size-3" />
                <span className="hidden sm:inline">Raised Hands</span>
                {raisedHands.length > 0 && (
                  <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-[10px] font-bold text-zinc-950 flex items-center justify-center">
                    {raisedHands.length}
                  </span>
                )}
              </button>
              {raisedHandsOpen && (
                <RaisedHandsPopover
                  raisedHands={raisedHands}
                  onLowerHand={handleLowerHand}
                  onLowerAllHands={handleLowerAllHands}
                  onClose={() => setRaisedHandsOpen(false)}
                />
              )}
            </div>
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
          {/* Chat toggle — only while chat is closed. Up here rather than
              floating over the stage's bottom corner, where it was easy to miss
              and sat on the tiles and captions. */}
          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              className={cn(
                "relative flex items-center gap-1.5 px-2.5 sm:px-3 h-8 rounded-xl bg-primary text-white text-xs font-medium shadow-lg active:scale-95 transition-transform shrink-0",
                // Ring it while breakouts run so it reads as "your group chat is here".
                breakoutsActive && "ring-2 ring-white/70",
                chatFlash && "animate-pulse"
              )}
              title="Open chat"
              aria-label={chatUnread > 0 ? `Open chat, ${chatUnread} new` : "Open chat"}
            >
              <MessageSquare className="size-3.5" />
              <span className="hidden sm:inline">Chat</span>
              {chatUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-[11px] font-bold text-white ring-2 ring-zinc-900 flex items-center justify-center">
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}
            </button>
          )}
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

      {/* ── Teacher breakout banner ──
          The teacher stays in the ordinary classroom while visiting a group
          (their own camera on stage, chat to the right), so this is the only
          thing that tells them where they are — and gets them back out again
          without reopening the monitor. */}
      {isTutor && breakoutsActive && visitingGroupId && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-[90%] flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/80 border border-emerald-500/40 backdrop-blur-sm shadow-lg">
          <Users2 className="size-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold text-white truncate">
            You&apos;re in {breakoutGroups.find((g) => g.id === visitingGroupId)?.name ?? "a group"}
          </span>
          {breakoutEndsAt && <BreakoutCountdown endsAt={breakoutEndsAt} variant="compact" />}
          <button
            onClick={() => handleVisitBreakout(null)}
            className="text-[11px] font-semibold text-emerald-200 hover:text-white bg-emerald-500/25 hover:bg-emerald-500/50 rounded-full px-2.5 py-0.5 transition-colors"
            title="Leave this group and go back to the main room"
          >
            Leave group
          </button>
        </div>
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
                onClick={() => { void handleAcceptSpeak(r.identity, r.name) }}
                className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-200 hover:text-white bg-emerald-500/30 hover:bg-emerald-500/60 rounded-full px-1.5 py-0.5 transition-colors"
                title={`Accept ${r.name}'s request and turn their microphone on`}
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

          {/* Stage on top, class banded beneath it. */}
          <div className="flex flex-1 flex-col overflow-hidden min-h-0 min-w-0">

          {/* Stage row: slides / video / whiteboard. The camera and the content sit
              side by side on a wide stage — signer on the LEFT, the Deaf-culture
              convention — and stacked with the signer on top when the stage is
              taller than it is wide. Which of those applies is measured from
              this box, not from the viewport, so the two panels always come out
              the same shape as each other. See `useStageSplit`. */}
          <div
            ref={stageRowRef}
            className={cn(
              "flex flex-1 overflow-hidden min-h-0 min-w-0 relative",
              splitDirection,
              galleryView && "hidden",
            )}
          >

          {whiteboardActive ? (
            // ── Whiteboard mode: same deaf-first layout as PPT. Tutor camera on
            // the LEFT so signing stays visible while everyone draws on the RIGHT.
            //
            // Minimizing (the "–" button) is local-only: the board stays mounted
            // and fully live (still receiving/broadcasting diffs) so nothing is
            // lost, it's just given zero space and the camera takes the stage
            // back until this client asks for it again via the restore chip.
            <>
              <div
                className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden bg-zinc-900 relative"
                style={whiteboardMinimized ? { flex: "1 1 100%" } : cameraSplit.camera}
              >
                {splitCameraPanel}
              </div>

              <div
                className={cn(
                  "flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden relative border-zinc-800",
                  splitDivider,
                  whiteboardMinimized && "hidden",
                )}
                style={cameraSplit.content}
              >
                <TldrawBoard
                  isTutor={isTutor}
                  canWrite={canWriteWhiteboard}
                  studentsCanWrite={whiteboardStudentWrite}
                  onToggleStudentWrite={handleToggleStudentWrite}
                  onStop={handleToggleWhiteboard}
                  onMinimize={() => setWhiteboardMinimized(true)}
                  sessionId={sessionId}
                  localIdentity={localParticipant.identity}
                  localName={localName}
                  followIdentity={isTutor ? null : tutorIdentity}
                  send={handleWhiteboardSend}
                  registerApi={registerWhiteboardApi}
                  onShareToChat={(attachment) =>
                    handleSend("🖼️ Whiteboard snapshot", "text", attachment)
                  }
                />
              </div>

              {whiteboardMinimized && (
                <button
                  type="button"
                  onClick={() => setWhiteboardMinimized(false)}
                  className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5 px-3 h-9 rounded-full bg-zinc-800/95 text-white text-xs font-medium shadow-lg ring-1 ring-zinc-700 hover:bg-zinc-700 transition-colors"
                  title="Show the whiteboard"
                >
                  <PencilLine className="size-3.5 text-amber-400" />
                  Whiteboard hidden
                  <Maximize2 className="size-3.5" />
                </button>
              )}
            </>

          ) : pptActive && pptUrl ? (
            // ── PPT mode: Deaf-culture convention — signer on the LEFT, content on the RIGHT.
            <>
              {/* Camera panel — LEFT. Pinned student if set, otherwise tutor for BSL */}
              <div
                className="flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden bg-zinc-900 relative"
                style={cameraSplit.camera}
              >
                {splitCameraPanel}
              </div>

              {/* Presentation column — RIGHT. Slides or video, decided by `presentKind`.
                  Always a row, so the tutor's thumbnail tray sits beside the
                  slide whichever way the stage is split. As a direct child of a
                  stacked (column) stage the tray took the full height and
                  squeezed the tutor's own slide down to a 1px strip. */}
              <div
                className={cn(
                  "flex-1 min-w-0 min-h-0 md:basis-0 overflow-hidden flex border-zinc-800",
                  splitDivider,
                )}
                style={cameraSplit.content}
              >
              <div
                ref={slideAreaRef}
                className="flex-1 min-w-0 min-h-0 overflow-hidden relative"
                onPointerMove={handleSlidePointerMove}
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
                    onContentElement={handleSlideContentElement}
                  />
                ) : (
                  <PptSlideViewer
                    fileUrl={pptUrl}
                    currentPage={pptCurrentPage}
                    onTotalPages={(total) => {
                      if (total !== pptTotalPages) setPptTotalPages(total)
                    }}
                    onContentElement={handleSlideContentElement}
                  />
                )}

                {/* Hand pointer overlay — shown to everyone while the tutor is
                    pointing. Placed against the drawn slide, not this panel, so
                    it lands on the same thing for everyone regardless of how
                    their own layout letterboxes the slide. See `pointerStyle`. */}
                {livePointer && pointerStyle && (
                  <div className="absolute pointer-events-none z-40" style={pointerStyle} aria-hidden>
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
              </div>
            </>

          ) : screenSharing ? (
            // ── Screen share mode: camera LEFT so the tutor can keep signing,
            // screen content RIGHT, and the content given the larger share of a
            // left/right stage (see `screenSplit`). Students see a placeholder
            // when private. Wide mode goes further still — the whole stage to
            // the share, signer down to a corner inset — for anyone who wants it.
            <>
              {!screenWideActive && (
                <div
                  className="min-w-0 min-h-0 overflow-hidden bg-zinc-900 relative"
                  style={screenSplit.camera}
                >
                  {splitCameraPanel}
                </div>
              )}

              <div
                className={cn(
                  "min-w-0 min-h-0 overflow-hidden relative bg-zinc-950",
                  !screenWideActive && cn("border-zinc-800", splitDivider),
                )}
                style={screenWideActive ? { flex: "1 1 0%" } : screenSplit.content}
              >
                {screenShareHidden ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
                    <Monitor className="size-12 opacity-20" />
                    <span className="text-sm opacity-60">Tutor is preparing content…</span>
                  </div>
                ) : tutorScreenTrack ? (
                  <ScreenShareView
                    trackRef={tutorScreenTrack}
                    wide={screenWide}
                    onToggleWide={handleToggleScreenWide}
                  />
                ) : null}

                {/* Wide mode never drops the signer — BSL has to stay on screen. */}
                {screenWideActive && (
                  <div className="absolute top-3 left-3 z-30 w-40 sm:w-52 md:w-64 aspect-video rounded-xl overflow-hidden ring-2 ring-zinc-600 shadow-2xl bg-zinc-900">
                    <TutorCameraInset
                      hidden={!tutorCameraVisible}
                      breakoutGroupName={!isTutor && breakoutsActive ? ownBreakoutGroup?.name ?? null : null}
                    />
                  </div>
                )}

                {selfViewTrack && <SelfViewInset trackRef={selfViewTrack} />}
              </div>
            </>

          ) : (
            // ── Normal mode: tutor video, pinned student, or (during breakouts)
            // a group-mate on the main stage so students can sign with each other.
            <div className="flex-1 flex flex-col overflow-hidden relative">
              <div className="flex-1 overflow-hidden">
                {(() => {
                  const mainStageId = pinnedId ?? breakoutStageId
                  // A student selected to sign shares the stage with the teacher
                  // rather than replacing them, so the class watches both halves
                  // of the exchange. See `pairWithTutor`.
                  if (pairWithTutor(mainStageId)) {
                    return (
                      <StagePair
                        containerRef={videoContainerRef}
                        first={<TutorCameraInset />}
                        second={stageCameraTile(mainStageId, { fit: "contain", paired: true })}
                      />
                    )
                  }
                  if (mainStageId) {
                    return stageCameraTile(mainStageId, { fit: "cover", paired: false })
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
                    // Own camera on the stage, with the switch built in — a
                    // student who rejoins mid-breakout shouldn't have to hunt
                    // down their own tile to get back on camera.
                    return <BreakoutSelfStage groupName={ownBreakoutGroup.name} />
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

          {!galleryView && <CaptionsOverlay speakers={captionSpeakers} />}
          </div>

          {/* The class. A band beneath the stage.

              Putting a deck, a video or the whiteboard on stage does NOT close
              this panel. It used to — the extra pixels went to the slide — but
              in a signing classroom the students vanishing the moment slides
              come up is the wrong trade: the teacher loses the faces they read
              for comprehension, and students lose each other. The panel is the
              tutor's to collapse (the chevron) or resize (`tileSize`), and
              whatever they chose survives the presentation starting and
              stopping. Only phones still start it collapsed, and only breakouts
              force it back open. */}
          <div
            className={cn(
              "bg-zinc-900 overflow-hidden border-zinc-800",
              // In gallery the band is the stage: it takes all the height, and
              // the captions come with it.
              galleryView
                ? "flex-1 min-h-0 relative"
                : "shrink-0 grow-0 border-t transition-[height] duration-200",
            )}
            style={galleryView ? undefined : { height: participantsOpen ? CLASS_BAND_PX[tileSize] : 36 }}
          >
            <ParticipantsPanel
              pinnedId={pinnedId}
              onPin={(identity) => {
                setPinnedId(identity)
                // Pinning puts someone on the stage, so show the stage.
                if (identity && galleryView) handleSetGalleryView(false)
              }}
              collapsed={!classPanelOpen}
              onToggleCollapse={() => setParticipantsOpen((v) => !v)}
              view={galleryView ? "gallery" : "spotlight"}
              // The tutor's to switch; the class follows it.
              onToggleView={isTutor ? () => handleSetGalleryView(!galleryView) : undefined}
              isLocalTutor={isTutor}
              spotlightedId={spotlightedId}
              onToggleSpotlight={handleToggleSpotlightFor}
              onPopOut={handlePopOut}
              poppedOutIds={poppedOutIds}
              onRemoveParticipant={handleRequestRemove}
              onToggleParticipantMic={isTutor ? handleSetParticipantMic : undefined}
              onNudgeParticipant={
                isTutor
                  ? (identity, name) => handleNudge({ identity, name })
                  : undefined
              }
              raisedHandIds={raisedHandIds}
              onLowerHand={isTutor ? handleLowerHand : undefined}
              onToggleOwnHand={isTutor ? undefined : handleToggleHand}
              visibleIdentities={visibleIdentities}
              groupLabels={groupLabels}
              tileSize={tileSize}
              onTileSizeChange={handleTileSizeChange}
              orientation="bottom"
              classOrder={classOrder}
              onReorderClass={isTutor && !tutorVisitingGroup ? handleReorderClass : undefined}
            />
            {galleryView && <CaptionsOverlay speakers={captionSpeakers} />}
          </div>
          </div>
        </div>

        {/* Chat column — full-height sidebar on desktop; mobile full-screen overlay. */}
        <div className={cn(
          "flex flex-col overflow-hidden bg-zinc-900 transition-all duration-200 border-zinc-800 min-w-0",
          "md:relative md:h-full md:shrink-0 md:border-l md:flex",
          // Closed, the column goes entirely so the gallery gets its width;
          // the floating button below brings it back.
          chatOpen
            ? "md:w-72 max-md:absolute max-md:inset-0 max-md:z-30 max-md:w-full max-md:shadow-2xl"
            : "hidden md:hidden",
        )}>
          <ChatPanel
            messages={messages}
            audienceLabel={
              !breakoutsActive ? null
                : chatAudience ? chatAudience.groupName
                : "everyone (all groups)"
            }
            showGroupLabels={isTutor}
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

      {isTutor && studentsPip.pipWindow && (
        <StudentsPipPortal
          pipWindow={studentsPip.pipWindow}
          localIdentity={localParticipant.identity}
          raisedHandIds={raisedHandIds}
          onLowerHand={handleLowerHand}
        />
      )}

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
          onRefreshSelf={handleRefreshSelf}
          canInviteCoTutor={isOwner}
          onInviteCoTutor={() => setInviteCoTutorOpen(true)}
          onRequestToSpeak={handleRequestToSpeak}
          pptActive={pptActive}
          presentKind={presentKind}
          presentationIdx={presentationIdx}
          selectedCount={selectedSlides.length}
          hasNextSlide={hasNextSlide}
          hasPrevSlide={hasPrevSlide}
          onShowUpload={() => setShowUpload(true)}
          preparedKind={preparedDeck?.slides.kind ?? null}
          preparedName={preparedDeck?.slides.fileName ?? null}
          preparedCount={
            preparedDeck?.slides.kind === "slides"
              ? (preparedDeck.selectedPages.length || preparedDeck.slides.total)
              : 0
          }
          onPresentPrepared={handlePresentPrepared}
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
          onNudgeClass={() =>
            pinnedStudent
              ? handleNudge({ identity: pinnedStudent.identity, name: pinnedStudent.name })
              : handleNudge()
          }
          nudgeTargetName={pinnedStudent?.name ?? null}
          screenSharing={screenSharing}
          screenPrivate={screenPrivate}
          onToggleScreenPrivacy={handleToggleScreenPrivacy}
          studentsPipSupported={studentsPip.supported}
          studentsPipOpen={!!studentsPip.pipWindow}
          onToggleStudentsPip={studentsPip.toggle}
          blurEnabled={blurEnabled}
          blurBusy={blurBusy}
          onToggleBlur={handleToggleBlur}
          recordingStarted={recordingActive}
          recordingPaused={recordingPaused}
          recordingBusy={recordingBusy}
          onToggleRecording={handleToggleRecording}
        />
      </div>
    </div>
  )
}
