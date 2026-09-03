"use client"

import { cn } from "@/lib/utils"

/**
 * The raised-hand mark on a student tile. It has to read from across a packed
 * class grid, so the emoji is the whole signal — not a 14px icon in the corner.
 */
export function RaisedHandBadge({
  name,
  size,
  onLower,
  className,
}: {
  name: string
  /** Badge diameter in pixels. */
  size: number
  onLower?: () => void
  className?: string
}) {
  const emojiPx = Math.max(16, Math.round(size * 0.72))
  const crossPx = Math.max(12, Math.round(size * 0.42))

  const inner = (
    <>
      <span
        className={cn(
          "leading-none select-none drop-shadow-sm",
          onLower && "group-hover/hand:hidden",
        )}
        style={{ fontSize: emojiPx }}
        aria-hidden
      >
        ✋
      </span>
      {onLower && (
        <span
          className="hidden group-hover/hand:block font-black leading-none"
          style={{ fontSize: crossPx }}
        >
          ✕
        </span>
      )}
    </>
  )

  const shared = cn(
    "z-20 flex items-center justify-center rounded-full bg-amber-400 text-zinc-950",
    "shadow-[0_0_12px_rgba(251,191,36,0.95)] ring-2 ring-white",
    onLower &&
      "hover:bg-rose-500 hover:text-white hover:ring-rose-200 cursor-pointer group/hand transition-colors",
    !onLower && "pointer-events-none",
    className,
  )

  if (onLower) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onLower()
        }}
        className={shared}
        style={{ width: size, height: size }}
        title={`Click to lower ${name}'s hand`}
        aria-label={`Lower ${name}'s hand`}
      >
        {inner}
      </button>
    )
  }

  return (
    <div
      className={shared}
      style={{ width: size, height: size }}
      title={`${name} raised their hand`}
      aria-label={`${name} has their hand raised`}
    >
      {inner}
    </div>
  )
}
