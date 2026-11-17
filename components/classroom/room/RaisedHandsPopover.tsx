"use client"

import { useRef, useEffect } from "react"
import { Hand, X } from "lucide-react"
import type { RaisedHand } from "./types"

function RaisedHandRow({
  hand,
  position,
  onLower,
}: {
  hand: RaisedHand
  position: number
  onLower: (identity: string) => void
}) {
  const initials = hand.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
  return (
    <div className="px-4 py-2.5 flex items-center gap-2.5">
      <span className="w-4 shrink-0 text-[0.6875rem] font-bold text-amber-400 text-center">
        {position}
      </span>
      <div className="size-8 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-[0.6875rem] font-bold shrink-0">
        {initials}
      </div>
      <p className="flex-1 min-w-0 text-xs font-semibold text-zinc-100 truncate">{hand.name}</p>
      <button
        onClick={() => onLower(hand.identity)}
        className="h-6 px-2 text-[0.6875rem] rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1 shrink-0"
        title={`Lower ${hand.name}'s hand`}
      >
        Lower
      </button>
    </div>
  )
}

// A queue, not a bag: `raisedHands` is already in the order hands went up (see
// ClassroomRoom's HAND_TOPIC handler), so position 1 is who has been waiting
// longest — exactly who a tutor taking turns wants to call on next.
export function RaisedHandsPopover({
  raisedHands,
  onLowerHand,
  onLowerAllHands,
  onClose,
}: {
  raisedHands: RaisedHand[]
  onLowerHand: (identity: string) => void
  onLowerAllHands: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl z-50 flex flex-col"
    >
      <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
          <Hand className="size-3.5 text-amber-400" />
          Raised Hands {raisedHands.length > 0 && (
            <span className="text-amber-400">({raisedHands.length})</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {raisedHands.length > 1 && (
            <button
              onClick={onLowerAllHands}
              className="text-[0.6875rem] font-semibold text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/30 border border-amber-500/40 px-2 py-0.5 rounded-full transition-colors"
              title="Lower every raised hand"
            >
              Lower all
            </button>
          )}
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {raisedHands.length === 0 ? (
          <div className="py-10 px-4 text-center text-xs text-zinc-500">
            No hands raised.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {raisedHands.map((h, i) => (
              <RaisedHandRow key={h.identity} hand={h} position={i + 1} onLower={onLowerHand} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
