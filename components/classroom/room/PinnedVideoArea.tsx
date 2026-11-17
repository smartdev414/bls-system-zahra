"use client"

import {
  useParticipants,
  useTracks,
  VideoTrack,
  isTrackReference,
} from "@livekit/components-react"
import { Track } from "livekit-client"
import {
  ArrowLeft, Megaphone, Info, Maximize2, Minimize2, VideoOff,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { localCameraClassName, isLiveVideo } from "@/components/classroom/localCameraView"
import { OwnScreenShare } from "./OwnScreenShare"
import { RaisedHandBadge } from "./RaisedHandBadge"

export function PinnedVideoArea({
  identity,
  localIdentity,
  containerRef,
  isFullscreen,
  onToggleFullscreen,
  onUnpin,
  unpinLabel = "Back to tutor",
  unpinTitle = "Back to tutor — return to the tutor's camera view",
  showSpotlight,
  spotlightActive,
  onToggleSpotlight,
  handRaised,
  onLowerHand,
  fit = "cover",
  hideName = false,
  notRecorded = false,
}: {
  identity: string
  localIdentity: string
  /**
   * Fullscreen target. Omitted when this tile is one half of a `StagePair` —
   * there the pair owns the ref, so fullscreen keeps both signers on screen.
   */
  containerRef?: React.RefObject<HTMLDivElement | null>
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onUnpin: () => void
  /**
   * Wording for the dismiss button. The default assumes this tile replaced the
   * tutor's camera; beside the tutor in a `StagePair` it hasn't, so the caller
   * passes something that doesn't promise a view the viewer is already looking at.
   */
  unpinLabel?: string
  unpinTitle?: string
  showSpotlight?: boolean
  spotlightActive?: boolean
  onToggleSpotlight?: () => void
  handRaised?: boolean
  // When provided (tutor view), the "Hand raised" pill becomes a button that
  // lowers the pinned participant's hand on click.
  onLowerHand?: (identity: string) => void
  /**
   * How a camera fills this tile.
   *
   * "cover" is right when the tile *is* the stage: a 16:9 camera in a 16:9
   * stage crops next to nothing, and filling the frame looks better than bars.
   *
   * "contain" is right when the tile is one half of a split stage next to
   * slides or a whiteboard. There the panel is nothing like 16:9, so cover
   * crops hard — and it crops a signer, taking their hands off the sides of
   * the frame. It also put the two halves visibly out of step with each other,
   * one filled and one letterboxed, which is what teachers reported: a tall
   * narrow camera beside wide short slides.
   */
  fit?: "cover" | "contain"
  /**
   * Leave the name off this tile. A classmate shown to the whole class by the
   * tutor appears on every student's screen face only — the class sees who is
   * signing without their name going up with them.
   */
  hideName?: boolean
  /**
   * Tutor only, while recording: this student opted out of recordings, so
   * showing them to the class pauses the recording until they're off screen.
   */
  notRecorded?: boolean
}) {
  const allParticipants = useParticipants()
  const camTracks       = useTracks([Track.Source.Camera])
  const screenTracks    = useTracks([Track.Source.ScreenShare])

  const participant = allParticipants.find((p) => p.identity === identity)
  const camRef      = camTracks.find(
    (t) => t.participant.identity === identity && isLiveVideo(t)
  )
  const screenRef   = screenTracks.find(
    (t) => t.participant.identity === identity && isTrackReference(t)
  )
  const active      = screenRef ?? camRef
  const displayName = hideName ? "Classmate" : participant?.name ?? identity
  const mirrorLocalCamera = identity === localIdentity && !screenRef

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-full bg-zinc-950 overflow-hidden group",
        handRaised && "ring-4 ring-inset ring-amber-400",
      )}
    >
      {screenRef && identity === localIdentity ? (
        <OwnScreenShare trackRef={screenRef} />
      ) : active ? (
        <VideoTrack
          trackRef={active}
          className={localCameraClassName(
            mirrorLocalCamera,
            // A screen share is never cropped — its content is the point.
            // A camera follows `fit`; see the note on the prop.
            screenRef || fit === "contain"
              ? "w-full h-full object-contain"
              : "w-full h-full object-cover",
          )}
        />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
          <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-3xl font-bold">
            {hideName ? "?" : displayName[0]?.toUpperCase()}
          </div>
          <span className="text-sm">{displayName} · Camera off</span>
        </div>
      )}

      <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
        <button
          onClick={onUnpin}
          className="flex items-center gap-1.5 bg-black/70 hover:bg-black/90 text-white text-xs font-semibold px-3 py-2 rounded-full backdrop-blur-sm transition-colors shadow-lg ring-1 ring-white/10"
          title={unpinTitle}
          aria-label={unpinTitle}
        >
          <ArrowLeft className="size-3.5" />
          {unpinLabel}
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

        {notRecorded && (
          <span
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full bg-black/70 text-white ring-1 ring-white/10 backdrop-blur-sm shadow-lg"
            title="This student isn't recorded. Showing them to the class pauses the recording until you stop."
          >
            <VideoOff className="size-3.5" />
            {spotlightActive ? "Recording paused" : "Not recorded"}
          </span>
        )}

        {/* Discoverability hint: only shown when spotlight is available but not active */}
        {showSpotlight && !spotlightActive && !notRecorded && (
          <span
            className="hidden md:flex items-center gap-1 text-[0.625rem] text-white/70 bg-black/40 px-2 py-1 rounded-full backdrop-blur-sm pointer-events-none"
            aria-hidden
          >
            <Info className="size-3" />
            Only you see this camera until you click &ldquo;Show to whole class&rdquo;
          </span>
        )}
      </div>

      <div className="absolute bottom-10 left-3 flex items-center gap-2">
        {!hideName && (
          <span className="bg-black/60 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full">
            {handRaised && <span className="mr-1" aria-hidden>✋</span>}
            {displayName}
          </span>
        )}
        {handRaised && (
          onLowerHand ? (
            <button
              onClick={() => onLowerHand(identity)}
              className="group/hand flex items-center gap-1 bg-amber-400 hover:bg-rose-500 text-zinc-950 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-full shadow-md ring-2 ring-amber-300/60 hover:ring-rose-300/60 transition-colors"
              title={`Click to lower ${displayName}'s hand`}
              aria-label={`Lower ${displayName}'s hand`}
            >
              <span className="text-base leading-none" aria-hidden>✋</span>
              <span className="group-hover/hand:hidden">Hand raised</span>
              <span className="hidden group-hover/hand:inline">Lower hand</span>
            </button>
          ) : (
            <span
              className="flex items-center gap-1 bg-amber-400 text-zinc-950 text-sm font-semibold px-3 py-1.5 rounded-full shadow-md ring-2 ring-amber-300/60"
              title={`${displayName} raised their hand`}
              aria-label={`${displayName} has their hand raised`}
            >
              <span className="text-base leading-none" aria-hidden>✋</span>
              Hand raised
            </span>
          )
        )}
      </div>

      {handRaised && (
        <RaisedHandBadge
          name={displayName}
          size={56}
          className="absolute top-3 right-3"
          onLower={onLowerHand ? () => onLowerHand(identity) : undefined}
        />
      )}

      <button
        onClick={onToggleFullscreen}
        className={cn(
          "absolute top-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70 text-white rounded-lg p-1.5 backdrop-blur-sm",
          handRaised ? "right-[4.75rem]" : "right-3",
        )}
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  )
}
