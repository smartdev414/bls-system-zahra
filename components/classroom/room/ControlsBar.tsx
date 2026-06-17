"use client"

import { TrackToggle, useLocalParticipant } from "@livekit/components-react"
import { Track } from "livekit-client"
import {
  Mic, MicOff, Camera, Monitor, PhoneOff,
  Presentation, ChevronLeft, ChevronRight,
  X, Pointer, RefreshCw, Film, PencilLine, Users2, Eye, EyeOff, Bell, Sparkles,
  Circle, Pause, UserPlus, HandMetal,
} from "lucide-react"
import { cn } from "@/lib/utils"

export function ControlsBar({
  isTutor,
  onLeave,
  // Tutor controls for student microphones
  studentCount,
  onMuteAll,
  onUnmuteAll,
  // Session-level admin actions (tutor only)
  onRefreshAll,
  // Invite a second teacher to co-teach (tutor only)
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
  // Screen share privacy (tutor only)
  screenSharing,
  screenPrivate,
  onToggleScreenPrivacy,
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
  onInviteCoTutor: () => void
  onRequestToSpeak: () => void
  pptActive: boolean
  presentKind?: "slides" | "video" | null
  presentationIdx: number
  selectedCount: number
  hasNextSlide: boolean
  hasPrevSlide: boolean
  onShowUpload: () => void
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
  screenSharing: boolean
  screenPrivate: boolean
  onToggleScreenPrivacy: () => void
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

  return (
    <div className="flex items-center gap-2 w-full min-w-0 overflow-x-auto overflow-y-hidden">
      {isTutor ? (
        <TrackToggle
          source={Track.Source.Microphone}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors data-[enabled=false]:bg-rose-900/50 data-[enabled=false]:text-rose-400 whitespace-nowrap"
        >
          <Mic className="size-3.5" /> Mic
        </TrackToggle>
      ) : (
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium border whitespace-nowrap cursor-not-allowed",
              micEnabled
                ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/40"
                : "bg-zinc-800/80 text-zinc-500 border-zinc-700/60",
            )}
            title={micEnabled ? "Microphone is ON (controlled by tutor)" : "Microphone is OFF (controlled by tutor)"}
          >
            {micEnabled ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
            Mic ({micEnabled ? "on" : "off"} · tutor controlled)
          </div>
          {/* When muted, a student can ask the tutor to turn their mic on. */}
          {!micEnabled && (
            <button
              onClick={onRequestToSpeak}
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap"
              title="Ask your tutor to turn your microphone on"
            >
              <HandMetal className="size-3.5" /> Request to speak
            </button>
          )}
        </div>
      )}

      <TrackToggle
        source={Track.Source.Camera}
        className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors data-[enabled=false]:bg-rose-900/50 data-[enabled=false]:text-rose-400 whitespace-nowrap"
      >
        <Camera className="size-3.5" /> Camera
      </TrackToggle>

      {/* Background blur — toggles a server-side blur processor on the local
          camera track so other participants see the blurred background too.
          First click lazy-loads the MediaPipe processor (~1-2 MB). */}
      <button
        onClick={onToggleBlur}
        disabled={blurBusy}
        className={cn(
          "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border",
          blurEnabled
            ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
            : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent",
          blurBusy && "opacity-60 cursor-wait",
        )}
        title={
          blurEnabled
            ? "Turn background blur off"
            : "Blur your background — students and tutor see the blurred feed"
        }
      >
        <Sparkles className="size-3.5" />
        {blurEnabled ? "Blur on" : "Blur"}
      </button>

      <TrackToggle
        source={Track.Source.ScreenShare}
        className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors data-[enabled=true]:bg-emerald-900/50 data-[enabled=true]:text-emerald-400 whitespace-nowrap"
        title={
          isTutor
            ? "Share your screen with the class"
            : "Share your screen — your tutor can pin and show it to everyone"
        }
      >
        <Monitor className="size-3.5" /> Screen
      </TrackToggle>

      {/* Privacy toggle — only shown while the tutor is actively screen-sharing.
          "Private" hides the feed from students (they see a placeholder) without
          stopping the underlying track, so the tutor can switch without any
          start/stop lag. */}
      {isTutor && screenSharing && (
        <button
          onClick={onToggleScreenPrivacy}
          className={cn(
            "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border",
            screenPrivate
              ? "bg-zinc-700 text-zinc-200 border-zinc-500"
              : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent"
          )}
          title={
            screenPrivate
              ? "Screen is private — students see a placeholder. Click to make it visible."
              : "Click to hide your screen from students while you prepare."
          }
        >
          {screenPrivate ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {screenPrivate ? "Private" : "Visible"}
        </button>
      )}

      {/* Tutor-only: bulk mic controls for students. */}
      {isTutor && (
        <>
          <button
            onClick={onMuteAll}
            disabled={studentCount === 0}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-rose-900/40 hover:text-rose-300 text-zinc-300 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-zinc-300"
            title={
              studentCount === 0
                ? "No students in the room yet"
                : "Turn off every student's microphone."
            }
            aria-label="Mute all students"
          >
            <MicOff className="size-3.5" />
            Mute all
          </button>
          <button
            onClick={onUnmuteAll}
            disabled={studentCount === 0}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-emerald-900/40 hover:text-emerald-300 text-zinc-300 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-zinc-300"
            title={
              studentCount === 0
                ? "No students in the room yet"
                : "Turn on every student's microphone."
            }
            aria-label="Unmute all students"
          >
            <Mic className="size-3.5" />
            Unmute all
          </button>
        </>
      )}

      {/* Tutor-only: invite another teacher to co-teach this session. They get a
          notification (and email if configured) with a link that opens the
          classroom with full tutor controls — works mid-session. */}
      {isTutor && (
        <button
          onClick={onInviteCoTutor}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors whitespace-nowrap"
          title="Invite another teacher to co-teach this session"
          aria-label="Invite a second teacher"
        >
          <UserPlus className="size-3.5" />
          Invite teacher
        </button>
      )}

      {/* Tutor-only recovery: refresh every client (including the tutor) — useful
          when the room freezes and data/video has stopped flowing. */}
      {isTutor && (
        <button
          onClick={onRefreshAll}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-amber-900/40 hover:text-amber-300 text-zinc-300 transition-colors whitespace-nowrap"
          title="Reload the classroom for every student and yourself. Use if the session freezes."
          aria-label="Refresh the classroom for everyone"
        >
          <RefreshCw className="size-3.5" />
          Refresh all
        </button>
      )}

      {/* Tutor-only: start, pause, or resume server-side recording. Each pause/resume
          cycle produces a separate MP4 segment in S3, so breaks and private
          chats don't end up in the saved recording. */}
      {isTutor && (
        <button
          onClick={onToggleRecording}
          disabled={recordingBusy}
          className={cn(
            "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border",
            !recordingStarted
              ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-700/40"
              : recordingPaused
                ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-700/40"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent",
            recordingBusy && "opacity-60 cursor-wait",
          )}
          title={
            !recordingStarted
              ? "Start recording this session"
              : recordingPaused
                ? "Resume recording — starts a new segment"
                : "Pause recording — the next break won't be saved"
          }
        >
          {!recordingStarted ? (
            <>
              <Circle className="size-3.5 fill-current" />
              Start Rec
            </>
          ) : recordingPaused ? (
            <>
              <Circle className="size-3.5 fill-current" />
              Resume Rec
            </>
          ) : (
            <>
              <Pause className="size-3.5" />
              Pause Rec
            </>
          )}
        </button>
      )}

      {/* Tutor-only: ping every student's screen with a visual flash. BSL
          classrooms can't rely on sound, so the flash is the attention cue.
          Hooked up to the class by default; per-group nudges live in the
          breakout monitor. */}
      {isTutor && (
        <button
          onClick={onNudgeClass}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-amber-500/25 hover:text-amber-300 text-zinc-300 transition-colors whitespace-nowrap"
          title="Flash a short visual attention alert on every student's screen"
          aria-label="Nudge the whole class"
        >
          <Bell className="size-3.5" />
          Nudge class
        </button>
      )}

      {/* Tutor-only: open/close the shared whiteboard. Only the tutor draws by
          default; use "Let them write" on the board to hand control to students.
          Disabled while slides/video are live — one shared surface at a time. */}
      {isTutor && (
        <button
          onClick={onToggleWhiteboard}
          disabled={pptActive && !whiteboardActive}
          className={cn(
            "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border",
            whiteboardActive
              ? "bg-amber-500/25 text-amber-300 border-amber-500/50"
              : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent",
            pptActive && !whiteboardActive && "opacity-40 cursor-not-allowed"
          )}
          title={
            pptActive && !whiteboardActive
              ? "Stop presenting before opening the whiteboard"
              : whiteboardActive
                ? "Close the whiteboard for everyone"
                : "Open a shared whiteboard — tutor draws; students view until you let them write"
          }
        >
          <PencilLine className="size-3.5" />
          {whiteboardActive ? "Close Board" : "Whiteboard"}
        </button>
      )}

      {/* Breakouts — tutor opens/edits group assignments. Once live, a second
          button reveals the monitor grid so the tutor can observe every
          student's signing across all groups at once. */}
      {isTutor && (
        <button
          onClick={onOpenBreakoutsPanel}
          className={cn(
            "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border",
            breakoutsActive
              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
              : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent"
          )}
          title={
            breakoutsActive
              ? "Edit, visit, or end the active breakouts"
              : "Split students into small groups for pair or group work"
          }
        >
          <Users2 className="size-3.5" />
          {breakoutsActive ? "Breakouts live" : "Breakouts"}
        </button>
      )}

      {isTutor && breakoutsActive && (
        <button
          onClick={onOpenBreakoutMonitor}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-emerald-900/40 hover:text-emerald-300 text-zinc-300 transition-colors whitespace-nowrap"
          title="Open the monitor grid — watch every student's signing across all groups"
        >
          <Eye className="size-3.5" />
          Monitor
        </button>
      )}

      {/* ── Presentation controls (tutor only) ── */}
      {isTutor && !pptActive && !whiteboardActive && (
        <button
          onClick={onShowUpload}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors whitespace-nowrap"
          title="Upload and present slides or a video"
        >
          <Presentation className="size-3.5" /> Present
        </button>
      )}

      {/* Slide-specific controls — only while presenting a deck. Video is driven
          by the native <video> controls inside the player, so next/prev/counter
          don't apply and we show a compact "Playing video" badge instead. */}
      {isTutor && pptActive && presentKind === "slides" && (
        <>
          {/* Prev slide — moves back in the tutor's chosen subset */}
          <button
            onClick={onPptPrev}
            disabled={!hasPrevSlide}
            className="flex items-center justify-center size-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous slide"
          >
            <ChevronLeft className="size-4" />
          </button>

          {/* Slide counter — shows position within the selected subset. Dashes
              when the currently-shown slide has been excluded from the sequence. */}
          <span
            className="text-xs text-zinc-400 bg-zinc-800 px-2.5 h-9 flex items-center rounded-xl whitespace-nowrap font-mono"
            title={
              presentationIdx < 0
                ? "Current slide isn't in your selection — use the tray to include it, or press next/prev"
                : "Position within the slides you selected"
            }
          >
            {presentationIdx < 0 ? "—" : presentationIdx + 1} / {selectedCount}
          </span>

          {/* Next slide */}
          <button
            onClick={onPptNext}
            disabled={!hasNextSlide}
            className="flex items-center justify-center size-9 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next slide"
          >
            <ChevronRight className="size-4" />
          </button>
        </>
      )}

      {isTutor && pptActive && presentKind === "video" && (
        <span
          className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 h-9 rounded-xl whitespace-nowrap"
          title="Use the video's own play/seek controls — everything syncs to students automatically."
        >
          <Film className="size-3.5" />
          Playing video
        </span>
      )}

      {isTutor && pptActive && (
        <>
          {/* Hand pointer toggle (works over slides or video) */}
          <button
            onClick={onTogglePointer}
            className={cn(
              "flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium transition-colors whitespace-nowrap border",
              pointerMode
                ? "bg-amber-500/25 text-amber-300 border-amber-500/50 animate-pulse"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-transparent"
            )}
            title={pointerMode ? "Turn off hand pointer" : "Point at the presentation — students will see a hand follow your cursor"}
          >
            <Pointer className="size-3.5" />
            {pointerMode ? "Pointing" : "Pointer"}
          </button>

          {/* Stop presentation (slides or video) */}
          <button
            onClick={onPptStop}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium bg-amber-900/40 hover:bg-amber-900/70 text-amber-400 border border-amber-700/40 transition-colors whitespace-nowrap"
            title={presentKind === "video" ? "Stop playing the video" : "Stop presenting slides"}
          >
            <X className="size-3.5" /> {presentKind === "video" ? "End Video" : "End Slides"}
          </button>
        </>
      )}

      <button
        onClick={onLeave}
        className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors whitespace-nowrap ml-auto sticky right-0 shrink-0 shadow-[-12px_0_12px_-8px_rgb(9_9_11)]"
      >
        <PhoneOff className="size-3.5" /> Leave
      </button>
    </div>
  )
}
