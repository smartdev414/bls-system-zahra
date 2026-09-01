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
import type { CSSProperties } from "react"

export type SplitAxis = "row" | "column"

/** The measured stage, plus the axis chosen for it. */
export type StageSplit = {
  axis: SplitAxis | null
  /** Stage box in CSS pixels; 0 until the first measurement lands. */
  width: number
  height: number
}

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
export function useStageSplit(ref: React.RefObject<HTMLElement | null>): StageSplit {
  const [split, setSplit] = useState<StageSplit>({ axis: null, width: 0, height: 0 })

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

      setSplit((current) => {
        const preferred: SplitAxis = rowCost <= columnCost ? "row" : "column"
        const axis =
          current.axis === null || preferred === current.axis
            ? preferred
            : Math.abs(rowCost - columnCost) < HYSTERESIS
              ? current.axis
              : preferred
        if (axis === current.axis && width === current.width && height === current.height) {
          return current
        }
        return { axis, width, height }
      })
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return split
}

/**
 * How wide (or tall) the teacher's camera panel should be next to slides or the
 * whiteboard.
 *
 * Cutting the stage exactly in half is the wrong rule for the camera half. What
 * lands in it is a 16:9 picture, so half of a stage that isn't ~32:9 gives the
 * camera a box the wrong shape — the picture shrinks to fit inside it and the
 * leftover becomes black bars that belong to nobody. On a phone or a portrait
 * tablet, where the stage stacks, that is most of the camera panel: the signer
 * comes out small *and* the slide underneath loses height it could have used.
 *
 * So give the camera the share that makes its panel 16:9 and hand everything
 * else to the content. Where geometry won't allow it — a stage close to square,
 * where a 16:9 camera panel would need well over half the stage — the share is
 * capped and the picture letterboxes exactly as it does today, which is the
 * best either panel can do with that box. The floor keeps a signer readable if
 * the stage is ever wide enough for the ideal share to come out tiny.
 *
 * Returns empty styles until the stage has been measured, so the first paint
 * keeps the caller's breakpoint classes rather than committing to a share.
 */
const CAMERA_MIN_SHARE = 0.25
const CAMERA_MAX_SHARE = 0.5

export function landscapeCameraSplit(
  split: StageSplit,
): { camera: CSSProperties; content: CSSProperties } {
  const { axis, width, height } = split
  if (axis === null || width < 1 || height < 1) return { camera: {}, content: {} }

  // Along the split axis the two panels divide `total`; `across` is the
  // dimension they both keep in full.
  const total  = axis === "row" ? width : height
  const across = axis === "row" ? height : width
  const ideal  = axis === "row" ? across * TARGET_ASPECT : across / TARGET_ASPECT

  const share = Math.min(Math.max(ideal / total, CAMERA_MIN_SHARE), CAMERA_MAX_SHARE)
  // Rounded so a sub-pixel resize doesn't rewrite the style on every frame.
  const percent = Math.round(share * 1000) / 10

  return {
    camera:  { flex: `0 0 ${percent}%` },
    content: { flex: "1 1 0%" },
  }
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
