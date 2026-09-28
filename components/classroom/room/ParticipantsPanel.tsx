"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import {
  useParticipants,
  useLocalParticipant,
  useTracks,
  VideoTrack,
  isTrackReference,
} from "@livekit/components-react"
import { Track } from "livekit-client"
import {
  Users, Maximize2, ChevronDown, PictureInPicture2, Pin, PinOff,
  Megaphone, UserMinus, GripVertical, Minus, Plus, Mic, MicOff, Monitor,
  Bell, MoreHorizontal,
  Hand, LayoutGrid, Presentation,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { localCameraClassName, isLiveVideo } from "@/components/classroom/localCameraView"
import {
  packGrid, useElementSize, tileRadius, DENSE_TILE_WIDTH,
} from "./participantGrid"
import { RaisedHandBadge } from "./RaisedHandBadge"

type MenuState = {
  identity: string
  name: string
  isTutor: boolean
  isLocal: boolean
  micEnabled: boolean
  x: number
  y: number
}

type TileSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl"
const TILE_SIZE_ORDER: TileSize[] = ["sm", "md", "lg", "xl", "2xl", "3xl"]

export function ParticipantsPanel({
  pinnedId,
  onPin,
  collapsed,
  onToggleCollapse,
  isLocalTutor,
  spotlightedId,
  onToggleSpotlight,
  onPopOut,
  poppedOutIds,
  onRemoveParticipant,
  onToggleParticipantMic,
  onNudgeParticipant,
  raisedHandIds,
  onLowerHand,
  visibleIdentities,
  groupLabels,
  tileSize,
  onTileSizeChange,
  orientation = "side",
  classOrder,
  onReorderClass,
  onToggleOwnHand,
  view = "spotlight",
  onToggleView,
}: {
  pinnedId: string | null
  onPin: (identity: string | null) => void
  collapsed: boolean
  onToggleCollapse: () => void
  isLocalTutor: boolean
  spotlightedId: string | null
  onToggleSpotlight: (identity: string) => void
  onPopOut: (identity: string) => void
  poppedOutIds: string[]
  onRemoveParticipant: (identity: string, name: string) => void
  onToggleParticipantMic?: (identity: string, name: string, enabled: boolean) => void
  // Tutor-only: flash an attention alert on this one student's screen. Nobody
  // else in the room sees it.
  onNudgeParticipant?: (identity: string, name: string) => void
  raisedHandIds: Set<string>
  onLowerHand?: (identity: string) => void
  // Breakout-aware: when provided, only tiles whose identity is in the set are
  // rendered. Tutors normally pass `null` (see everyone); students during
  // breakouts pass the set of group-mates + tutor.
  visibleIdentities?: Set<string> | null
  // Small colour-coded group label per identity — shown as a chip on the tile
  // so tutors can see which group anyone is in at a glance.
  groupLabels?: Map<string, { name: string; color: string }> | null
  // Per-user persisted tile size. Drives both the strip height (set by the
  // parent) and the in-tile chrome scaling here.
  tileSize: TileSize
  onTileSizeChange: (next: TileSize) => void
  /**
   * Where the parent has put this panel. "side" is a tall column beside the
   * stage — the normal desktop case, and the one feedback #20 asked for. Only
   * a viewport too narrow to give the stage and the class a column each falls
   * back to "bottom". It changes the chrome (a vertical rail when collapsed
   * rather than a horizontal bar); the grid itself needs no telling, because
   * it reads the shape of whatever box it lands in.
   */
  orientation?: "side" | "bottom"
  /**
   * The room's manual tile order, set by the tutor dragging and mirrored to
   * everyone. Null means nobody has dragged and the default sort stands.
   *
   * It is owned by the room rather than by this panel because the order has to
   * be the same for the teacher and the class — a teacher who rearranged their
   * own copy ended up pointing at "the third one along" and meaning a different
   * student to everyone watching.
   */
  classOrder: string[] | null
  /** Tutor only: publish a new order to the room. Absent for students. */
  onReorderClass?: (order: string[]) => void
  /**
   * Student only: raise or lower their own hand. Given, the student's own tile
   * carries the button in its top-right corner — where the class asked for it,
   * on the video they are already watching, rather than up in the header.
   */
  onToggleOwnHand?: () => void
  /**
   * "gallery" means the parent has handed this panel the whole stage: nobody
   * is shown big, and every tile grows to share the space. The collapse and
   * resize controls go away there — there is nothing to collapse to and no
   * band to resize — leaving the switch back to spotlight.
   */
  view?: "spotlight" | "gallery"
  onToggleView?: () => void
}) {
  const { localParticipant } = useLocalParticipant()
  const allParticipants      = useParticipants()
  const camTracks            = useTracks([Track.Source.Camera])
  const screenTracks         = useTracks([Track.Source.ScreenShare])

  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // The box the tiles are packed into. Measured rather than assumed: the same
  // panel is a tall column beside the stage on a laptop and a wide band beneath
  // it on a phone, and the grid shape follows from which one it got.
  const [gridBoxRef, gridBox] = useElementSize<HTMLDivElement>()

  // Drag state is local — it is the gesture in progress, not the result. The
  // result (`classOrder`) belongs to the room and arrives as a prop.
  const [draggingId,  setDraggingId]  = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  // Dismiss the context menu on outside click / escape.
  useEffect(() => {
    if (!menu) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null)
    }
    window.addEventListener("mousedown", onDocClick)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDocClick)
      window.removeEventListener("keydown", onKey)
    }
  }, [menu])

  const withTracks = useMemo(
    () =>
      allParticipants
        .filter((p) => {
          if (!visibleIdentities) return true
          // Always show the local participant so a student doesn't lose their
          // own tile even if they weren't placed in any group.
          if (p.identity === localParticipant.identity) return true
          return visibleIdentities.has(p.identity)
        })
        .map((p) => {
          const screenRef = screenTracks.find(
            (t) => t.participant.identity === p.identity && isTrackReference(t),
          )
          const camRef = camTracks.find(
            (t) => t.participant.identity === p.identity && isLiveVideo(t),
          )
          // Every tile prefers the camera, for everyone looking at it. The
          // preference used to depend on who was looking — your own tile showed
          // your camera, everyone else's showed their screen share — so a
          // sharing teacher saw themselves signing in a slot where the class saw
          // a cropped desktop. The strip is the register of who is in the room,
          // which means faces, in the same landscape frame, in the same slot for
          // all of us; the share is already on the stage, and the "Screen" chip
          // below says who is driving it.
          const isLocal  = p.identity === localParticipant.identity
          // Never your own share, though: it would draw the page inside itself
          // (see OwnScreenShare). With your camera off you get the avatar and
          // the "Sharing" chip instead.
          const trackRef = camRef ?? (isLocal ? undefined : screenRef)
          const camOn = !!trackRef
          return {
            p,
            trackRef,
            camOn,
            sharingScreen: !!screenRef,
            // A shared desktop is not 16:9 and cropping it to fill the tile
            // leaves an unreadable corner — fit the whole frame instead.
            isScreenTrack: !camRef && !!screenRef,
            // Only mirror when the tile is actually showing your own camera.
            showingOwnCamera: isLocal && !!camRef,
          }
        }),
    [allParticipants, camTracks, screenTracks, visibleIdentities, localParticipant.identity],
  )

  // One order, computed the same way on every client — nothing here asks who is
  // looking. Sorting yourself to the front gave each person a different strip
  // from everyone else's, so "third along" meant a different student to the
  // teacher than to the class, and the teacher's own view of the room stopped
  // matching the one they were teaching to. Your own tile is marked instead
  // (see `isLocal` below), which is all that finding yourself needs now the
  // whole class is on screen at once.
  const defaultSorted = useMemo(() => {
    return [...withTracks].sort((a, b) => {
      if (a.camOn !== b.camOn) return a.camOn ? -1 : 1
      if (a.p.metadata === "tutor" && b.p.metadata !== "tutor") return -1
      if (b.p.metadata === "tutor" && a.p.metadata !== "tutor") return 1
      // Identity as the final tiebreak: LiveKit hands each client its own
      // participant list in its own order, so without this two people with
      // their cameras on could still sit in opposite slots.
      return a.p.identity < b.p.identity ? -1 : a.p.identity > b.p.identity ? 1 : 0
    })
  }, [withTracks])

  // The tutor's arrangement, applied on top. It is read rather than stored:
  // someone who left simply isn't in `withTracks` any more, and a newcomer the
  // tutor hasn't placed yet falls in behind those they have, in the default
  // order. Nothing is written back, so the list the room agreed on stays the
  // list the room agreed on — every client turns it into the same grid.
  const sorted = useMemo(() => {
    if (!classOrder || classOrder.length === 0) return defaultSorted
    const rank = new Map(classOrder.map((id, i) => [id, i]))
    // Stable sort, so tiles with no place in the arrangement keep the default
    // order among themselves instead of falling back on LiveKit's per-client one.
    return [...defaultSorted].sort((a, b) => {
      const ra = rank.get(a.p.identity) ?? Number.POSITIVE_INFINITY
      const rb = rank.get(b.p.identity) ?? Number.POSITIVE_INFINITY
      return ra === rb ? 0 : ra - rb
    })
  }, [classOrder, defaultSorted])

  // Every tile that exists, sized to fit the box it has — see `packGrid`. The
  // gap is deliberately tight: at fourteen-plus tiles the space between them
  // competes directly with the size of the faces inside them.
  const GRID_GAP = 6
  const pack = useMemo(
    () => packGrid(gridBox.width, gridBox.height, sorted.length, { gap: GRID_GAP }),
    [gridBox.width, gridBox.height, sorted.length],
  )
  const dense = pack.tileWidth < DENSE_TILE_WIDTH
  // Large enough to scan at a glance. Floored so a packed class still gets a
  // real emoji, capped so it doesn't swallow a generous tile.
  const handBadgePx = Math.max(28, Math.min(52, Math.round(pack.tileWidth * 0.32)))
  const radius = tileRadius(pack.tileWidth)
  // Name plates grow with the tile, so a gallery-sized face doesn't carry a
  // 9px caption; a packed strip keeps the old small sizes.
  const nameFontPx = dense ? 7 : Math.max(9, Math.min(14, Math.round(pack.tileWidth * 0.045)))

  function reorder(sourceId: string, targetId: string) {
    if (!onReorderClass || sourceId === targetId) return
    // Built from what is on screen right now rather than from `classOrder`, so
    // a drop onto someone who joined after the last drag still lands: everyone
    // visible has a place in this list, which is what the room is sent.
    const baseOrder = sorted.map((w) => w.p.identity)
    const without = baseOrder.filter((id) => id !== sourceId)
    const targetIdx = without.indexOf(targetId)
    if (targetIdx === -1) return
    onReorderClass([...without.slice(0, targetIdx), sourceId, ...without.slice(targetIdx)])
  }

  if (collapsed) {
    // Beside the stage the panel collapses to a vertical rail, so the handle
    // that brings the class back is on the edge the class went behind.
    if (orientation === "side") {
      return (
        <button
          onClick={onToggleCollapse}
          className="h-full w-full flex flex-col items-center gap-2 bg-zinc-900 hover:bg-zinc-800/60 transition-colors py-3"
          title="Show the class"
        >
          <ChevronDown className="size-3 text-zinc-500 rotate-90 shrink-0" />
          <Users className="size-3.5 text-primary shrink-0" />
          <span
            className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider whitespace-nowrap"
            style={{ writingMode: "vertical-rl" }}
          >
            {allParticipants.length} in room
          </span>
        </button>
      )
    }
    return (
      <button
        onClick={onToggleCollapse}
        className="h-full w-full flex items-center justify-start gap-2 bg-zinc-900 hover:bg-zinc-800/60 transition-colors px-4 text-left"
        title="Show the class"
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
    <div className="flex flex-col h-full w-full min-w-0 min-h-0 overflow-hidden bg-zinc-900">
      {/* One compact bar across the top, so the whole of the rest of the panel
          belongs to the faces. The old chrome was a 144px column down the left,
          which cost a column of tiles for the life of every lesson. */}
      <div className="shrink-0 h-8 flex items-center gap-1.5 px-2 border-b border-zinc-800">
        {view === "gallery" ? (
          <div className="flex items-center gap-1.5 min-w-0 flex-1 text-zinc-300">
            <Users className="size-3.5 text-primary shrink-0" />
            <span className="text-[11px] font-bold truncate">
              Gallery · {allParticipants.length}
            </span>
          </div>
        ) : (
          <button
            onClick={onToggleCollapse}
            className="flex items-center gap-1.5 min-w-0 flex-1 hover:text-white text-zinc-300 transition-colors text-left"
            title="Hide the class"
          >
            <Users className="size-3.5 text-primary shrink-0" />
            <span className="text-[11px] font-bold truncate">
              Class · {allParticipants.length}
            </span>
            <ChevronDown
              className={cn("size-3 text-zinc-500 shrink-0", orientation === "side" && "-rotate-90")}
            />
          </button>
        )}

        {onToggleView && (
          <button
            type="button"
            onClick={onToggleView}
            className="shrink-0 h-6 px-2 rounded-md flex items-center gap-1 text-[11px] font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition-colors"
            title={
              view === "gallery"
                ? "Spotlight view — put the stage back"
                : "Gallery view — everyone the same size, nobody big on the stage"
            }
          >
            {view === "gallery"
              ? <Presentation className="size-3" />
              : <LayoutGrid className="size-3" />}
            {view === "gallery" ? "Spotlight" : "Gallery"}
          </button>
        )}

        {/* Sizes the panel itself, not the tiles — the tiles are sized by how
            many people are in the room and how much room the panel has. Giving
            the class more of the stage is the only lever that still makes
            sense once nothing is ever scrolled out of sight. */}
        {view !== "gallery" && (
        <div className="flex items-center gap-1 shrink-0">
          <TileSizeButton
            label="Give the class less room"
            disabled={tileSize === TILE_SIZE_ORDER[0]}
            onClick={() => {
              const i = TILE_SIZE_ORDER.indexOf(tileSize)
              if (i > 0) onTileSizeChange(TILE_SIZE_ORDER[i - 1])
            }}
            icon={<Minus className="size-3" />}
          />
          <TileSizeButton
            label="Give the class more room"
            disabled={tileSize === TILE_SIZE_ORDER[TILE_SIZE_ORDER.length - 1]}
            onClick={() => {
              const i = TILE_SIZE_ORDER.indexOf(tileSize)
              if (i < TILE_SIZE_ORDER.length - 1) onTileSizeChange(TILE_SIZE_ORDER[i + 1])
            }}
            icon={<Plus className="size-3" />}
          />
        </div>
        )}
      </div>

      {/* The packing box. `overflow-hidden` rather than `auto` is the point of
          the whole change: there is no axis to scroll on, because everything
          already fits. */}
      <div
        ref={gridBoxRef}
        className="flex-1 min-w-0 min-h-0 overflow-hidden p-1.5 flex items-center justify-center"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${pack.cols}, ${pack.tileWidth}px)`,
            gridAutoRows: `${pack.tileHeight}px`,
            gap: GRID_GAP,
          }}
        >
        {sorted.map(({ p, trackRef, camOn, sharingScreen, isScreenTrack, showingOwnCamera }) => {
          const isLocal     = p.identity === localParticipant.identity
          const isPinned    = pinnedId === p.identity
          const isTutor     = p.metadata === "tutor"
          const handRaised  = raisedHandIds.has(p.identity)
          const displayName = p.name ?? p.identity
          // Only the local tutor can drag, and only student tiles can be
          // dragged or used as a drop target — the tutor tile stays put.
          const canDrag = isLocalTutor && !isTutor && !!onReorderClass
          const isDragging = draggingId === p.identity
          const isDropTarget = dropTargetId === p.identity && draggingId && draggingId !== p.identity
          const ownHandButton = !isTutor && !!onToggleOwnHand

          return (
            <div
              key={p.identity}
              draggable={canDrag}
              onDragStart={(e) => {
                if (!canDrag) return
                setDraggingId(p.identity)
                e.dataTransfer.effectAllowed = "move"
                // Some browsers need a payload set or onDrop won't fire.
                try { e.dataTransfer.setData("text/plain", p.identity) } catch {}
              }}
              onDragEnd={() => {
                setDraggingId(null)
                setDropTargetId(null)
              }}
              onDragOver={(e) => {
                if (!isLocalTutor || isTutor || !draggingId || draggingId === p.identity) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                if (dropTargetId !== p.identity) setDropTargetId(p.identity)
              }}
              onDragLeave={() => {
                setDropTargetId((prev) => (prev === p.identity ? null : prev))
              }}
              onDrop={(e) => {
                if (!isLocalTutor || isTutor) return
                e.preventDefault()
                const source = draggingId ?? e.dataTransfer.getData("text/plain")
                if (source) reorder(source, p.identity)
                setDraggingId(null)
                setDropTargetId(null)
              }}
              // Sized by the packer, not by the strip's height. A fixed
              // `aspect-video` box that filled the row's height is what forced
              // the overflow in the first place: past the tenth student the
              // eleventh simply went off the end.
              style={{ width: pack.tileWidth, height: pack.tileHeight, borderRadius: radius }}
              className={cn(
                "relative overflow-hidden transition-all bg-zinc-800 border group",
                isTutor
                  ? "border-amber-500/30 cursor-default"
                  : isPinned
                  ? "border-primary ring-1 ring-primary/30 cursor-pointer"
                  : "border-zinc-700 hover:border-zinc-500 cursor-pointer",
                isDragging && "opacity-40",
                isDropTarget && "ring-2 ring-sky-400 border-sky-400",
                // Marks your own tile without moving it out of the room-wide
                // order. Inset so it reads on top of a light camera frame.
                isLocal && !isPinned && "ring-2 ring-inset ring-white/70",
                // Raised hand wins the frame — the gold edge is what a teacher
                // actually sees when scanning twenty faces for who asked.
                handRaised && !isTutor && !isDropTarget &&
                  "border-amber-400 border-2 ring-2 ring-inset ring-amber-300",
              )}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({
                  identity: p.identity,
                  name: displayName,
                  isTutor,
                  isLocal,
                  micEnabled: p.isMicrophoneEnabled,
                  x: e.clientX,
                  y: e.clientY,
                })
              }}
            >
              {/* The actions menu used to open only on right-click, which a
                  tutor on an iPad or touch laptop cannot do — pin, spotlight,
                  mute and remove were simply out of reach. Same menu, opened
                  from a visible button. */}
              {isLocalTutor && !isLocal && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({
                      identity: p.identity,
                      name: displayName,
                      isTutor,
                      isLocal,
                      micEnabled: p.isMicrophoneEnabled,
                      x: r.left,
                      y: r.bottom,
                    })
                  }}
                  className="absolute bottom-1 right-1 z-30 size-6 rounded-md bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                  title={`Actions for ${displayName}`}
                  aria-label={`Actions for ${displayName}`}
                  aria-haspopup="menu"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              )}
              {canDrag && !dense && (
                // Top-left hint; tutor tile occupies this slot, but student
                // tiles (the only draggable ones) don't, so there's no clash.
                <div
                  className="absolute top-1 left-1 z-20 bg-black/50 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  title="Drag to reorder"
                  aria-hidden
                >
                  <GripVertical className="size-3 text-white/90" />
                </div>
              )}
              {camOn && trackRef ? (
                <>
                  <VideoTrack
                    trackRef={trackRef}
                    className={localCameraClassName(
                      showingOwnCamera,
                      isScreenTrack
                        ? "w-full h-full object-contain"
                        : "w-full h-full object-cover",
                    )}
                  />
                  {/* The name plate survives every tile size — a teacher
                      scanning a full class needs to name the student who looks
                      lost, and it costs one strip along an edge the face isn't
                      using. Everything else gives way first. */}
                  <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/80 to-transparent px-1 pb-0.5 pointer-events-none">
                    <p
                      className="text-white truncate font-medium leading-tight"
                      style={{ fontSize: nameFontPx }}
                    >
                      {handRaised && !isTutor && (
                        <span className="mr-0.5" aria-hidden>✋</span>
                      )}
                      {isLocal ? "You" : displayName}
                      {isTutor && <span className="ml-0.5 text-amber-400">•</span>}
                    </p>
                  </div>
                </>
              ) : (
                // Camera-off placeholder. The initial scales with the tile so a
                // packed class doesn't end up with circles clipped by their own
                // frames — at 60px a fixed 32px avatar plus a name is taller
                // than the tile it sits in.
                <div className="flex flex-col items-center justify-center h-full gap-0.5 px-1 overflow-hidden">
                  <div
                    className="rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shrink-0"
                    style={{
                      width:    Math.max(14, Math.round(pack.tileHeight * 0.38)),
                      height:   Math.max(14, Math.round(pack.tileHeight * 0.38)),
                      fontSize: Math.max(8,  Math.round(pack.tileHeight * 0.2)),
                    }}
                  >
                    {displayName[0]?.toUpperCase()}
                  </div>
                  <p
                    className="font-semibold text-white truncate max-w-full px-1 leading-tight"
                    style={{ fontSize: nameFontPx }}
                  >
                    {handRaised && !isTutor && (
                      <span className="mr-0.5" aria-hidden>✋</span>
                    )}
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

              {/* Word-badges below. Each of them is dropped on a packed grid —
                  they'd cover most of a small tile, and every one of them is
                  already said a second way that costs no pixels: pinned and
                  tutor tiles carry a coloured border, and a group becomes a
                  colour dot. Faces win the space; labels come back the moment
                  the class is small enough to afford them. */}
              {isPinned && !dense && (
                <div
                  className="absolute top-1 bg-primary text-primary-foreground text-[8px] px-1.5 py-0.5 rounded-full font-bold"
                  style={{
                    // A raised hand (or your own raise-hand button) takes this
                    // corner; the border already marks the pin, so just slide
                    // the label left of the badge.
                    right: handRaised || (isLocal && ownHandButton) ? handBadgePx + 6 : 4,
                  }}
                >
                  Pinned
                </div>
              )}

              {/* Shown on every sharer's tile, including a teacher's, and to
                  everyone. It used to be hidden on a remote teacher's tile, so
                  the class had no sign of who was driving the screen while the
                  teacher had one on their own. */}
              {sharingScreen && (
                <div
                  className={cn(
                    "absolute z-10 bg-emerald-600/90 text-white font-bold flex items-center gap-0.5",
                    dense
                      ? "top-0.5 left-0.5 rounded p-0.5"
                      : "bottom-7 left-1 text-[8px] px-1.5 py-0.5 rounded-full",
                  )}
                  title={isLocal ? "You are sharing your screen" : `${displayName} is sharing their screen`}
                >
                  <Monitor className="size-2.5" />
                  {!dense && (isLocal ? "Sharing" : "Screen")}
                </div>
              )}

              {isTutor && !dense && (
                <div className="absolute top-1 right-1 text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold border border-amber-500/30 z-10">
                  Tutor
                </div>
              )}

              {/* Breakout-group chip — tiny colour tag so a tutor can tell which
                  breakout a student is in without opening the manager. Shrinks
                  to a bare colour dot rather than disappearing: which group a
                  student is in is the one thing a tutor is scanning the grid
                  for while breakouts run. */}
              {!isTutor && groupLabels?.get(p.identity) && (
                <div
                  className={cn(
                    "absolute top-1 left-1 rounded-full font-bold border",
                    dense ? "size-2" : "text-[8px] px-1.5 py-0.5 max-w-[80%] truncate",
                  )}
                  style={{
                    background:   `${groupLabels.get(p.identity)!.color}33`,
                    color:        groupLabels.get(p.identity)!.color,
                    borderColor:  `${groupLabels.get(p.identity)!.color}66`,
                  }}
                  title={`In ${groupLabels.get(p.identity)!.name}`}
                >
                  {!dense && groupLabels.get(p.identity)!.name}
                </div>
              )}

              {/* Raised-hand badge — top-right. Never dropped, at any size:
                  a raised hand is the one thing in the grid asking for an
                  answer. Tutors can click the badge to lower it. */}
              {/* Your own raise-hand button, top-right of your own tile. Raised,
                  it is the same gold badge the tutor sees, and clicking it
                  lowers the hand again. */}
              {isLocal && ownHandButton && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleOwnHand?.()
                  }}
                  className={cn(
                    "absolute top-0.5 right-0.5 z-30 flex items-center justify-center rounded-full transition-colors",
                    handRaised
                      ? "bg-amber-400 text-zinc-950 ring-2 ring-white shadow-[0_0_12px_rgba(251,191,36,0.95)] hover:bg-rose-500 hover:text-white"
                      : "bg-black/60 text-amber-300 ring-1 ring-white/30 hover:bg-amber-400 hover:text-zinc-950",
                  )}
                  style={{ width: handBadgePx, height: handBadgePx }}
                  title={handRaised ? "Lower your hand" : "Raise your hand — your tutor will be notified"}
                  aria-label={handRaised ? "Lower hand" : "Raise hand"}
                  aria-pressed={handRaised}
                >
                  {handRaised ? (
                    <span className="leading-none" style={{ fontSize: Math.max(16, Math.round(handBadgePx * 0.72)) }} aria-hidden>✋</span>
                  ) : (
                    <Hand style={{ width: handBadgePx * 0.5, height: handBadgePx * 0.5 }} aria-hidden />
                  )}
                </button>
              )}

              {handRaised && !isTutor && (
                <>
                  <div
                    className="absolute inset-0 z-10 pointer-events-none bg-linear-to-bl from-amber-400/40 via-amber-400/5 to-transparent"
                    aria-hidden
                  />
                  {!(isLocal && ownHandButton) && <RaisedHandBadge
                    name={displayName}
                    size={handBadgePx}
                    className="absolute top-0.5 right-0.5"
                    onLower={
                      isLocalTutor && onLowerHand
                        ? () => onLowerHand(p.identity)
                        : undefined
                    }
                  />}
                </>
              )}
            </div>
          )
        })}
        </div>

        {allParticipants.length === 0 && (
          <p className="text-xs text-zinc-600 px-3 text-center">No one else here yet</p>
        )}
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          menuRef={menuRef}
          isLocalTutor={isLocalTutor}
          isPinned={pinnedId === menu.identity}
          isSpotlighted={spotlightedId === menu.identity}
          isPoppedOut={poppedOutIds.includes(menu.identity)}
          onPin={() => { onPin(menu.identity); setMenu(null) }}
          onUnpin={() => { onPin(null); setMenu(null) }}
          onPopOut={() => { onPopOut(menu.identity); setMenu(null) }}
          onToggleSpotlight={() => { onToggleSpotlight(menu.identity); setMenu(null) }}
          onToggleMic={
            onToggleParticipantMic
              ? () => {
                  onToggleParticipantMic(menu.identity, menu.name, !menu.micEnabled)
                  setMenu(null)
                }
              : undefined
          }
          onNudge={
            onNudgeParticipant
              ? () => { onNudgeParticipant(menu.identity, menu.name); setMenu(null) }
              : undefined
          }
          onRemove={() => { onRemoveParticipant(menu.identity, menu.name); setMenu(null) }}
        />
      )}
    </div>
  )
}

function ContextMenu({
  menu,
  menuRef,
  isLocalTutor,
  isPinned,
  isSpotlighted,
  isPoppedOut,
  onPin,
  onUnpin,
  onPopOut,
  onToggleSpotlight,
  onToggleMic,
  onNudge,
  onRemove,
}: {
  menu: MenuState
  menuRef: React.RefObject<HTMLDivElement | null>
  isLocalTutor: boolean
  isPinned: boolean
  isSpotlighted: boolean
  isPoppedOut: boolean
  onPin: () => void
  onUnpin: () => void
  onPopOut: () => void
  onToggleSpotlight: () => void
  onToggleMic?: () => void
  onNudge?: () => void
  onRemove: () => void
}) {
  // Show Remove / Spotlight only for tutors, and never on the tutor's own card
  // or on another tutor (we only have one tutor per session, but keep it safe).
  const canManage = isLocalTutor && !menu.isLocal && !menu.isTutor
  const showPin = !menu.isTutor // tutor tile can't be pinned
  const showPopOut = !isPoppedOut

  // Clamp menu position within the viewport so it doesn't overflow off-screen.
  const approxWidth = 220
  const approxHeight = 232
  const x = typeof window !== "undefined"
    ? Math.min(menu.x, window.innerWidth - approxWidth - 8)
    : menu.x
  const y = typeof window !== "undefined"
    ? Math.min(menu.y, window.innerHeight - approxHeight - 8)
    : menu.y

  return (
    <div
      ref={menuRef}
      className="fixed z-[70] min-w-[200px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 text-xs text-zinc-200"
      style={{ left: x, top: y }}
      role="menu"
    >
      <div className="px-3 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wide border-b border-zinc-800 mb-1 truncate">
        {menu.name}
      </div>

      {showPin && (
        isPinned ? (
          <MenuItem icon={<PinOff className="size-3.5" />} onClick={onUnpin}>
            Unpin from main view
          </MenuItem>
        ) : (
          <MenuItem icon={<Pin className="size-3.5" />} onClick={onPin}>
            Pin to main view
          </MenuItem>
        )
      )}

      {showPopOut && (
        <MenuItem icon={<PictureInPicture2 className="size-3.5" />} onClick={onPopOut}>
          Pop out video
        </MenuItem>
      )}

      {canManage && (
        <MenuItem
          icon={<Megaphone className="size-3.5" />}
          onClick={onToggleSpotlight}
          variant={isSpotlighted ? "warn" : "default"}
        >
          {isSpotlighted ? "Stop spotlighting" : "Spotlight for everyone"}
        </MenuItem>
      )}

      {canManage && onNudge && (
        <MenuItem icon={<Bell className="size-3.5" />} onClick={onNudge}>
          Nudge just this student
        </MenuItem>
      )}

      {canManage && onToggleMic && (
        <MenuItem
          icon={menu.micEnabled ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
          onClick={onToggleMic}
        >
          {menu.micEnabled ? "Turn microphone off" : "Turn microphone on"}
        </MenuItem>
      )}

      {canManage && (
        <>
          <div className="my-1 h-px bg-zinc-800" />
          <MenuItem
            icon={<UserMinus className="size-3.5" />}
            onClick={onRemove}
            variant="danger"
          >
            Remove from session
          </MenuItem>
        </>
      )}
    </div>
  )
}

function TileSizeButton({
  label,
  disabled,
  onClick,
  icon,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "size-5 rounded flex items-center justify-center transition-colors",
        disabled
          ? "bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
          : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300",
      )}
    >
      {icon}
    </button>
  )
}

function MenuItem({
  icon,
  onClick,
  children,
  variant = "default",
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  variant?: "default" | "danger" | "warn"
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
        variant === "danger"
          ? "text-rose-400 hover:bg-rose-950/40"
          : variant === "warn"
          ? "text-amber-400 hover:bg-amber-950/40"
          : "hover:bg-zinc-800"
      )}
      role="menuitem"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  )
}
