"use client"

/**
 * Two camera panels sharing one stage box.
 *
 * When a teacher puts a student on the stage to sign, the student goes *beside*
 * the teacher rather than in place of them: a signed exchange has two people in
 * it, and a layout that swaps one for the other shows the class only half the
 * conversation. Both panels stay on screen for everyone in the room.
 *
 * The axis is measured from this box with `useStageSplit`, the same rule the
 * stage itself uses, so the two halves come out as close to 16:9 as the box
 * allows — a landscape camera in a tall narrow half is the "portrait video"
 * complaint, and it costs a signer the width their hands need. On a wide box
 * that means left/right with the teacher on the LEFT (the Deaf-culture
 * convention the rest of the room follows); on a tall one it stacks with the
 * teacher on top.
 *
 * Panels are handed in as nodes so this file owns geometry only — who is shown
 * in each half, and how, stays with the caller.
 */

import { useRef } from "react"
import { cn } from "@/lib/utils"
import { useStageSplit, splitDirectionClass, splitDividerClass } from "./useStageSplit"

export function StagePair({
  containerRef,
  first,
  second,
}: {
  /**
   * Fullscreen target. It belongs on the pair rather than on either panel —
   * going fullscreen on half of a two-way conversation drops the other half.
   */
  containerRef?: React.RefObject<HTMLDivElement | null>
  /** Leading panel: the teacher — left on a wide stage, top on a tall one. */
  first: React.ReactNode
  /** Trailing panel: the student who was selected to sign. */
  second: React.ReactNode
}) {
  // Measured separately from the stage: this box is often already half of it
  // (beside slides or a whiteboard), so the stage's own axis says nothing about
  // which way *this* one should be cut.
  const boxRef = useRef<HTMLDivElement>(null)
  const { axis } = useStageSplit(boxRef)

  return (
    <div ref={containerRef} className="w-full h-full bg-zinc-950">
      <div ref={boxRef} className={cn("flex w-full h-full", splitDirectionClass(axis))}>
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden relative bg-zinc-900">
          {first}
        </div>
        <div
          className={cn(
            "flex-1 min-w-0 min-h-0 overflow-hidden relative bg-zinc-900 border-zinc-800",
            splitDividerClass(axis),
          )}
        >
          {second}
        </div>
      </div>
    </div>
  )
}
