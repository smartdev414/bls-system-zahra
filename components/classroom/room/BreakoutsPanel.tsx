"use client"

import { useCallback, useMemo, useState } from "react"
import {
  Users2, Shuffle, Plus, Trash2, X, Play, Square, Pencil, Check, LogIn, LogOut, Timer,
  TimerReset,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { BreakoutGroup } from "./types"
import { BreakoutCountdown } from "./BreakoutCountdown"

// `identity` here is the *stable* user id (see BreakoutGroup.memberIds), not a
// per-connection LiveKit identity — that's what makes an assignment stick when
// a student drops off Wi-Fi and comes back.
type StudentInfo = { identity: string; name: string }

// Unattached = students not yet placed in a group (shown in a "Lobby" strip).
function buildInitialGroups(students: StudentInfo[], groupCount: number): BreakoutGroup[] {
  const shuffled = [...students].sort(() => Math.random() - 0.5)
  const count = Math.max(1, Math.min(groupCount, Math.max(1, shuffled.length)))
  const groups: BreakoutGroup[] = Array.from({ length: count }, (_, i) => ({
    id: `g-${Date.now()}-${i}`,
    name: `Group ${String.fromCharCode(65 + i)}`,
    memberIds: [],
  }))
  shuffled.forEach((s, idx) => {
    groups[idx % count].memberIds.push(s.identity)
  })
  return groups
}

export function BreakoutsPanel({
  students,
  active,
  initialGroups,
  visitingGroupId,
  endsAt,
  onStart,
  onUpdate,
  onVisit,
  onStop,
  onEndNow,
  onExtend,
  closingAt,
  onClose,
}: {
  students: StudentInfo[]
  active: boolean
  initialGroups: BreakoutGroup[]
  visitingGroupId: string | null
  endsAt: number | null
  onStart: (groups: BreakoutGroup[], durationMin: number | null) => void
  onUpdate: (groups: BreakoutGroup[]) => void
  onVisit: (groupId: string | null) => void
  /** Starts the wrap-up countdown before returning everyone to the main room. */
  onStop: () => void
  /** Skip the countdown and end immediately (tutor only). */
  onEndNow: () => void
  /** Push the deadline out by N minutes without recreating the rooms. */
  onExtend: (minutes: number) => void
  closingAt: number | null
  onClose: () => void
}) {
  const nameByIdentity = useMemo(
    () => new Map(students.map((s) => [s.identity, s.name])),
    [students]
  )

  const [groups, setGroups]             = useState<BreakoutGroup[]>(
    () => (initialGroups.length > 0 ? initialGroups : buildInitialGroups(students, 2))
  )
  const [durationMin, setDurationMin]   = useState<number | "">(10)
  const [extendMin, setExtendMin]       = useState<number | "">(5)
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [draftName, setDraftName]       = useState("")
  const [draggingId, setDraggingId]     = useState<string | null>(null)
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null)

  // When the upstream snapshot changes (e.g. breakouts just went live, or the
  // tutor pushed edits from another tab), pull the latest into local state so
  // the panel always reflects what students are actually seeing. Uses React's
  // compare-in-render pattern rather than an effect to avoid cascading renders.
  const [lastIncomingSnap, setLastIncomingSnap] = useState<string>("")
  const incomingSnap = JSON.stringify(initialGroups)
  if (initialGroups.length > 0 && incomingSnap !== lastIncomingSnap) {
    setLastIncomingSnap(incomingSnap)
    setGroups(initialGroups)
  }

  // Students present in the room but not yet placed in any group.
  const unassigned = useMemo(() => {
    const placed = new Set(groups.flatMap((g) => g.memberIds))
    return students.filter((s) => !placed.has(s.identity))
  }, [groups, students])

  // ── Helpers ────────────────────────────────────────────────────────────────

  const removeFromAllGroups = (list: BreakoutGroup[], identity: string) =>
    list.map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => id !== identity) }))

  const moveStudent = useCallback((identity: string, targetGroupId: string | null) => {
    setGroups((prev) => {
      const stripped = removeFromAllGroups(prev, identity)
      if (!targetGroupId) return stripped
      return stripped.map((g) =>
        g.id === targetGroupId
          ? { ...g, memberIds: g.memberIds.includes(identity) ? g.memberIds : [...g.memberIds, identity] }
          : g
      )
    })
  }, [])

  const addGroup = useCallback(() => {
    setGroups((prev) => [
      ...prev,
      {
        id: `g-${Date.now()}`,
        name: `Group ${String.fromCharCode(65 + prev.length)}`,
        memberIds: [],
      },
    ])
  }, [])

  const removeGroup = useCallback((id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id))
  }, [])

  const renameGroup = useCallback((id: string, name: string) => {
    const trimmed = name.trim() || "Unnamed group"
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name: trimmed } : g)))
  }, [])

  const reshuffle = useCallback(() => {
    const count = Math.max(1, groups.length || 2)
    setGroups((prev) => {
      const shuffled = [...students].sort(() => Math.random() - 0.5)
      const names = prev.map((g) => g.name)
      const ids   = prev.map((g) => g.id)
      const base: BreakoutGroup[] = Array.from({ length: count }, (_, i) => ({
        id: ids[i] ?? `g-${Date.now()}-${i}`,
        name: names[i] ?? `Group ${String.fromCharCode(65 + i)}`,
        memberIds: [],
      }))
      shuffled.forEach((s, idx) => base[idx % count].memberIds.push(s.identity))
      return base
    })
  }, [groups.length, students])

  // ── Commit helpers ─────────────────────────────────────────────────────────

  const commit = useCallback(() => {
    if (active) {
      onUpdate(groups)
    } else {
      const dur = typeof durationMin === "number" && durationMin > 0 ? durationMin : null
      onStart(groups, dur)
    }
  }, [active, durationMin, groups, onStart, onUpdate])

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const startDrag = (identity: string) => (e: React.DragEvent<HTMLButtonElement>) => {
    setDraggingId(identity)
    e.dataTransfer.effectAllowed = "move"
    try { e.dataTransfer.setData("text/plain", identity) } catch {}
  }
  const onZoneDragOver = (groupId: string | null) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (dropTargetGroupId !== (groupId ?? "__lobby__")) {
      setDropTargetGroupId(groupId ?? "__lobby__")
    }
  }
  const onZoneDrop = (groupId: string | null) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const id = draggingId ?? e.dataTransfer.getData("text/plain")
    if (id) moveStudent(id, groupId)
    setDraggingId(null)
    setDropTargetGroupId(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Users2 className="size-4 text-primary" />
            <h2 className="font-bold text-sm">
              {active ? "Breakout rooms are live" : "Set up breakout rooms"}
            </h2>
            {active && (
              <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                </span>
                LIVE
              </span>
            )}
            {active && <BreakoutCountdown endsAt={endsAt} closing={!!closingAt} />}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-zinc-800 shrink-0 flex-wrap">
          <button
            onClick={addGroup}
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            title="Add another group"
          >
            <Plus className="size-3.5" /> Add group
          </button>
          <button
            onClick={reshuffle}
            disabled={students.length === 0}
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Randomly redistribute all students across the current groups"
          >
            <Shuffle className="size-3.5" /> Auto-shuffle
          </button>

          {!active && (
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 ml-2">
              <Timer className="size-3.5" />
              <span>Duration</span>
              <input
                type="number"
                min={1}
                max={120}
                value={durationMin}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === "") setDurationMin("")
                  else {
                    const n = parseInt(v, 10)
                    setDurationMin(Number.isFinite(n) ? n : "")
                  }
                }}
                className="w-14 h-7 rounded-md bg-zinc-800 border border-zinc-700 px-2 text-xs text-white focus:outline-none focus:border-primary"
              />
              <span className="text-zinc-500">min (optional)</span>
            </label>
          )}

          {active && (
            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-zinc-800">
              <TimerReset className="size-3.5 text-zinc-400" />
              <span className="text-xs text-zinc-400">Add</span>
              <input
                type="number"
                min={1}
                max={60}
                value={extendMin}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === "") setExtendMin("")
                  else {
                    const n = parseInt(v, 10)
                    setExtendMin(Number.isFinite(n) ? n : "")
                  }
                }}
                className="w-12 h-7 rounded-md bg-zinc-800 border border-zinc-700 px-2 text-xs text-white focus:outline-none focus:border-primary"
                aria-label="Minutes to add to the breakout timer"
              />
              <button
                onClick={() => {
                  if (typeof extendMin === "number" && extendMin > 0) onExtend(extendMin)
                }}
                disabled={!(typeof extendMin === "number" && extendMin > 0)}
                className="flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-semibold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                title="Give every group more time — nobody is sent back to the main room"
              >
                Add min
              </button>
              {[5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => onExtend(n)}
                  className="px-2 h-7 rounded-lg text-[11px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  title={`Add ${n} minutes`}
                >
                  +{n}
                </button>
              ))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {active ? (
              <>
                <button
                  onClick={() => onUpdate(groups)}
                  className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                  title="Share these group assignments with every student in the class"
                >
                  <Check className="size-3.5" /> Share groups
                </button>
                {closingAt ? (
                  <>
                    <BreakoutCountdown endsAt={closingAt} closing />
                    <button
                      onClick={onEndNow}
                      className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
                      title="Return to the main room immediately"
                    >
                      <Square className="size-3.5" /> End now
                    </button>
                  </>
                ) : (
                  <button
                    onClick={onStop}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
                    title="Start a short countdown, then bring everyone back to the main room"
                  >
                    <Square className="size-3.5" /> End breakouts
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={commit}
                disabled={groups.length === 0 || groups.every((g) => g.memberIds.length === 0)}
                className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  groups.every((g) => g.memberIds.length === 0)
                    ? "Assign at least one student before starting"
                    : "Send students into their breakout rooms"
                }
              >
                <Play className="size-3.5" /> Start &amp; share groups
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">
          {/* Unassigned lobby */}
          <div
            onDragOver={onZoneDragOver(null)}
            onDrop={onZoneDrop(null)}
            className={cn(
              "rounded-xl border border-dashed p-3 mb-4 transition-colors",
              dropTargetGroupId === "__lobby__"
                ? "border-sky-400 bg-sky-500/10"
                : "border-zinc-700 bg-zinc-950/40"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Not yet assigned · {unassigned.length}
              </p>
              <p className="text-[10px] text-zinc-500">Drag into a group below, or drag back here to remove.</p>
            </div>
            {unassigned.length === 0 ? (
              <p className="text-xs text-zinc-600 italic px-1">Everyone has a group.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {unassigned.map((s) => (
                  <StudentChip
                    key={s.identity}
                    name={s.name}
                    dragging={draggingId === s.identity}
                    onDragStart={startDrag(s.identity)}
                    onDragEnd={() => { setDraggingId(null); setDropTargetGroupId(null) }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Groups */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {groups.map((g) => {
              const memberChips = g.memberIds
                .map((id) => ({ identity: id, name: nameByIdentity.get(id) ?? id }))
                .filter((m) => !!m.name)
              const isVisiting = visitingGroupId === g.id
              const isDropTarget = dropTargetGroupId === g.id

              return (
                <div
                  key={g.id}
                  onDragOver={onZoneDragOver(g.id)}
                  onDrop={onZoneDrop(g.id)}
                  className={cn(
                    "rounded-xl border p-3 flex flex-col gap-2 transition-colors",
                    isDropTarget
                      ? "border-sky-400 bg-sky-500/10"
                      : isVisiting
                        ? "border-emerald-500/50 bg-emerald-500/5"
                        : "border-zinc-800 bg-zinc-950/40"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {editingId === g.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          renameGroup(g.id, draftName)
                          setEditingId(null)
                        }}
                        className="flex-1 flex items-center gap-1"
                      >
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onBlur={() => { renameGroup(g.id, draftName); setEditingId(null) }}
                          className="flex-1 h-7 rounded-md bg-zinc-800 border border-zinc-700 px-2 text-sm font-bold text-white focus:outline-none focus:border-primary"
                        />
                      </form>
                    ) : (
                      <>
                        <h3 className="flex-1 text-sm font-bold text-white truncate">{g.name}</h3>
                        <button
                          onClick={() => { setEditingId(g.id); setDraftName(g.name) }}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-white"
                          title="Rename group"
                        >
                          <Pencil className="size-3" />
                        </button>
                      </>
                    )}
                    <span className="text-[10px] text-zinc-500 font-mono">{g.memberIds.length}</span>
                    {active && (
                      isVisiting ? (
                        <button
                          onClick={() => onVisit(null)}
                          className="flex items-center gap-1 px-2 h-6 rounded-md text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                          title="Leave this group — students stop hearing you"
                        >
                          <LogOut className="size-3" />
                          Leave
                        </button>
                      ) : (
                        <button
                          onClick={() => onVisit(g.id)}
                          disabled={g.memberIds.length === 0}
                          className="flex items-center gap-1 px-2 h-6 rounded-md text-[10px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Join this group — your audio goes to its students and you hear theirs"
                        >
                          <LogIn className="size-3" />
                          Visit
                        </button>
                      )
                    )}
                    <button
                      onClick={() => removeGroup(g.id)}
                      className="p-1 rounded hover:bg-rose-900/40 text-zinc-500 hover:text-rose-300"
                      title="Remove this group (students fall back to unassigned)"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>

                  <div
                    className={cn(
                      "min-h-14 rounded-md p-2 flex flex-wrap gap-1.5 bg-zinc-900/70 border border-zinc-800/60"
                    )}
                  >
                    {memberChips.length === 0 ? (
                      <p className="text-[11px] text-zinc-600 italic">Drop students here</p>
                    ) : (
                      memberChips.map((m) => (
                        <StudentChip
                          key={m.identity}
                          name={m.name}
                          dragging={draggingId === m.identity}
                          onDragStart={startDrag(m.identity)}
                          onDragEnd={() => { setDraggingId(null); setDropTargetGroupId(null) }}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {students.length === 0 && (
            <p className="text-center text-xs text-zinc-500 mt-6">
              No students in the room yet — invite some first.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function StudentChip({
  name,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  name: string
  dragging: boolean
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
}) {
  return (
    <button
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "flex items-center gap-1.5 px-2 h-7 rounded-full text-[11px] font-medium bg-zinc-800 text-zinc-200 border border-zinc-700 cursor-grab active:cursor-grabbing hover:bg-zinc-700",
        dragging && "opacity-40"
      )}
      title="Drag to another group"
    >
      <span className="size-4 rounded-full bg-primary/30 text-[9px] font-bold flex items-center justify-center text-primary">
        {name[0]?.toUpperCase()}
      </span>
      <span className="truncate max-w-[10ch]">{name}</span>
    </button>
  )
}
