"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { GripVertical } from "lucide-react"

/**
 * Drag a lesson by its handle to another place in the course — within its
 * section or into another one. Pointer events, so it works the same with a
 * mouse and a finger; the page scrolls when the lesson is held near the top or
 * bottom of the screen, so a test on Day 9 can be carried up to Day 6.
 *
 * Drop places are marked up by the page:
 *   [data-lesson-row]  data-section-id, data-index — a lesson; drops above or below it
 *   [data-section-drop] data-drop-index            — a section header or footer
 */

/** Where the lesson would land: the section, and the slot in it (counting the dragged lesson). */
export type DropTarget = { sectionId: string; index: number }

type Dragging = { lessonId: string; sectionId: string; index: number; title: string }

const EDGE = 72
const SPEED = 14

function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const row = el?.closest<HTMLElement>("[data-lesson-row]")
  if (row) {
    const r = row.getBoundingClientRect()
    const index = Number(row.dataset.index)
    return { sectionId: row.dataset.sectionId!, index: y < r.top + r.height / 2 ? index : index + 1 }
  }
  const section = el?.closest<HTMLElement>("[data-section-drop]")
  if (section) return { sectionId: section.dataset.sectionDrop!, index: Number(section.dataset.dropIndex) }
  return null
}

export function useLessonDrag(
  /** Called on drop with the index in the target section once the lesson is taken out of its old place. */
  onDrop: (lessonId: string, fromSectionId: string, sectionId: string, index: number) => void,
) {
  const [dragging, setDragging] = useState<Dragging | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const draggingRef = useRef<Dragging | null>(null)
  const targetRef = useRef<DropTarget | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const onDropRef = useRef(onDrop)
  useEffect(() => { onDropRef.current = onDrop })

  const update = useCallback((x: number, y: number) => {
    pointerRef.current = { x, y }
    setPointer({ x, y })
    const next = targetAt(x, y)
    targetRef.current = next
    setTarget((prev) => (prev?.sectionId === next?.sectionId && prev?.index === next?.index ? prev : next))
  }, [])

  // While dragging: follow the pointer, scroll near the edges, drop on release.
  useEffect(() => {
    if (!dragging) return
    let frame = 0
    const scroll = () => {
      const p = pointerRef.current
      if (p) {
        const dy = p.y < EDGE ? -SPEED : p.y > window.innerHeight - EDGE ? SPEED : 0
        if (dy) {
          window.scrollBy(0, dy)
          update(p.x, p.y)
        }
      }
      frame = requestAnimationFrame(scroll)
    }
    frame = requestAnimationFrame(scroll)

    const move = (e: PointerEvent) => { e.preventDefault(); update(e.clientX, e.clientY) }
    const finish = (drop: boolean) => {
      const d = draggingRef.current
      const t = targetRef.current
      draggingRef.current = null
      targetRef.current = null
      setDragging(null)
      setTarget(null)
      setPointer(null)
      if (!drop || !d || !t) return
      // The slot counted the dragged lesson in its old place; take it out.
      const index = t.sectionId === d.sectionId && t.index > d.index ? t.index - 1 : t.index
      if (t.sectionId === d.sectionId && index === d.index) return
      onDropRef.current(d.lessonId, d.sectionId, t.sectionId, index)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") finish(false) }

    window.addEventListener("pointermove", move, { passive: false })
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    window.addEventListener("keydown", key)
    const userSelect = document.body.style.userSelect
    document.body.style.userSelect = "none"
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("keydown", key)
      document.body.style.userSelect = userSelect
    }
  }, [dragging, update])

  /** Put on the handle's onPointerDown. */
  const start = useCallback((e: React.PointerEvent, lesson: { id: string; title: string }, sectionId: string, index: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    const d = { lessonId: lesson.id, sectionId, index, title: lesson.title }
    draggingRef.current = d
    setDragging(d)
    update(e.clientX, e.clientY)
  }, [update])

  const ghost = dragging && pointer && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed z-[100] pointer-events-none -translate-y-1/2 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium shadow-xl max-w-72"
          style={{ left: pointer.x + 12, top: pointer.y }}
        >
          <GripVertical className="size-4 text-muted-foreground shrink-0" />
          <span className="truncate">{dragging.title}</span>
        </div>,
        document.body,
      )
    : null

  return { dragging, target, start, ghost }
}

/** The line showing where a dragged lesson will land. */
export function DropLine() {
  return (
    <div className="relative h-0" aria-hidden>
      <div className="absolute inset-x-3 -top-px h-0.5 rounded-full bg-primary" />
      <div className="absolute left-2 -top-[3px] size-2 rounded-full bg-primary" />
    </div>
  )
}
