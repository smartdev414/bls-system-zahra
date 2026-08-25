"use client"

/**
 * Where the slide actually is, inside the panel that holds it.
 *
 * A slide is letterboxed: the PDF canvas and the `<video>` are both sized to
 * fit their panel while keeping their own aspect ratio, so there are black bars
 * down the sides or along the top and bottom depending on which is relatively
 * wider. How thick those bars are depends entirely on the shape of the panel —
 * and every participant's panel is a different shape. The chat sidebar is open
 * for one person and closed for another; a phone stacks the layout vertically
 * where a laptop puts the camera and the slide side by side; pinning a student
 * changes the split again.
 *
 * That is why a pointer normalised against the *panel* lands somewhere else on
 * the slide for every person in the room. This hook measures the drawn content
 * instead, in coordinates relative to the panel, so both ends of the pointer —
 * the tutor turning a cursor position into a slide fraction, and every student
 * turning that fraction back into a position — can agree on the same rectangle.
 *
 * Returns null until both elements are laid out, which is the signal to fall
 * back to the panel rather than place the pointer against a rectangle of zero.
 */

import { useEffect, useState } from "react"

export type ContentBox = {
  /** Offset from the host's top-left, in CSS pixels. */
  left: number
  top: number
  width: number
  height: number
}

function sameBox(a: ContentBox | null, b: ContentBox | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  // Sub-pixel churn from a resize animation should not re-render the room.
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

/** The measurement, tagged with what it was measured against. */
type Measurement = { el: HTMLElement; box: ContentBox | null }

export function useSlideContentBox(
  hostRef: React.RefObject<HTMLElement | null>,
  contentEl: HTMLElement | null,
): ContentBox | null {
  const [measured, setMeasured] = useState<Measurement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    // Nothing to observe. The stale measurement is not cleared here — the
    // return below already discards it, because it is tagged with the element
    // it came from and that element is gone.
    if (!host || !contentEl) return

    const measure = () => {
      const hostRect = host.getBoundingClientRect()
      const contentRect = contentEl.getBoundingClientRect()
      if (contentRect.width < 1 || contentRect.height < 1) {
        setMeasured((prev) => (prev?.el === contentEl && prev.box === null ? prev : { el: contentEl, box: null }))
        return
      }
      const next: ContentBox = {
        left: contentRect.left - hostRect.left,
        top: contentRect.top - hostRect.top,
        width: contentRect.width,
        height: contentRect.height,
      }
      setMeasured((prev) =>
        prev?.el === contentEl && sameBox(prev.box, next) ? prev : { el: contentEl, box: next },
      )
    }

    // ResizeObserver fires once per observed element as soon as it is observed,
    // so this covers the initial measurement too — no synchronous setState in
    // the effect body, and no first frame measured against a stale layout.
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    observer.observe(contentEl)

    // The content can move within the host without either changing size — a
    // scrollbar appearing next to it, a sibling banner being dismissed. Cheap
    // to cover, and a wrong offset here is a visibly wrong pointer.
    window.addEventListener("resize", measure)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [hostRef, contentEl])

  // Tagged, so a measurement taken against a previous slide viewer is never
  // handed out for the new one — a pointer placed against the wrong rectangle
  // for even one frame is exactly the artefact this hook exists to remove.
  return measured && measured.el === contentEl ? measured.box : null
}
