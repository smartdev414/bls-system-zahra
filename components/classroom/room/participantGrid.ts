"use client"

/**
 * Fitting the whole class into one box, with nobody off the edge.
 *
 * The participants strip used to be a single row that scrolled sideways. In a
 * signing classroom that is the wrong shape twice over. A teacher reading the
 * room for comprehension has to swipe to find the student who didn't follow,
 * and by the time they've found them the moment has passed; students watching
 * each other sign only ever see the handful of classmates who happen to fall
 * inside the viewport. "Everyone can see each other" is not a nice-to-have in a
 * Deaf classroom — it is the lesson — so the rule here is absolute: every tile
 * is on screen, always, and no gesture is needed to reach any of them.
 *
 * That turns the layout into a packing problem. Given a box and N tiles that
 * all want to be 16:9, choose the column count that makes the tiles as large as
 * they can be while still fitting. Trying every column count is the whole
 * algorithm — N is a class, not a stadium, so the loop is a few dozen
 * iterations at worst and runs only when the box or the roster changes.
 *
 * Note what this deliberately does *not* do: it doesn't fix the grid at two
 * rows. Two rows is the right answer for a wide, short box — which is where the
 * "seven at the top and seven at the bottom" picture comes from — and it is a
 * bad answer for the tall column the strip becomes when it sits beside the
 * teacher, where fourteen tiles across two rows come out barely a hundred
 * pixels wide. Hands don't read at that size. Picking the shape from the box
 * gives the 7×2 arrangement exactly when the box is that shape, and gives
 * bigger faces the rest of the time.
 */

import { useEffect, useState, type RefObject } from "react"

/** Cameras publish 16:9, and a tile that matches means no letterboxing. */
export const TILE_ASPECT = 16 / 9

export type GridPack = {
  cols: number
  rows: number
  /** Rounded down, so accumulated fractions can never overflow the box. */
  tileWidth: number
  tileHeight: number
}

const EMPTY: GridPack = { cols: 1, rows: 0, tileWidth: 0, tileHeight: 0 }

/**
 * Largest uniform 16:9 tiles that fit `count` of them inside `width × height`.
 *
 * `gap` is the space *between* tiles, not around them — padding is the caller's
 * business, and it must be subtracted from the box before it gets here.
 */
export function packGrid(
  width: number,
  height: number,
  count: number,
  { aspect = TILE_ASPECT, gap = 6 }: { aspect?: number; gap?: number } = {},
): GridPack {
  if (count <= 0 || !(width > 0) || !(height > 0)) return EMPTY

  let best = EMPTY
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const availW = width - gap * (cols - 1)
    const availH = height - gap * (rows - 1)
    // More columns than the box has room for once gaps are paid for. Every
    // larger `cols` is worse still, but `rows` falls as `cols` climbs so the
    // heights aren't monotonic — keep going rather than breaking out.
    if (availW <= 0 || availH <= 0) continue

    // Whichever axis runs out first decides the tile size.
    const tileWidth = Math.min(availW / cols, (availH / rows) * aspect)
    if (tileWidth > best.tileWidth) {
      best = {
        cols,
        rows,
        tileWidth: Math.floor(tileWidth),
        tileHeight: Math.floor(tileWidth / aspect),
      }
    }
  }

  // A box too small to hold even one tile at a whole pixel still has to render
  // something — returning zeroes would collapse every tile to nothing and lose
  // the roster entirely. One column, floored to a visible minimum, and the
  // container's own overflow rule decides what happens next.
  if (best.tileWidth < 1) {
    return { cols: 1, rows: count, tileWidth: 1, tileHeight: 1 }
  }
  return best
}

/**
 * Below this the in-tile chrome — name plate, group chip, screen-share badge —
 * covers more of the face than it explains. Past it the tile keeps the video,
 * the raised-hand badge and the "you" ring, and drops the rest.
 *
 * A class large enough to push tiles under this is exactly the class where the
 * teacher most needs the faces, so the badges are what gives way, not the video.
 */
export const DENSE_TILE_WIDTH = 104

/** Rounded corners and ring widths that hold their proportions as tiles shrink. */
export function tileRadius(tileWidth: number): number {
  return Math.max(4, Math.min(12, Math.round(tileWidth * 0.055)))
}

/**
 * Live content-box size of an element.
 *
 * ResizeObserver fires once on observe, so the first measurement arrives
 * without a synchronous setState in the effect body. Until then the size is
 * zero, which `packGrid` reports as an empty pack — the caller's cue to render
 * nothing rather than one frame of a wrongly-shaped grid.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      setSize((prev) =>
        // Sub-pixel jitter from a neighbouring panel animating open would
        // otherwise re-pack the grid on every frame of the animation.
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width, height },
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return size
}
