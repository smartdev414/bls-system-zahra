"use client"

/**
 * Which way to cut the stage in half.
 *
 * The stage carries two things side by side: the teacher's camera and whatever
 * they are presenting. Splitting it left/right versus top/bottom was decided by
 * a CSS breakpoint on the *viewport* — stacked below 768px, side by side above
 * — and a viewport width says very little about the shape of the box the two
 * panels actually get.
 *
 * On an iPad held upright the viewport clears 768px, so the stage is cut down
 * the middle and each panel ends up far taller than it is wide. A landscape
 * camera dropped into a tall narrow box is mostly black bars, and it sits next
 * to a slide that is *also* mostly black bars, at a different ratio. On a phone
 * the same lesson stacks instead, and both panels come out wide and short. The
 * result is that the camera and the slides show up in visibly different shapes
 * from each other, and in different shapes for different people in the same
 * class — the "portrait next to landscape" report.
 *
 * So decide from the stage's own measured box instead: cut it along whichever
 * axis leaves the two halves closest to the shape their contents actually are.
 * A wide stage still splits left/right, which keeps the Deaf-culture convention
 * of the signer on the left; a tall one stacks with the signer on top, as
 * phones already did.
 */

import { useEffect, useState } from "react"

export type SplitAxis = "row" | "column"

/**
 * The shape each half is aiming for. Cameras publish 16:9, most modern decks
 * are 16:9, and a 4:3 deck in a 16:9 panel loses far less than a 16:9 deck in a
 * portrait one — so this is the right thing to centre on even for older decks.
 */
const TARGET_ASPECT = 16 / 9

/**
 * How much better the other axis has to look before we switch to it, in log
 * units (~13%). Without it a stage sitting near the crossover flips back and
 * forth while a side panel animates open, which is far more disruptive than
 * either layout.
 */
const HYSTERESIS = 0.12

/** Distance from the target shape, measured so 2× and ½× score the same. */
function cost(aspect: number): number {
  if (!(aspect > 0)) return Number.POSITIVE_INFINITY
  return Math.abs(Math.log(aspect / TARGET_ASPECT))
}

/**
 * Returns null until the stage has been measured, which is the caller's cue to
 * keep the existing breakpoint classes for the first paint. Committing to an
 * axis before measuring would show one frame of the wrong layout on every join.
 */
export function useStageSplit(ref: React.RefObject<HTMLElement | null>): SplitAxis | null {
  const [axis, setAxis] = useState<SplitAxis | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // ResizeObserver delivers an initial callback on observe, so the first
    // measurement arrives without a synchronous setState in the effect body.
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      if (width < 1 || height < 1) return

      // Halving along an axis halves that dimension for both panels.
      const rowCost = cost(width / (2 * height))
      const columnCost = cost((2 * width) / height)

      setAxis((current) => {
        const preferred: SplitAxis = rowCost <= columnCost ? "row" : "column"
        if (current === null) return preferred
        if (preferred === current) return current
        return Math.abs(rowCost - columnCost) < HYSTERESIS ? current : preferred
      })
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return axis
}

/** Flex direction for the stage row. Falls back to the viewport breakpoint. */
export function splitDirectionClass(axis: SplitAxis | null): string {
  if (axis === null) return "flex-col md:flex-row"
  return axis === "row" ? "flex-row" : "flex-col"
}

/**
 * The rule between the two panels, on whichever edge they now meet along.
 * Applied to the second panel, as the original breakpoint classes were.
 */
export function splitDividerClass(axis: SplitAxis | null): string {
  if (axis === null) return "border-t md:border-t-0 md:border-l"
  return axis === "row" ? "border-l" : "border-t"
}
