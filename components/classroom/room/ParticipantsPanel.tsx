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
  Megaphone, UserMinus, GripVertical, HandMetal, Minus, Plus,
} from "lucide-react"
import { cn } from "@/lib/utils"

type MenuState = {
  identity: string
  name: string
  isTutor: boolean
  isLocal: boolean
  x: number
  y: number
}

type TileSize = "sm" | "md" | "lg" | "xl"
const TILE_SIZE_ORDER: TileSize[] = ["sm", "md", "lg", "xl"]

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
  raisedHandIds,
  onLowerHand,
  visibleIdentities,
  groupLabels,
  tileSize,
  onTileSizeChange,
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
}) {
  const { localParticipant } = useLocalParticipant()
  const allParticipants      = useParticipants()
  const camTracks            = useTracks([Track.Source.Camera])

  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Tutor-only: manual display order established by drag-and-drop. When
  // populated, this takes precedence over the default (camera-on first) sort.
  // New participants fall to the end; leavers are pruned on next effect tick.
  const [manualOrder, setManualOrder] = useState<string[] | null>(null)
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
          const trackRef = camTracks.find(
            (t) => t.participant.identity === p.identity && isTrackReference(t),
          )
          return { p, trackRef, camOn: !!trackRef }
        }),
    [allParticipants, camTracks, visibleIdentities, localParticipant.identity],
  )

  // Keep manualOrder in sync with the live participant list: drop anyone who
  // left, append any newcomer to the end of the manual ordering. Derived in
  // render rather than in an effect — see React docs "Adjusting state when a
  // prop changes". The bail-out condition ensures setState is called at most
  // once per participant-set change, so we don't infinite-loop.
  if (manualOrder) {
    const liveIds = new Set(allParticipants.map((p) => p.identity))
    const filtered = manualOrder.filter((id) => liveIds.has(id))
    const appended = allParticipants
      .map((p) => p.identity)
      .filter((id) => !filtered.includes(id))
    if (filtered.length !== manualOrder.length || appended.length > 0) {
      setManualOrder([...filtered, ...appended])
    }
  }

  const sorted = useMemo(() => {
    if (manualOrder) {
      const byId = new Map(withTracks.map((w) => [w.p.identity, w]))
      const ordered = manualOrder
        .map((id) => byId.get(id))
        .filter((w): w is NonNullable<typeof w> => !!w)
      // Safety net: include any tile that isn't in the manual order yet
      // (e.g., between a newcomer joining and the sync effect running).
      const seen = new Set(ordered.map((w) => w.p.identity))
      withTracks.forEach((w) => {
        if (!seen.has(w.p.identity)) ordered.push(w)
      })
      return ordered
    }
    return [...withTracks].sort((a, b) => {
      if (a.camOn !== b.camOn) return a.camOn ? -1 : 1
      if (a.p.metadata === "tutor" && b.p.metadata !== "tutor") return -1
      if (b.p.metadata === "tutor" && a.p.metadata !== "tutor") return 1
      return 0
    })
  }, [manualOrder, withTracks])

  function reorder(sourceId: string, targetId: string) {
    if (sourceId === targetId) return
    const baseOrder = manualOrder ?? sorted.map((w) => w.p.identity)
    const without = baseOrder.filter((id) => id !== sourceId)
    const targetIdx = without.indexOf(targetId)
    if (targetIdx === -1) return
    const next = [...without.slice(0, targetIdx), sourceId, ...without.slice(targetIdx)]
    setManualOrder(next)
  }

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
      <div className="shrink-0 w-36 border-r border-zinc-800 flex flex-col">
        <button
          onClick={onToggleCollapse}
          className="flex-1 px-3 flex flex-col justify-center hover:bg-zinc-800/60 transition-colors text-left"
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

        {/* Tile size selector — bigger / smaller. Persists per-user via the
            parent. Disabled at the boundaries. */}
        <div className="flex items-center gap-1 px-2 pb-1.5">
          <TileSizeButton
            label="Smaller"
            disabled={tileSize === TILE_SIZE_ORDER[0]}
            onClick={() => {
              const i = TILE_SIZE_ORDER.indexOf(tileSize)
              if (i > 0) onTileSizeChange(TILE_SIZE_ORDER[i - 1])
            }}
            icon={<Minus className="size-3" />}
          />
          <span className="text-[9px] text-zinc-500 font-mono uppercase flex-1 text-center">
            {tileSize}
          </span>
          <TileSizeButton
            label="Bigger"
            disabled={tileSize === TILE_SIZE_ORDER[TILE_SIZE_ORDER.length - 1]}
            onClick={() => {
              const i = TILE_SIZE_ORDER.indexOf(tileSize)
              if (i < TILE_SIZE_ORDER.length - 1) onTileSizeChange(TILE_SIZE_ORDER[i + 1])
            }}
            icon={<Plus className="size-3" />}
          />
        </div>
      </div>

      <div className="overflow-x-auto flex items-center gap-2 px-2 py-2 min-w-0 flex-1">
        {sorted.map(({ p, trackRef, camOn }) => {
          const isLocal     = p.identity === localParticipant.identity
          const isPinned    = pinnedId === p.identity
          const isTutor     = p.metadata === "tutor"
          const handRaised  = raisedHandIds.has(p.identity)
          const displayName = p.name ?? p.identity
          // Only the local tutor can drag, and only student tiles can be
          // dragged or used as a drop target — the tutor tile stays put.
          const canDrag = isLocalTutor && !isTutor
          const isDragging = draggingId === p.identity
          const isDropTarget = dropTargetId === p.identity && draggingId && draggingId !== p.identity

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
              className={cn(
                "relative rounded-xl overflow-hidden transition-all h-full aspect-square bg-zinc-800 border shrink-0 group",
                isTutor
                  ? "border-amber-500/30 cursor-default"
                  : isPinned
                  ? "border-primary ring-1 ring-primary/30 cursor-pointer"
                  : "border-zinc-700 hover:border-zinc-500 cursor-pointer",
                isDragging && "opacity-40",
                isDropTarget && "ring-2 ring-sky-400 border-sky-400",
              )}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({
                  identity: p.identity,
                  name: displayName,
                  isTutor,
                  isLocal,
                  x: e.clientX,
                  y: e.clientY,
                })
              }}
            >
              {canDrag && (
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

              {/* Breakout-group chip — tiny colour tag so a tutor can tell which
                  breakout a student is in without opening the manager. */}
              {!isTutor && groupLabels?.get(p.identity) && (
                <div
                  className="absolute top-1 left-1 text-[8px] px-1.5 py-0.5 rounded-full font-bold border max-w-[80%] truncate"
                  style={{
                    background:   `${groupLabels.get(p.identity)!.color}33`,
                    color:        groupLabels.get(p.identity)!.color,
                    borderColor:  `${groupLabels.get(p.identity)!.color}66`,
                  }}
                  title={`In ${groupLabels.get(p.identity)!.name}`}
                >
                  {groupLabels.get(p.identity)!.name}
                </div>
              )}

              {/* Raised-hand badge — only students raise hands, so this never
                  collides with the "Tutor" tag. Bottom-right corner so it's
                  away from the pinned badge and drag-handle hint. For tutors
                  the badge is a button that lowers the student's hand. */}
              {handRaised && !isTutor && (
                isLocalTutor && onLowerHand ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onLowerHand(p.identity) }}
                    className="absolute bottom-1 right-1 z-20 flex items-center justify-center size-6 rounded-full bg-amber-400 hover:bg-rose-500 text-zinc-950 hover:text-white shadow-md ring-2 ring-amber-300/70 hover:ring-rose-300/70 animate-pulse hover:animate-none transition-colors group/hand"
                    title={`Click to lower ${displayName}'s hand`}
                    aria-label={`Lower ${displayName}'s hand`}
                  >
                    <HandMetal className="size-3.5 group-hover/hand:hidden" />
                    <span className="hidden group-hover/hand:block text-[10px] font-bold">✕</span>
                  </button>
                ) : (
                  <div
                    className="absolute bottom-1 right-1 z-20 flex items-center justify-center size-6 rounded-full bg-amber-400 text-zinc-950 shadow-md ring-2 ring-amber-300/70 animate-pulse pointer-events-none"
                    title={`${displayName} raised their hand`}
                    aria-label={`${displayName} has their hand raised`}
                  >
                    <HandMetal className="size-3.5" />
                  </div>
                )
              )}
            </div>
          )
        })}

        {allParticipants.length === 0 && (
          <p className="text-xs text-zinc-600 px-3 whitespace-nowrap">No one else here yet</p>
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
  onRemove: () => void
}) {
  // Show Remove / Spotlight only for tutors, and never on the tutor's own card
  // or on another tutor (we only have one tutor per session, but keep it safe).
  const canManage = isLocalTutor && !menu.isLocal && !menu.isTutor
  const showPin = !menu.isTutor // tutor tile can't be pinned
  const showPopOut = !isPoppedOut

  // Clamp menu position within the viewport so it doesn't overflow off-screen.
  const approxWidth = 220
  const approxHeight = 200
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
