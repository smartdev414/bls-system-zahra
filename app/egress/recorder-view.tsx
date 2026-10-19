"use client"

// The class recording
// ───────────────────
// This page is loaded by LiveKit's headless-Chrome egress worker, NOT by a
// regular user. The worker navigates to:
//
//   {customBaseUrl}?url={liveKitWsUrl}&token={egressJoinToken}&layout={name}
//
// where customBaseUrl is /egress/<recorder pass> (lib/recording.ts). Whatever
// this page shows and plays is what ends up in the MP4. It must log the literal
// `START_RECORDING` once ready (and `END_RECORDING` on teardown) — the worker
// watches the console for exactly those strings. See
// https://docs.livekit.io/home/egress/custom-template/
//
// What is recorded — and what is not (agreed with the school):
//   • The tutor and any co-teacher: their cameras and their voices.
//   • What they present: screen share, slides, a shared video, the whiteboard,
//     and the tutor's hand pointer on the slides or video, so a viewer can
//     follow what is being pointed at.
//   • Every student's FACE, next to the tutor, for the whole class: a viewer
//     sees the class watching the tutor sign, who was asked and how they
//     answered. The school asked for this (2026-10-19) and gets the students'
//     agreement before starting a recording.
//   • NOT a student's voice or screen, and NO names anywhere; captions (which
//     can carry what a student said) are off.
//   • NOT breakout rooms: the tutor's tab pauses the recording while they run,
//     and should anything still be recording, this page shows a plain card
//     with no sound instead.
//
// "Tutor" is the `tutor` metadata the token route stamps on a tutor's or a
// co-teacher's join token — set by the server, not changeable by a student.
//
// IMPORTANT: this route is PUBLIC. Joining the room needs the egress JWT in the
// URL; reading the class's slides and board needs the recorder pass.

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  LiveKitRoom,
  AudioTrack,
  VideoTrack,
  useConnectionState,
  useDataChannel,
  useRemoteParticipants,
  useTracks,
  type TrackReference,
} from "@livekit/components-react"
import { ConnectionState, RemoteTrackPublication, Track, type RemoteParticipant } from "livekit-client"
import { Pointer } from "lucide-react"
import { LogoWatermark } from "@/components/layout/logo"
import { PptSlideViewer } from "@/components/classroom/PptSlideViewer"
import { VideoPlayer } from "@/components/classroom/room/VideoPlayer"
import {
  BREAKOUT_TOPIC, POINTER_SMOOTHING_MS, POINTER_STALE_MS, POINTER_TOPIC, PPT_TOPIC, RECORDER_TOPIC,
  SPOTLIGHT_TOPIC, VIEW_TOPIC, WHITEBOARD_TOPIC,
} from "@/components/classroom/room/constants"
import type {
  BreakoutAction, PointerAction, PptAction, RecorderStateAction, SpotlightAction, ViewAction,
  WhiteboardAction, WhiteboardSnapshot,
} from "@/components/classroom/room/types"
import { useSlideContentBox } from "@/components/classroom/room/useSlideContentBox"
import { cn } from "@/lib/utils"
import type { WhiteboardApi } from "@/components/classroom/room/TldrawBoard"

const TldrawBoard = dynamic(() => import("@/components/classroom/room/TldrawBoard"), { ssr: false })

const dec = new TextDecoder()
const isTutor = (p: { metadata?: string } | undefined | null) => p?.metadata === "tutor"

/** Sources the recording takes from a tutor. From a student: the camera alone. */
const TUTOR_SOURCES = new Set([
  Track.Source.Camera,
  Track.Source.Microphone,
  Track.Source.ScreenShare,
  Track.Source.ScreenShareAudio,
])

type Stage = {
  kind: "slides" | "video" | null
  url: string | null
  page: number
  playing: boolean
  currentTime: number
  asOf: number
}
const EMPTY_STAGE: Stage = { kind: null, url: null, page: 1, playing: false, currentTime: 0, asOf: 0 }

function readQueryParams() {
  const params = new URLSearchParams(window.location.search)
  return { url: params.get("url"), token: params.get("token") }
}

export function RecorderView({ pass }: { pass: string | null }) {
  const [ready, setReady] = useState(false)
  const [conn, setConn] = useState<{ url: string | null; token: string | null }>({ url: null, token: null })
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Swap the pass for the cookie before joining, so the first slide can load.
  useEffect(() => {
    const id = setTimeout(async () => {
      setConn(readQueryParams())
      if (pass) {
        try {
          const res = await fetch("/api/egress/pass", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pass }),
          })
          if (res.ok) setSessionId(((await res.json()) as { sessionId: string }).sessionId)
        } catch { /* record cameras and screen share without the stage */ }
      }
      setReady(true)
    }, 0)
    return () => clearTimeout(id)
  }, [pass])

  if (!ready) return null

  // Opened directly (no token): a benign placeholder.
  if (!conn.url || !conn.token) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center text-white/40 text-sm font-mono">
        egress template — no session
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <LiveKitRoom
        serverUrl={conn.url}
        token={conn.token}
        connect
        // A viewer only — and one that subscribes to nothing by itself, so a
        // student's camera or microphone never reaches this page.
        video={false}
        audio={false}
        options={{ adaptiveStream: false }}
        connectOptions={{ autoSubscribe: false }}
      >
        <RecordingStage sessionId={sessionId} />
        <LogoWatermark className="top-4 left-4" size={72} />
        <RoomReadyBridge />
      </LiveKitRoom>
    </div>
  )
}

/** How the tutor is showing the class: gallery, and the student they spotlight (shown first). */
type Shown = { gallery: boolean; spotlight: string | null }

/**
 * Subscribes to the tutors' camera, voice and screen, and to the students'
 * cameras — nothing else of a student's, ever. During breakouts (`faces`
 * false), not even their cameras.
 */
function Subscriptions({ faces }: { faces: boolean }) {
  const participants = useRemoteParticipants()
  useEffect(() => {
    for (const p of participants as RemoteParticipant[]) {
      for (const pub of p.trackPublications.values()) {
        if (!(pub instanceof RemoteTrackPublication)) continue
        const wanted = isTutor(p)
          ? TUTOR_SOURCES.has(pub.source)
          : faces && pub.source === Track.Source.Camera
        if (pub.isSubscribed !== wanted) pub.setSubscribed(wanted)
      }
    }
  })
  return null
}

function RecordingStage({ sessionId }: { sessionId: string | null }) {
  const [stage, setStage] = useState<Stage>(EMPTY_STAGE)
  const [whiteboardActive, setWhiteboardActive] = useState(false)
  const [breakouts, setBreakouts] = useState(false)
  const [shown, setShown] = useState<Shown>({ gallery: false, spotlight: null })
  const lastLiveStage = useRef(0)
  const wbApi = useRef<WhiteboardApi | null>(null)
  const wbPending = useRef<{ snapshot: WhiteboardSnapshot | null; changes: unknown[]; presence: unknown }>({
    snapshot: null, changes: [], presence: null,
  })
  // The tutor's hand pointer, placed against the drawn slide (or video) as in
  // the classroom, so it lands on the same thing in the recording.
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const pointerSeq = useRef(-1)
  const pointerAt = useRef(0)
  const pointerHide = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stageAreaRef = useRef<HTMLDivElement>(null)
  const [stageContentEl, setStageContentEl] = useState<HTMLElement | null>(null)
  const stageContentBox = useSlideContentBox(stageAreaRef, stageContentEl)

  // Only tracks we subscribed to are listed. Tutors first, as in the room, then
  // the student the tutor is spotlighting.
  const rank = (p: { identity: string; metadata?: string }) =>
    isTutor(p) ? 2 : shown.spotlight === p.identity ? 1 : 0
  const cameras = (useTracks([Track.Source.Camera], { onlySubscribed: true }) as TrackReference[])
    .sort((a, b) => rank(b.participant) - rank(a.participant))
  const screens = useTracks([Track.Source.ScreenShare], { onlySubscribed: true })
    .filter((t) => isTutor(t.participant)) as TrackReference[]
  const voices = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio], { onlySubscribed: true })
    .filter((t) => isTutor(t.participant)) as TrackReference[]
  const tutorIdentity = cameras.find((t) => isTutor(t.participant))?.participant.identity ?? null

  // ── What's on the stage, from the server, for a recording that starts (or
  // resumes) mid-presentation. Live messages below take over once they flow.
  useEffect(() => {
    if (!sessionId) return
    const load = async () => {
      if (Date.now() - lastLiveStage.current < 20_000) return
      try {
        const res = await fetch(`/api/sessions/${sessionId}/live-state`, { cache: "no-store" })
        if (!res.ok) return
        const { state } = (await res.json()) as {
          state: { active: boolean; kind: "slides" | "video" | null; url: string | null; page: number; videoPlaying: boolean; videoTime: number; updatedAt: number } | null
        }
        if (Date.now() - lastLiveStage.current < 20_000) return
        setStage(state?.active && state.url
          ? { kind: state.kind, url: state.url, page: state.page, playing: state.videoPlaying, currentTime: state.videoTime, asOf: state.updatedAt }
          : EMPTY_STAGE)
      } catch { /* try again on the next tick */ }
    }
    void load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [sessionId])

  // The board's last saved state, so it doesn't start blank.
  useEffect(() => {
    if (!sessionId) return
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/whiteboard`, { cache: "no-store" })
        if (!res.ok) return
        const { snapshot } = (await res.json()) as { snapshot: WhiteboardSnapshot | null }
        if (!snapshot) return
        if (wbApi.current) wbApi.current.applySnapshot(snapshot)
        else wbPending.current.snapshot = snapshot
      } catch { /* the board fills in from the tutor's next change */ }
    })()
  }, [sessionId])

  // ── Live updates from the tutor (anything a student sends is ignored) ─────
  useDataChannel(PPT_TOPIC, (msg) => {
    if (!isTutor(msg.from)) return
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as PptAction
      lastLiveStage.current = Date.now()
      switch (data.action) {
        case "start":
        case "sync_response":
          setStage({ ...EMPTY_STAGE, kind: "slides", url: data.url, page: data.page }); break
        case "navigate":
          setStage((s) => ({ ...s, page: data.page })); break
        case "video_start":
          setStage({ ...EMPTY_STAGE, kind: "video", url: data.url, asOf: Date.now() }); break
        case "video_state":
          setStage((s) => ({ ...s, playing: data.playing, currentTime: data.currentTime, asOf: data.ts })); break
        case "video_sync_response":
          setStage({ ...EMPTY_STAGE, kind: "video", url: data.url, playing: data.playing, currentTime: data.currentTime, asOf: data.ts }); break
        case "stop":
        case "video_stop":
        case "sync_idle":
          setStage(EMPTY_STAGE); break
      }
    } catch { /* ignore malformed */ }
  })

  // Same rules as the students' copy in ClassroomRoom: drop reordered moves,
  // and take the hand down if the tutor goes silent.
  useDataChannel(POINTER_TOPIC, (msg) => {
    if (!isTutor(msg.from)) return
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as PointerAction
      if (data.action === "move") {
        if (typeof data.n === "number") {
          const stale = Date.now() - pointerAt.current > 1_000
          if (!stale && pointerSeq.current - data.n >= 0) return
          pointerSeq.current = data.n
          pointerAt.current = Date.now()
        }
        setPointer({ x: data.x, y: data.y })
        if (pointerHide.current) clearTimeout(pointerHide.current)
        pointerHide.current = setTimeout(() => setPointer(null), POINTER_STALE_MS)
      } else if (data.action === "hide") {
        setPointer(null)
        pointerSeq.current = -1
        pointerAt.current = 0
        if (pointerHide.current) clearTimeout(pointerHide.current)
      }
    } catch { /* ignore malformed */ }
  })
  useEffect(() => () => { if (pointerHide.current) clearTimeout(pointerHide.current) }, [])

  const applyWhiteboard = useCallback((snapshot: WhiteboardSnapshot | null) => {
    if (!snapshot) return
    if (wbApi.current) wbApi.current.applySnapshot(snapshot)
    else wbPending.current.snapshot = snapshot
  }, [])

  useDataChannel(WHITEBOARD_TOPIC, (msg) => {
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as WhiteboardAction
      const fromTutor = isTutor(msg.from)
      if (data.action === "start" && fromTutor) setWhiteboardActive(true)
      else if (data.action === "stop" && fromTutor) setWhiteboardActive(false)
      else if (data.action === "sync_response" && fromTutor) {
        setWhiteboardActive(data.active)
        applyWhiteboard(data.snapshot)
      } else if (data.action === "doc") {
        // Students may be allowed to draw; their strokes are part of the board,
        // but carry no name or face.
        if (wbApi.current) wbApi.current.applyChanges(data.changes)
        else wbPending.current.changes.push(data.changes)
      } else if (data.action === "presence" && fromTutor) {
        // The tutor's view only, so the board follows where they look. Other
        // cursors would carry students' names.
        if (wbApi.current) wbApi.current.applyPresence(data.presence)
        else wbPending.current.presence = data.presence
      }
    } catch { /* ignore malformed */ }
  })

  useDataChannel(BREAKOUT_TOPIC, (msg) => {
    if (!isTutor(msg.from)) return
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as BreakoutAction
      if (data.action === "start" || data.action === "update") setBreakouts(true)
      else if (data.action === "stop") setBreakouts(false)
    } catch { /* ignore malformed */ }
  })

  useDataChannel(RECORDER_TOPIC, (msg) => {
    if (!isTutor(msg.from)) return
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as RecorderStateAction
      if (data.action !== "state") return
      setBreakouts(data.breakouts)
      setShown({ gallery: data.gallery ?? false, spotlight: data.spotlight ?? null })
      setWhiteboardActive(data.whiteboard.active)
      applyWhiteboard(data.whiteboard.snapshot)
    } catch { /* ignore malformed */ }
  })

  // What the tutor shows the class — followed here so the recording shows it too.
  useDataChannel(SPOTLIGHT_TOPIC, (msg) => {
    if (!isTutor(msg.from)) return
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as SpotlightAction
      if (data.action === "set") setShown((s) => ({ ...s, spotlight: data.identity }))
      else if (data.action === "clear") setShown((s) => ({ ...s, spotlight: null }))
      else if (data.action === "sync_response") setShown((s) => ({ ...s, spotlight: data.identity }))
    } catch { /* ignore malformed */ }
  })

  useDataChannel(VIEW_TOPIC, (msg) => {
    if (!isTutor(msg.from)) return
    try {
      const data = JSON.parse(dec.decode(msg.payload)) as ViewAction
      if (data.action === "set" || data.action === "sync_response") {
        setShown((s) => ({ ...s, gallery: data.view === "gallery" }))
      }
    } catch { /* ignore malformed */ }
  })

  const registerWhiteboardApi = useCallback((api: WhiteboardApi | null) => {
    wbApi.current = api
    if (!api) return
    const pending = wbPending.current
    if (pending.snapshot) api.applySnapshot(pending.snapshot)
    for (const changes of pending.changes) api.applyChanges(changes as Parameters<WhiteboardApi["applyChanges"]>[0])
    if (pending.presence) api.applyPresence(pending.presence as Parameters<WhiteboardApi["applyPresence"]>[0])
    wbPending.current = { snapshot: null, changes: [], presence: null }
  }, [])

  if (breakouts) {
    return (
      <>
      <Subscriptions faces={false} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950 text-white">
        <p className="text-3xl font-bold">Breakout rooms</p>
        <p className="text-lg text-white/60">Not recorded — the class continues shortly.</p>
      </div>
      </>
    )
  }

  const noop = () => {}
  let content: React.ReactNode = null
  if (shown.gallery) {
    // Gallery: the class sees everyone the same size and no stage, so does the
    // recording. Faces only — no name labels.
    const cols = Math.max(1, Math.ceil(Math.sqrt(cameras.length)))
    return (
      <>
        <Subscriptions faces />
        <div
          className="absolute inset-0 grid gap-2 p-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
        >
          {cameras.map((t) => (
            <div key={t.publication.trackSid} className="relative min-h-0 rounded-lg overflow-hidden bg-zinc-900">
              <VideoTrack trackRef={t} className="absolute inset-0 w-full h-full object-contain" />
            </div>
          ))}
        </div>
        {voices.map((t) => <AudioTrack key={t.publication.trackSid} trackRef={t} />)}
      </>
    )
  }
  if (screens[0]) {
    content = <VideoTrack trackRef={screens[0]} className="w-full h-full object-contain" />
  } else if (whiteboardActive && sessionId) {
    content = (
      <div className="w-full h-full bg-white">
        <TldrawBoard
          isTutor={false}
          canWrite={false}
          studentsCanWrite={false}
          onToggleStudentWrite={noop}
          onStop={noop}
          onMinimize={noop}
          sessionId={sessionId}
          localIdentity="class-recorder"
          localName=""
          followIdentity={tutorIdentity}
          onShareToChat={noop}
          send={noop}
          registerApi={registerWhiteboardApi}
          recording
        />
      </div>
    )
  } else if (stage.kind === "slides" && stage.url) {
    content = (
      <PptSlideViewer fileUrl={stage.url} currentPage={stage.page} onTotalPages={noop} onContentElement={setStageContentEl} />
    )
  } else if (stage.kind === "video" && stage.url) {
    content = (
      <VideoPlayer
        isTutor={false}
        url={stage.url}
        playing={stage.playing}
        currentTime={stage.currentTime}
        asOf={stage.asOf}
        onPlayPause={noop}
        onSeek={noop}
        onContentElement={setStageContentEl}
      />
    )
  }

  const tutorCams = cameras.filter((t) => isTutor(t.participant))
  const studentCams = cameras.filter((t) => !isTutor(t.participant))
  // The class packs into a grid beside the tutor, who stays the biggest face:
  // the signing is what the recording is for.
  const studentCols = studentCams.length <= 1 ? 1 : Math.min(tutorCams.length > 0 ? 3 : 4, Math.ceil(Math.sqrt(studentCams.length)))

  // The hand only belongs on the slides or video it was pointed at — not over a
  // screen share or the board that may have replaced them.
  const pointerOnStage = !screens[0] && !(whiteboardActive && sessionId) && !!stage.kind && !!stage.url
  let pointerStyle: React.CSSProperties | null = null
  if (pointer && pointerOnStage && stageContentBox) {
    const px = stageContentBox.left + pointer.x * stageContentBox.width
    const py = stageContentBox.top + pointer.y * stageContentBox.height
    pointerStyle = {
      left: 0,
      top: 0,
      // lucide's Pointer puts the fingertip near (4, 2) of its 24×24 box.
      transform: `translate3d(${px}px, ${py}px, 0) translate(-16.7%, -8.3%)`,
      transition: `transform ${POINTER_SMOOTHING_MS}ms linear`,
      filter: "drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000) drop-shadow(0 2px 6px rgba(0,0,0,0.85))",
    }
  }

  return (
    <>
      <Subscriptions faces />
      <div className="absolute inset-0 flex gap-3 p-3">
        {content && (
          <div ref={stageAreaRef} className="relative flex-[7] min-w-0 rounded-lg overflow-hidden bg-zinc-950">
            {content}
            {pointerStyle && (
              <div className="absolute pointer-events-none z-40" style={pointerStyle} aria-hidden>
                <Pointer className="size-9 text-white" strokeWidth={2.25} style={{ fill: "rgb(255 255 255 / 0.95)", stroke: "#000" }} />
              </div>
            )}
          </div>
        )}
        {cameras.length > 0 && (
          <div className={content ? "flex-[3] min-w-0 flex flex-col justify-center gap-3" : "flex-1 min-w-0 flex gap-3"}>
            {tutorCams.map((t) => (
              <div key={t.publication.trackSid} className="relative flex-1 min-h-0 rounded-lg overflow-hidden bg-zinc-900">
                {/* Contained, not cropped: signing needs the hands in frame. */}
                <VideoTrack trackRef={t} className="absolute inset-0 w-full h-full object-contain" />
              </div>
            ))}
            {studentCams.length > 0 && (
              // The class as a grid, like the tutor's pop-out — a stack of a
              // dozen faces in one column would leave each a sliver.
              <div
                className={cn(
                  "min-w-0 min-h-0 grid gap-2",
                  tutorCams.length === 0 ? "flex-1" : content ? "flex-[2]" : "flex-[0.5]",
                )}
                style={{ gridTemplateColumns: `repeat(${studentCols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
              >
                {studentCams.map((t) => (
                  <div key={t.publication.trackSid} className="relative min-h-0 rounded-lg overflow-hidden bg-zinc-900">
                    <VideoTrack trackRef={t} className="absolute inset-0 w-full h-full object-contain" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {voices.map((t) => <AudioTrack key={t.publication.trackSid} trackRef={t} />)}
    </>
  )
}

// Marks the page ready once the room has joined; the worker waits for this.
function ReadySignal() {
  useEffect(() => {
    const id = window.requestAnimationFrame(() => console.log("START_RECORDING"))
    return () => {
      window.cancelAnimationFrame(id)
      console.log("END_RECORDING")
    }
  }, [])
  return null
}

function RoomReadyBridge() {
  const state = useConnectionState()
  if (state !== ConnectionState.Connected) return null
  return <ReadySignal />
}
