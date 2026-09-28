"use client"

import { useLocalParticipant, useTrackToggle } from "@livekit/components-react"
import { Track } from "livekit-client"
import {
  Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ComponentProps, type ReactNode,
} from "react"
import {
  Mic, MicOff, Camera, CameraOff, Monitor, PhoneOff,
  Presentation, ChevronLeft, ChevronRight,
  X, Pointer, RefreshCw, Film, PencilLine, Users2, Eye, EyeOff, Bell, Sparkles, Upload,
  Circle, Pause, UserPlus, Hand, Captions, CaptionsOff, Keyboard, Maximize2, Minimize2,
  PictureInPicture2, MoreHorizontal,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SCREEN_SHARE_CAPTURE, SCREEN_SHARE_PUBLISH } from "./constants"
import { toast } from "sonner"
import { writeDevicePreference, mediaFailureMessage } from "@/components/classroom/devicePreference"
import {
  setCaptionsEnabled, useCaptionsEnabled, setCaptionComposerOpen, useCaptionComposerOpen,
} from "@/components/classroom/captionsPreference"

// The bar is one row. A student's few controls scroll sideways if they run out
// of room, with Leave pinned to the right. The tutor has twenty-odd controls:
// scrolling hid Whiteboard, Breakouts and Present off-screen on a laptop, and
// a fixed short list behind "More" hid tools a wide screen had room for. So
// the tutor's bar fills the line with as many tools as fit, in priority order,
// and only the ones that don't fit go in a "…" menu (see OverflowTools).
// Labels hide below `sm` and rely on the tooltip / aria-label.
const CORE_LABEL = "hidden sm:inline"

const BTN = "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border"
const IDLE = "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent"
const ON_SKY = "bg-sky-500/20 text-sky-300 border-sky-500/40"

export function ControlsBar({
  isTutor,
  onLeave,
  // Tutor controls for student microphones
  studentCount,
  onMuteAll,
  onUnmuteAll,
  // Session-level admin actions (tutor only)
  onRefreshAll,
  // Student self-refresh — reloads this tab and auto-rejoins without the lobby
  onRefreshSelf,
  // Invite a second teacher to co-teach (host only — the API is owner-scoped)
  canInviteCoTutor = true,
  onInviteCoTutor,
  // Student asks the tutor to unmute them
  onRequestToSpeak,
  // PPT controls (tutor only)
  pptActive,
  // "slides" shows next/prev/counter + slide tray. "video" hides those and shows
  // a "Playing video" indicator instead (tutor drives playback via the video
  // element itself). Defaults to "slides" for backwards compatibility.
  presentKind = "slides",
  // Position within the tutor's chosen subset of slides (0-based).
  // -1 when the currently-shown slide has been live-excluded from the sequence.
  presentationIdx,
  // Count of slides the tutor selected to present
  selectedCount,
  // Whether an included slide exists after/before the current page. Next/prev
  // may still step even when the current slide itself has been excluded.
  hasNextSlide,
  hasPrevSlide,
  onShowUpload,
  // A deck the tutor prepared before the lesson, ready to go in one click.
  preparedKind = null,
  preparedName = null,
  preparedCount = 0,
  onPresentPrepared,
  onPptNext,
  onPptPrev,
  onPptStop,
  // Pointer (tutor only, active during slide presentation)
  pointerMode,
  onTogglePointer,
  // Whiteboard (tutor toggles on/off; both roles interact once open)
  whiteboardActive,
  onToggleWhiteboard,
  // Breakout rooms (tutor only)
  breakoutsActive,
  onOpenBreakoutsPanel,
  onOpenBreakoutMonitor,
  // Attention nudge (tutor only)
  onNudgeClass,
  // When a student is pinned, the class-nudge button targets only them.
  nudgeTargetName = null,
  // Screen share privacy (tutor only)
  screenSharing,
  screenPrivate,
  onToggleScreenPrivacy,
  // Always-on-top window of the class (tutor only, Chrome / Edge)
  studentsPipSupported = false,
  studentsPipOpen = false,
  onToggleStudentsPip,
  // Background blur (everyone — applies to the local camera track)
  blurEnabled,
  blurBusy,
  onToggleBlur,
  // Recording start / pause / resume (tutor only)
  recordingStarted,
  recordingPaused,
  recordingBusy,
  onToggleRecording,
}: {
  isTutor: boolean
  onLeave: () => void
  studentCount: number
  onMuteAll: () => void
  onUnmuteAll: () => void
  onRefreshAll: () => void
  onRefreshSelf: () => void
  canInviteCoTutor?: boolean
  onInviteCoTutor: () => void
  onRequestToSpeak: () => void
  pptActive: boolean
  presentKind?: "slides" | "video" | null
  presentationIdx: number
  selectedCount: number
  hasNextSlide: boolean
  hasPrevSlide: boolean
  onShowUpload: () => void
  preparedKind?: "slides" | "video" | null
  preparedName?: string | null
  preparedCount?: number
  onPresentPrepared: () => void
  onPptNext: () => void
  onPptPrev: () => void
  onPptStop: () => void
  pointerMode: boolean
  onTogglePointer: () => void
  whiteboardActive: boolean
  onToggleWhiteboard: () => void
  breakoutsActive: boolean
  onOpenBreakoutsPanel: () => void
  onOpenBreakoutMonitor: () => void
  onNudgeClass: () => void
  nudgeTargetName?: string | null
  screenSharing: boolean
  screenPrivate: boolean
  onToggleScreenPrivacy: () => void
  studentsPipSupported?: boolean
  studentsPipOpen?: boolean
  onToggleStudentsPip?: () => void
  blurEnabled: boolean
  blurBusy: boolean
  onToggleBlur: () => void
  recordingStarted: boolean
  recordingPaused: boolean
  recordingBusy: boolean
  onToggleRecording: () => void
}) {
  const { localParticipant } = useLocalParticipant()
  const micEnabled = !!localParticipant.isMicrophoneEnabled
  const captionsEnabled = useCaptionsEnabled()
  const composerOpen = useCaptionComposerOpen()

  // "Ask to speak" gave no sign it had worked, so students pressed it again and
  // the tutor got a toast for every press. Hold it in an "Asked" state instead.
  const [askedToSpeak, setAskedToSpeak] = useState(false)
  useEffect(() => {
    if (!askedToSpeak) return
    const t = setTimeout(() => setAskedToSpeak(false), 30_000)
    return () => clearTimeout(t)
  }, [askedToSpeak])

  const fullscreen = useRoomFullscreen()

  const blurButton = (
    <button
      onClick={onToggleBlur}
      disabled={blurBusy}
      className={cn(BTN, blurEnabled ? ON_SKY : IDLE, blurBusy && "opacity-60 cursor-wait")}
      title={
        blurEnabled
          ? "Turn background blur off"
          : "Blur your background — students and tutor see the blurred feed"
      }
      aria-label={blurEnabled ? "Turn background blur off" : "Blur background"}
    >
      <Sparkles className="size-3.5" />
      <span className={CORE_LABEL}>{blurEnabled ? "Blur on" : "Blur"}</span>
    </button>
  )

  // Live captions — each viewer's own choice; hides them only here.
  const captionsButton = (
    <button
      onClick={() => setCaptionsEnabled(!captionsEnabled)}
      className={cn(BTN, captionsEnabled ? ON_SKY : IDLE)}
      title={captionsEnabled ? "Hide live captions (only on your screen)" : "Show live captions"}
      aria-label={captionsEnabled ? "Turn captions off" : "Turn captions on"}
      aria-pressed={captionsEnabled}
    >
      {captionsEnabled ? <Captions className="size-3.5" /> : <CaptionsOff className="size-3.5" />}
      <span className={CORE_LABEL}>{captionsEnabled ? "Captions" : "Captions off"}</span>
    </button>
  )

  const screenToggle = (
    <MediaToggle
      source={Track.Source.ScreenShare}
      // Capture and publish at text-readable quality — see the constants for
      // why the defaults aren't good enough for slides and documents.
      captureOptions={SCREEN_SHARE_CAPTURE}
      publishOptions={SCREEN_SHARE_PUBLISH}
      activeWhenOn
      onIcon={<Monitor className="size-3.5" />}
      offIcon={<Monitor className="size-3.5" />}
      onLabel="Stop sharing"
      offLabel="Screen"
      onTitle="Stop sharing your screen"
      offTitle={
        isTutor
          ? "Share your screen with the class"
          : "Share your screen — your tutor can pin and show it to everyone"
      }
    />
  )

  const cameraToggle = (
    <MediaToggle
      source={Track.Source.Camera}
      onIcon={<Camera className="size-3.5" />}
      offIcon={<CameraOff className="size-3.5" />}
      onLabel="Camera"
      offLabel="Camera off"
      onTitle="Turn your camera off"
      offTitle={isTutor ? "Turn your camera on" : "Turn your camera on so your tutor can see you sign"}
    />
  )

  const leaveButton = (
    <button
      onClick={onLeave}
      aria-label="Leave the class"
      className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors whitespace-nowrap ml-auto shrink-0"
    >
      <PhoneOff className="size-3.5" /> <span className={CORE_LABEL}>Leave</span>
    </button>
  )

  if (!isTutor) {
    return (
      <div className="flex items-center gap-2 w-full min-w-0 overflow-x-auto overflow-y-hidden">
        <div
          className={cn(
            "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium border whitespace-nowrap cursor-not-allowed",
            micEnabled
              ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/40"
              : "bg-zinc-800/80 text-zinc-500 border-zinc-700/60",
          )}
          title={micEnabled ? "Microphone is ON (controlled by tutor)" : "Microphone is OFF (controlled by tutor)"}
          aria-label={micEnabled ? "Microphone on, controlled by your tutor" : "Microphone off, controlled by your tutor"}
        >
          {micEnabled ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
          <span className={CORE_LABEL}>Mic {micEnabled ? "on" : "off"}</span>
        </div>
        {/* When muted, a student can ask the tutor to turn their mic on. */}
        {!micEnabled && (
          <button
            onClick={() => { onRequestToSpeak(); setAskedToSpeak(true) }}
            disabled={askedToSpeak}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap disabled:bg-sky-900/60 disabled:text-sky-200 disabled:cursor-default"
            title={askedToSpeak ? "Your tutor has been asked — waiting for them" : "Ask your tutor to turn your microphone on"}
            aria-label={askedToSpeak ? "Asked to speak" : "Ask to speak"}
          >
            <Hand className="size-3.5" />
            <span className={CORE_LABEL}>{askedToSpeak ? "Asked" : "Ask to speak"}</span>
          </button>
        )}
        {cameraToggle}
        {blurButton}
        {captionsButton}
        {screenToggle}
        <RoomFullscreenButton />
        {/* Reload this tab only, then auto-rejoin. Chat history and current
            slides are restored after reconnect. */}
        <button
          onClick={onRefreshSelf}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-amber-900/40 hover:text-amber-300 text-zinc-300 transition-colors whitespace-nowrap"
          title="Reload your classroom view. Chat history and the current slides will come back after you reconnect."
          aria-label="Refresh your classroom"
        >
          <RefreshCw className="size-3.5" />
          <span className={CORE_LABEL}>Refresh</span>
        </button>
        <div className="ml-auto sticky right-0 shrink-0 shadow-[-12px_0_12px_-8px_rgb(9_9_11)]">{leaveButton}</div>
      </div>
    )
  }

  // ── Tutor ──
  // Media and the live presentation controls are always on the bar. Everything
  // else is a "tool", in priority order: as many as fit the width stay inline
  // and the rest collapse, from the end of the list, into the "…" menu.
  const noStudents = studentCount === 0
  const tools: Tool[] = []

  // With a deck prepared before the lesson the primary button starts it
  // outright — the whole point of preparing is not to be uploading and picking
  // slides while a class watches. The upload path stays one click away.
  if (!pptActive && !whiteboardActive) {
    tools.push(preparedKind ? {
      key: "present",
      inline: (
        <div className="flex items-center gap-1">
          <button
            onClick={onPresentPrepared}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold bg-primary/20 hover:bg-primary/30 text-primary border border-primary/40 transition-colors whitespace-nowrap"
            title={
              preparedName
                ? `Present "${preparedName}" — prepared before the lesson`
                : "Present your prepared file"
            }
          >
            {preparedKind === "video"
              ? <><Film className="size-3.5" /> Play video</>
              : <><Presentation className="size-3.5" /> Present {preparedCount} slides</>}
          </button>
          <button
            onClick={onShowUpload}
            className="flex items-center justify-center size-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            title="Present something else — upload a different file"
            aria-label="Present a different file"
          >
            <Upload className="size-3.5" />
          </button>
        </div>
      ),
      menu: (
        <>
          <MenuTool
            icon={preparedKind === "video" ? <Film /> : <Presentation />}
            label={preparedKind === "video" ? "Play video" : `Present ${preparedCount} slides`}
            onSelect={onPresentPrepared}
          />
          <MenuTool icon={<Upload />} label="Present a different file" onSelect={onShowUpload} />
        </>
      ),
    } : {
      key: "present",
      inline: (
        <button onClick={onShowUpload} className={cn(BTN, IDLE)} title="Upload and present slides or a video">
          <Presentation className="size-3.5" /> Present
        </button>
      ),
      menu: <MenuTool icon={<Presentation />} label="Present slides or video" onSelect={onShowUpload} />,
    })
  }

  // Only the tutor draws by default; "Let them write" on the board hands
  // control to students. Hidden while slides/video are live — one shared
  // surface at a time.
  if (!pptActive || whiteboardActive) {
    tools.push({
      key: "whiteboard",
      inline: (
        <button
          onClick={onToggleWhiteboard}
          className={cn(BTN, whiteboardActive ? "bg-amber-500/25 text-amber-300 border-amber-500/50" : IDLE)}
          title={
            whiteboardActive
              ? "Close the whiteboard for everyone"
              : "Open a shared whiteboard — tutor draws; students view until you let them write"
          }
          aria-label={whiteboardActive ? "Close the whiteboard" : "Whiteboard"}
        >
          <PencilLine className="size-3.5" />
          <span className={CORE_LABEL}>{whiteboardActive ? "Close Board" : "Whiteboard"}</span>
        </button>
      ),
      menu: (
        <MenuTool
          icon={<PencilLine />}
          label={whiteboardActive ? "Close whiteboard" : "Whiteboard"}
          active={whiteboardActive}
          onSelect={onToggleWhiteboard}
        />
      ),
    })
  }

  // Once live, a second tool opens the monitor grid so the tutor can watch
  // every student's signing across all groups at once.
  tools.push({
    key: "breakouts",
    inline: (
      <button
        onClick={onOpenBreakoutsPanel}
        className={cn(BTN, breakoutsActive ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : IDLE)}
        title={
          breakoutsActive
            ? "Edit, visit, or end the active breakouts"
            : "Split students into small groups for pair or group work"
        }
        aria-label={breakoutsActive ? "Breakouts live" : "Breakouts"}
      >
        <Users2 className="size-3.5" />
        <span className={CORE_LABEL}>{breakoutsActive ? "Breakouts live" : "Breakouts"}</span>
      </button>
    ),
    menu: (
      <MenuTool
        icon={<Users2 />}
        label={breakoutsActive ? "Breakouts live" : "Breakouts"}
        active={breakoutsActive}
        onSelect={onOpenBreakoutsPanel}
      />
    ),
  })
  if (breakoutsActive) {
    tools.push({
      key: "monitor",
      inline: (
        <button
          onClick={onOpenBreakoutMonitor}
          className={cn(BTN, "bg-zinc-800 hover:bg-emerald-900/40 hover:text-emerald-300 text-zinc-300 border-transparent")}
          title="Open the monitor grid — watch every student's signing across all groups"
          aria-label="Breakout monitor"
        >
          <Eye className="size-3.5" />
          <span className={CORE_LABEL}>Monitor</span>
        </button>
      ),
      menu: <MenuTool icon={<Eye />} label="Breakout monitor" onSelect={onOpenBreakoutMonitor} />,
    })
  }

  // Each pause/resume cycle produces a separate MP4 segment in S3, so breaks
  // and private chats don't end up in the saved recording.
  const recLabel = !recordingStarted ? "Start Rec" : recordingPaused ? "Resume Rec" : "Pause Rec"
  const recIcon = recordingStarted && !recordingPaused
    ? <Pause className="size-3.5" />
    : <Circle className="size-3.5 fill-current" />
  tools.push({
    key: "rec",
    inline: (
      <button
        onClick={onToggleRecording}
        disabled={recordingBusy}
        className={cn(
          BTN,
          !recordingStarted || recordingPaused
            ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-700/40"
            : IDLE,
          recordingBusy && "opacity-60 cursor-wait",
        )}
        title={
          !recordingStarted
            ? "Start recording this session"
            : recordingPaused
              ? "Resume recording — starts a new segment"
              : "Pause recording — the next break won't be saved"
        }
        aria-label={!recordingStarted ? "Start recording" : recordingPaused ? "Resume recording" : "Pause recording"}
      >
        {recIcon}
        <span className={CORE_LABEL}>{recLabel}</span>
      </button>
    ),
    menu: <MenuTool icon={recIcon} label={recLabel} disabled={recordingBusy} onSelect={onToggleRecording} />,
  })

  // BSL classrooms can't rely on sound, so a visual flash is the attention cue.
  // With nobody pinned this is the whole class; with a student pinned it
  // targets only them. Per-group nudges live in the breakout monitor.
  const nudgeLabel = nudgeTargetName ? "Nudge student" : "Nudge class"
  tools.push({
    key: "nudge",
    inline: (
      <button
        onClick={onNudgeClass}
        className={cn(BTN, "bg-zinc-800 hover:bg-amber-500/25 hover:text-amber-300 text-zinc-300 border-transparent")}
        title={
          nudgeTargetName
            ? `Flash a short visual attention alert on ${nudgeTargetName}'s screen only`
            : "Flash a short visual attention alert on every student's screen"
        }
        aria-label={nudgeTargetName ? `Nudge ${nudgeTargetName}` : "Nudge the whole class"}
      >
        <Bell className="size-3.5" />
        <span className={CORE_LABEL}>{nudgeLabel}</span>
      </button>
    ),
    menu: <MenuTool icon={<Bell />} label={nudgeLabel} onSelect={onNudgeClass} />,
  })

  tools.push({
    key: "mute-all",
    inline: (
      <button
        onClick={onMuteAll}
        disabled={noStudents}
        className={cn(BTN, "bg-zinc-800 hover:bg-rose-900/40 hover:text-rose-300 text-zinc-300 border-transparent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-zinc-300")}
        title={noStudents ? "No students in the room yet" : "Turn off every student's microphone."}
        aria-label="Mute all students"
      >
        <MicOff className="size-3.5" />
        <span className={CORE_LABEL}>Mute all</span>
      </button>
    ),
    menu: <MenuTool icon={<MicOff />} label="Mute all students" disabled={noStudents} onSelect={onMuteAll} />,
  })
  tools.push({
    key: "unmute-all",
    inline: (
      <button
        onClick={onUnmuteAll}
        disabled={noStudents}
        className={cn(BTN, "bg-zinc-800 hover:bg-emerald-900/40 hover:text-emerald-300 text-zinc-300 border-transparent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-zinc-300")}
        title={noStudents ? "No students in the room yet" : "Turn on every student's microphone."}
        aria-label="Unmute all students"
      >
        <Mic className="size-3.5" />
        <span className={CORE_LABEL}>Unmute all</span>
      </button>
    ),
    menu: <MenuTool icon={<Mic />} label="Unmute all students" disabled={noStudents} onSelect={onUnmuteAll} />,
  })

  tools.push({
    key: "captions",
    inline: captionsButton,
    menu: (
      <MenuTool
        icon={captionsEnabled ? <Captions /> : <CaptionsOff />}
        label="Live captions"
        active={captionsEnabled}
        onSelect={() => setCaptionsEnabled(!captionsEnabled)}
      />
    ),
  })

  // Type a caption, or send a prepared one, instead of speaking.
  tools.push({
    key: "type-caption",
    inline: (
      <button
        onClick={() => setCaptionComposerOpen(!composerOpen)}
        className={cn(BTN, composerOpen ? ON_SKY : IDLE)}
        title="Type a caption, or send one you prepared, at the bottom of everyone's screen"
        aria-label={composerOpen ? "Close caption typing" : "Type a caption"}
        aria-pressed={composerOpen}
      >
        <Keyboard className="size-3.5" />
        <span className={CORE_LABEL}>Type caption</span>
      </button>
    ),
    menu: (
      <MenuTool
        icon={<Keyboard />}
        label="Type caption"
        active={composerOpen}
        onSelect={() => setCaptionComposerOpen(!composerOpen)}
      />
    ),
  })

  tools.push({
    key: "blur",
    inline: blurButton,
    menu: (
      <MenuTool icon={<Sparkles />} label="Blur background" active={blurEnabled} disabled={blurBusy} onSelect={onToggleBlur} />
    ),
  })

  // Pop the class out into an always-on-top window, so a teacher sharing
  // another tab can still see their students. While sharing it sits next to
  // Screen instead, since that's when it's needed.
  const pipInline = studentsPipSupported && onToggleStudentsPip && (screenSharing || studentsPipOpen)
  if (studentsPipSupported && onToggleStudentsPip && !pipInline) {
    tools.push({
      key: "pip",
      inline: (
        <button
          onClick={onToggleStudentsPip}
          className={cn(BTN, IDLE)}
          title="Keep your students on top of every tab and app while you share your screen"
        >
          <PictureInPicture2 className="size-3.5" />
          <span className={CORE_LABEL}>Pop out students</span>
        </button>
      ),
      menu: <MenuTool icon={<PictureInPicture2 />} label="Pop out students" onSelect={onToggleStudentsPip} />,
    })
  }

  // Invite another teacher to co-teach. They get a notification (and email if
  // configured) with a link that opens the classroom with full tutor controls.
  if (canInviteCoTutor) {
    tools.push({
      key: "invite",
      inline: (
        <button
          onClick={onInviteCoTutor}
          className={cn(BTN, IDLE)}
          title="Invite another teacher to co-teach this session"
          aria-label="Invite a second teacher"
        >
          <UserPlus className="size-3.5" />
          <span className={CORE_LABEL}>Invite teacher</span>
        </button>
      ),
      menu: <MenuTool icon={<UserPlus />} label="Invite a co-teacher" onSelect={onInviteCoTutor} />,
    })
  }

  if (fullscreen.supported) {
    tools.push({
      key: "fullscreen",
      inline: <RoomFullscreenButton />,
      menu: (
        <MenuTool
          icon={fullscreen.active ? <Minimize2 /> : <Maximize2 />}
          label={fullscreen.active ? "Exit full screen" : "Full screen"}
          onSelect={fullscreen.toggle}
        />
      ),
    })
  }

  // Recovery when the room freezes: reloads every client, the tutor's too.
  // Asks for confirmation first.
  tools.push({
    key: "refresh-all",
    inline: (
      <button
        onClick={onRefreshAll}
        className={cn(BTN, "bg-zinc-800 hover:bg-amber-900/40 hover:text-amber-300 text-zinc-300 border-transparent")}
        title="Reload the classroom for every student and yourself. Use if the session freezes."
        aria-label="Refresh the classroom for everyone"
      >
        <RefreshCw className="size-3.5" />
        <span className={CORE_LABEL}>Refresh all</span>
      </button>
    ),
    menu: <MenuTool icon={<RefreshCw />} label="Refresh all" tone="warn" onSelect={onRefreshAll} />,
  })

  return (
    <div className="flex items-center gap-2 w-full min-w-0 overflow-hidden">
      <MediaToggle
        source={Track.Source.Microphone}
        onIcon={<Mic className="size-3.5" />}
        offIcon={<MicOff className="size-3.5" />}
        onLabel="Mic"
        offLabel="Mic off"
        onTitle="Turn your microphone off"
        offTitle="Turn your microphone on"
      />
      {cameraToggle}
      {screenToggle}

      {/* "Private" hides the shared screen from students (they see a
          placeholder) without stopping the track, so there's no start/stop lag. */}
      {screenSharing && (
        <button
          onClick={onToggleScreenPrivacy}
          className={cn(BTN, screenPrivate ? "bg-zinc-700 text-zinc-200 border-zinc-500" : IDLE)}
          title={
            screenPrivate
              ? "Screen is private — students see a placeholder. Click to make it visible."
              : "Click to hide your screen from students while you prepare."
          }
        >
          {screenPrivate ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          <span className={CORE_LABEL}>{screenPrivate ? "Private" : "Visible"}</span>
        </button>
      )}

      {pipInline && (
        <button
          onClick={onToggleStudentsPip}
          className={cn(
            BTN,
            studentsPipOpen
              ? "bg-zinc-700 text-zinc-200 border-zinc-500"
              : "bg-primary text-white border-transparent hover:bg-primary/90",
          )}
          title={
            studentsPipOpen
              ? "Close the floating students window"
              : "Keep your students on top of every tab and app while you share your screen"
          }
          aria-pressed={studentsPipOpen}
        >
          <PictureInPicture2 className="size-3.5" />
          <span className={CORE_LABEL}>{studentsPipOpen ? "Close students" : "Pop out students"}</span>
        </button>
      )}

      <Divider />

      {/* Slide controls — only while presenting a deck. Video is driven by the
          player's own controls, so it gets a "Playing video" badge instead. */}
      {pptActive && presentKind === "slides" && (
        <>
          <button
            onClick={onPptPrev}
            disabled={!hasPrevSlide}
            className="flex items-center justify-center size-9 shrink-0 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous slide"
            aria-label="Previous slide"
          >
            <ChevronLeft className="size-4" />
          </button>

          {/* Position within the selected subset. Dashes when the current slide
              has been excluded from the sequence. */}
          <span
            className="text-xs text-zinc-400 bg-zinc-800 px-2.5 h-9 flex items-center rounded-xl whitespace-nowrap font-mono shrink-0"
            title={
              presentationIdx < 0
                ? "Current slide isn't in your selection — use the tray to include it, or press next/prev"
                : "Position within the slides you selected"
            }
          >
            {presentationIdx < 0 ? "—" : presentationIdx + 1} / {selectedCount}
          </span>

          <button
            onClick={onPptNext}
            disabled={!hasNextSlide}
            className="flex items-center justify-center size-9 shrink-0 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next slide"
            aria-label="Next slide"
          >
            <ChevronRight className="size-4" />
          </button>
        </>
      )}

      {pptActive && presentKind === "video" && (
        <span
          className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 h-9 rounded-xl whitespace-nowrap shrink-0"
          title="Use the video's own play/seek controls — everything syncs to students automatically."
        >
          <Film className="size-3.5" />
          <span className={CORE_LABEL}>Playing video</span>
        </span>
      )}

      {pptActive && (
        <>
          <button
            onClick={onTogglePointer}
            className={cn(
              BTN, "shrink-0",
              pointerMode ? "bg-amber-500/25 text-amber-300 border-amber-500/50 animate-pulse" : IDLE,
            )}
            // The hand stays where it was put — it is a marker, not a cursor
            // mirror — so the label has to say that taking it down is a
            // deliberate act, or a teacher will wait for it to fade.
            title={pointerMode
              ? "Take the hand pointer down"
              : "Point at the presentation — a hand follows your cursor and stays where you leave it"}
          >
            <Pointer className="size-3.5" />
            <span className={CORE_LABEL}>{pointerMode ? "Pointing" : "Pointer"}</span>
          </button>

          <button
            onClick={onPptStop}
            className="flex items-center gap-1.5 px-3 h-9 shrink-0 rounded-xl text-xs font-medium bg-amber-900/40 hover:bg-amber-900/70 text-amber-400 border border-amber-700/40 transition-colors whitespace-nowrap"
            title={presentKind === "video" ? "Stop playing the video" : "Stop presenting slides"}
          >
            <X className="size-3.5" />
            <span className={CORE_LABEL}>{presentKind === "video" ? "End Video" : "End Slides"}</span>
          </button>
        </>
      )}

      <OverflowTools tools={tools} />

      {leaveButton}
    </div>
  )
}

// Plain button over LiveKit's useTrackToggle. The stock <TrackToggle> adds the
// unlayered `.lk-button` class, which beats our Tailwind utilities — the
// buttons came out transparent at 16px, with LiveKit's own icon doubled up
// next to ours, and the red "camera off" state never showed at all.
function MediaToggle({
  source,
  captureOptions,
  publishOptions,
  activeWhenOn = false,
  onIcon,
  offIcon,
  onLabel,
  offLabel,
  onTitle,
  offTitle,
}: {
  source: Track.Source.Microphone | Track.Source.Camera | Track.Source.ScreenShare
  captureOptions?: typeof SCREEN_SHARE_CAPTURE
  publishOptions?: typeof SCREEN_SHARE_PUBLISH
  // Screen share is off by default, so "on" is the state worth highlighting;
  // for mic and camera it's "off" that needs to stand out.
  activeWhenOn?: boolean
  onIcon: ReactNode
  offIcon: ReactNode
  onLabel: string
  offLabel: string
  onTitle: string
  offTitle: string
}) {
  const { enabled, pending, toggle } = useTrackToggle({
    source,
    captureOptions,
    publishOptions,
  })
  // Remembered so a reload ("Refresh all" included) rejoins the same way.
  // Written here, on the click, rather than from `onChange`: LiveKit only flags
  // a change as user-initiated when it comes through its own button props, so
  // calling `toggle()` directly never counted and the preference was never
  // saved — a student who had their camera on came back from a reload with it
  // off. Changes this person didn't make (leaving the room, a reconnect) still
  // don't touch it.
  const handleClick = async () => {
    const next = !enabled
    try {
      await toggle()
    } catch (err) {
      // Turning on is the only direction that can fail for a reason the person
      // can fix (blocked permission, webcam held by another app).
      if (next && source === Track.Source.Camera) toast.error(mediaFailureMessage(err, "camera"))
      if (next && source === Track.Source.Microphone) toast.error(mediaFailureMessage(err, "mic"))
      return
    }
    if (source === Track.Source.Camera) writeDevicePreference("camera", next)
    if (source === Track.Source.Microphone) writeDevicePreference("mic", next)
  }
  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={pending}
      aria-pressed={enabled}
      aria-label={enabled ? onLabel : offLabel}
      title={enabled ? onTitle : offTitle}
      className={cn(
        "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border disabled:opacity-60 disabled:cursor-wait",
        activeWhenOn && enabled
          ? "bg-emerald-900/50 text-emerald-300 border-emerald-700/50 hover:bg-emerald-900/70"
          : !activeWhenOn && !enabled
            ? "bg-rose-900/50 text-rose-300 border-rose-700/50 hover:bg-rose-900/70"
            : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent",
      )}
    >
      {enabled ? onIcon : offIcon}
      <span className={CORE_LABEL}>{enabled ? onLabel : offLabel}</span>
    </button>
  )
}

/**
 * The whole classroom, fullscreen.
 *
 * On a small laptop the browser's tabs, bookmarks bar and the OS taskbar take a
 * fifth of the height before the class gets any, and in gallery view every row
 * of faces pays for it. The per-video fullscreen on the stage doesn't help
 * there — it shows one person. This takes the page itself fullscreen, so the
 * gallery, chat and these controls all stay and simply get the whole screen.
 *
 * The document element rather than the classroom shell, so dialogs, toasts and
 * popovers portalled to <body> still show. Hidden where the browser has no
 * Fullscreen API (iPhone Safari), where it could only ever fail.
 */
function subscribeFullscreen(listener: () => void) {
  document.addEventListener("fullscreenchange", listener)
  return () => document.removeEventListener("fullscreenchange", listener)
}

function useRoomFullscreen() {
  const supported = useSyncExternalStore(subscribeFullscreen, () => !!document.fullscreenEnabled, () => false)
  const active = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement === document.documentElement,
    () => false,
  )
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen().catch(() => {})
  }
  return { supported, active, toggle }
}

function RoomFullscreenButton() {
  const { supported, active, toggle } = useRoomFullscreen()

  if (!supported) return null

  return (
    <button
      onClick={toggle}
      className={cn(
        "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap",
        active
          ? "bg-primary/20 text-primary hover:bg-primary/30"
          : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300",
      )}
      title={active ? "Exit full screen (Esc)" : "Full screen — use the whole screen for the class"}
      aria-label={active ? "Exit full screen" : "Full screen"}
      aria-pressed={active}
    >
      {active ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      <span className={CORE_LABEL}>{active ? "Exit full screen" : "Full screen"}</span>
    </button>
  )
}


function Divider() {
  return <div aria-hidden className="h-6 w-px bg-zinc-800 shrink-0" />
}

type Tool = {
  key: string
  // The button as it sits on the bar.
  inline: ReactNode
  // The same action as it reads in the "…" menu, once it no longer fits.
  menu: ReactNode
}

const TOOL_GAP = 8 // gap-2

function MenuTool({
  icon,
  label,
  onSelect,
  disabled,
  active,
  tone,
}: {
  icon: ReactNode
  label: string
  onSelect: () => void
  disabled?: boolean
  // On/off tools show a dot, so a state that was visible on the bar still is.
  active?: boolean
  tone?: "warn"
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "gap-2 px-2 py-1.5 text-xs text-zinc-200 focus:bg-zinc-800 focus:text-zinc-100 [&_svg]:size-3.5 [&_svg]:text-zinc-400",
        tone === "warn" && "text-amber-300 focus:text-amber-200 [&_svg]:text-amber-400",
      )}
    >
      {icon}
      {label}
      {active && <span aria-label="on" className="ml-auto size-1.5 rounded-full bg-sky-400" />}
    </DropdownMenuItem>
  )
}

/**
 * The tutor's tools, as many as fit on one line; the rest go in a "…" menu.
 *
 * Widths come from an invisible copy of every tool (plus the "…" button), so
 * the count is right whichever tools are showing at the moment and whatever
 * their labels currently say ("Start Rec" vs "Pause Rec"). The region is
 * flex-1, so its width is set by the bar and never by how many tools are in
 * it — no feedback loop between measuring and hiding.
 */
function OverflowTools({ tools }: { tools: Tool[] }) {
  const regionRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [fitCount, setFitCount] = useState(tools.length)

  useLayoutEffect(() => {
    const region = regionRef.current
    const measure = measureRef.current
    if (!region || !measure) return
    const compute = () => {
      const avail = region.clientWidth
      const nodes = Array.from(measure.children) as HTMLElement[]
      const moreWidth = nodes.pop()?.offsetWidth ?? 0
      const widths = nodes.map((n) => n.offsetWidth)
      const all = widths.reduce((sum, w, i) => sum + w + (i ? TOOL_GAP : 0), 0)
      if (all <= avail) { setFitCount(widths.length); return }
      let used = moreWidth
      let n = 0
      for (const w of widths) {
        if (used + TOOL_GAP + w > avail) break
        used += TOOL_GAP + w
        n++
      }
      setFitCount(n)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(region)
    ro.observe(measure)
    return () => ro.disconnect()
  }, [tools.length])

  const shown = tools.slice(0, fitCount)
  const overflow = tools.slice(fitCount)

  return (
    <div ref={regionRef} className="relative flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
      <div ref={measureRef} aria-hidden inert className="absolute left-0 top-0 flex gap-2 w-max invisible pointer-events-none">
        {tools.map((t) => <div key={t.key} className="flex shrink-0">{t.inline}</div>)}
        <MoreButton />
      </div>

      {shown.map((t) => <div key={t.key} className="flex shrink-0">{t.inline}</div>)}

      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MoreButton />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-56 bg-zinc-900 text-zinc-200 ring-zinc-700/70"
          >
            {overflow.map((t) => <Fragment key={t.key}>{t.menu}</Fragment>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function MoreButton(props: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors whitespace-nowrap shrink-0 data-[state=open]:bg-zinc-700"
      title="More controls"
      aria-label="More controls"
    >
      <MoreHorizontal className="size-3.5" />
      <span className={CORE_LABEL}>More</span>
    </button>
  )
}
