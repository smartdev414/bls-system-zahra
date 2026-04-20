"use client"

import { useState, useEffect, useRef } from "react"
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
  Megaphone, UserMinus,
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
}) {
  const { localParticipant } = useLocalParticipant()
  const allParticipants      = useParticipants()
  const camTracks            = useTracks([Track.Source.Camera])

  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
