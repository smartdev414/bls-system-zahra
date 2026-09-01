"use client"

/**
 * tldraw's colour/style panel, with a grab bar so it can be moved out of the way.
 *
 * The panel is docked to the top-right of the canvas and stays there while a
 * text shape is being edited — which is exactly when it is most likely to be
 * sitting on top of the words the teacher is typing. On a full-screen board
 * that is a minor annoyance; here the board is only ever half the stage (the
 * teacher's camera has the other half), so the panel covers a real share of the
 * writing area and there is nowhere to scroll the text to. Teachers reported it
 * as "I can't move the colour options while typing".
 *
 * So: a grab bar above the panel drags the whole thing anywhere over the canvas,
 * and a double-click puts it back. The position is local to this client and
 * lasts as long as the board is open — it is a view preference, not part of the
 * document, so it is deliberately not synced to the class or saved.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { DefaultStylePanel, type TLUiStylePanelProps } from "tldraw"
import { GripHorizontal } from "lucide-react"
import "./whiteboard-style-panel.css"

/** Keep this much of the panel clear of the edge it is being dragged towards. */
const EDGE_PADDING = 8

type Offset = { x: number; y: number }

const ORIGIN: Offset = { x: 0, y: 0 }

/**
 * The region the panel may be dragged around in: the canvas area above the
 * toolbar. Clamping to the whole container instead would let the panel be
 * parked on top of the toolbar, where it covers the tools it styles.
 */
function dragBounds(el: HTMLElement | null): DOMRect | null {
  const region = el?.closest(".tlui-layout__top")
  return region instanceof HTMLElement ? region.getBoundingClientRect() : null
}

/** Clamp an offset so the panel's box stays inside `bounds`. */
function clampOffset(
  offset: Offset,
  panel: { left: number; top: number; width: number; height: number },
  bounds: DOMRect | null,
): Offset {
  if (!bounds) return offset
  // `panel.left`/`top` are where the panel sits at zero offset, so the clamp is
  // expressed directly in offset units.
  const clamp = (value: number, min: number, max: number) =>
    // A panel taller or wider than the region has min > max; pin it to the
    // near edge rather than letting the clamp invert.
    max < min ? min : Math.min(Math.max(value, min), max)
  return {
    x: clamp(
      offset.x,
      bounds.left + EDGE_PADDING - panel.left,
      bounds.right - EDGE_PADDING - panel.width - panel.left,
    ),
    y: clamp(
      offset.y,
      bounds.top + EDGE_PADDING - panel.top,
      bounds.bottom - EDGE_PADDING - panel.height - panel.top,
    ),
  }
}

function DraggableDockedStylePanel(props: TLUiStylePanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState<Offset>(ORIGIN)
  const [dragging, setDragging] = useState(false)
  // The pointer handlers need the live offset without re-binding on every frame.
  const offsetRef = useRef<Offset>(ORIGIN)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    from: Offset
    panel: { left: number; top: number; width: number; height: number }
  } | null>(null)

  const applyOffset = useCallback((next: Offset) => {
    offsetRef.current = next
    setOffset(next)
  }, [])

  /** Where the panel's box would be with no offset applied. */
  const restingBox = useCallback(() => {
    const el = wrapRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      left: rect.left - offsetRef.current.x,
      top: rect.top - offsetRef.current.y,
      width: rect.width,
      height: rect.height,
    }
  }, [])

  // A panel parked at the bottom of a tall stage would end up off-canvas when
  // the chat opens or the window is resized; pull it back in when that happens.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (dragRef.current) return
      if (offsetRef.current.x === 0 && offsetRef.current.y === 0) return
      const panel = restingBox()
      if (!panel) return
      const next = clampOffset(offsetRef.current, panel, dragBounds(el))
      if (next.x !== offsetRef.current.x || next.y !== offsetRef.current.y) applyOffset(next)
    })
    const region = el.closest(".tlui-layout__top")
    if (region instanceof HTMLElement) observer.observe(region)
    return () => observer.disconnect()
  }, [applyOffset, restingBox])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    const panel = restingBox()
    if (!panel) return
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      from: offsetRef.current,
      panel,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    // Keep the press off the canvas underneath — otherwise grabbing the bar
    // also starts a draw or a selection box.
    e.preventDefault()
    e.stopPropagation()
  }, [restingBox])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    applyOffset(
      clampOffset(
        { x: drag.from.x + (e.clientX - drag.startX), y: drag.from.y + (e.clientY - drag.startY) },
        drag.panel,
        dragBounds(wrapRef.current),
      ),
    )
    e.preventDefault()
  }, [applyOffset])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  return (
    <div
      ref={wrapRef}
      className="wb-style-panel"
      data-dragging={dragging}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div
        className="wb-style-panel__handle"
        role="button"
        tabIndex={-1}
        aria-label="Move the colour and style options"
        title="Drag to move the colour options — double-click to put them back"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => applyOffset(ORIGIN)}
      >
        <GripHorizontal style={{ width: 14, height: 14 }} />
      </div>
      <DefaultStylePanel {...props} />
    </div>
  )
}

export function DraggableStylePanel(props: TLUiStylePanelProps) {
  // On a narrow board tldraw drops the docked panel and opens the same content
  // as a popover hung off the toolbar button. That already opens clear of the
  // canvas and closes on its own, so it is left exactly as tldraw ships it.
  if (props.isMobile) return <DefaultStylePanel {...props} />
  return <DraggableDockedStylePanel {...props} />
}
