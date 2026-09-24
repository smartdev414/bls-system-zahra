"use client"

/**
 * Live captions for whoever is speaking.
 *
 * This started as a single rolling line, which is the right shape for a
 * broadcast subtitle and the wrong shape for a lesson. A subtitle accompanies
 * something you are also hearing, so one line is enough to fill the gaps. A
 * caption in a BSL classroom is often the *only* channel a given participant
 * has for the spoken part of the room — and a conversation is not a sequence of
 * independent sentences. Following it means seeing the question that prompted
 * the answer, and seeing who said which.
 *
 * So the overlay keeps a transcript. Several lines are on screen at once, in the
 * order they were spoken, attributed, and they stay put until pushed off by
 * newer ones rather than vanishing on a timer while the conversation is still
 * going. How many lines is the reader's choice, remembered per device, and the
 * panel expands into a scrollable transcript for catching up on something
 * missed.
 *
 * Two things are deliberately kept from the original: it disappears after a
 * long silence, so it does not sit over the tutor's hands forever, and it does
 * not capture pointer events unless expanded, so the tutor can still point at
 * a slide underneath it.
 */

import {
  useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect, useSyncExternalStore,
} from "react"
import { useRoomContext } from "@livekit/components-react"
import { RoomEvent, type Participant, type TranscriptionSegment } from "livekit-client"
import { ChevronDown, ChevronUp, Rows3 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCaptionsEnabled } from "@/components/classroom/captionsPreference"

type CaptionLine = {
  id: string
  speakerId: string
  speakerName: string
  isTutor: boolean
  text: string
  final: boolean
  /** First time this line was seen. Fixes its place in the transcript. */
  createdAt: number
  updatedAt: number
}

/** Line counts offered to the reader. */
const LINE_CHOICES = [2, 4, 8] as const
type LineChoice = (typeof LINE_CHOICES)[number]

const DEFAULT_LINES: LineChoice = 4

/**
 * How much transcript is retained for scrollback. Generous: it is a few hundred
 * short strings, and the whole point of the expanded panel is being able to go
 * back to something said several minutes ago.
 */
const HISTORY_LIMIT = 300

/**
 * Silence after which the overlay gets out of the way. Much longer than the old
 * six-second per-line timer, because that timer was what reduced this to one
 * visible line during ordinary turn-taking: each sentence was cleared before
 * the reply to it had finished arriving.
 */
const IDLE_HIDE_MS = 30_000

/**
 * On waking after a long silence, lines older than this are dropped rather than
 * shown above the new speech. Four lines of which three are two minutes stale
 * reads as a live conversation and isn't one.
 */
const STALE_ON_WAKE_MS = IDLE_HIDE_MS

const LINES_STORAGE_KEY = "bsl:caption-lines"

function speakerIsTutor(participant?: Participant | null): boolean {
  return participant?.metadata === "tutor"
}

/**
 * The reader's line-count preference, as a tiny external store.
 *
 * It lives outside React because it is read from `localStorage`, which is
 * client-only: reading it during render would differ between the server and
 * client passes, and writing it from a mount effect is a cascading render.
 * `useSyncExternalStore` is the sanctioned shape for exactly this — a server
 * snapshot, a client snapshot, and a subscription.
 */
let cachedChoice: LineChoice | null = null
const choiceListeners = new Set<() => void>()

function readLineChoice(): LineChoice {
  if (cachedChoice !== null) return cachedChoice
  let value: LineChoice = DEFAULT_LINES
  try {
    const raw = window.localStorage.getItem(LINES_STORAGE_KEY)
    const n = raw ? parseInt(raw, 10) : NaN
    if ((LINE_CHOICES as readonly number[]).includes(n)) value = n as LineChoice
  } catch { /* site data disabled — the default is fine */ }
  cachedChoice = value
  return value
}

function readServerLineChoice(): LineChoice {
  return DEFAULT_LINES
}

function writeLineChoice(n: LineChoice): void {
  cachedChoice = n
  try { window.localStorage.setItem(LINES_STORAGE_KEY, String(n)) } catch { /* ignore */ }
  for (const l of choiceListeners) l()
}

function subscribeLineChoice(listener: () => void): () => void {
  choiceListeners.add(listener)
  return () => { choiceListeners.delete(listener) }
}

export function CaptionsOverlay() {
  const room = useRoomContext()
  const [lines, setLines] = useState<CaptionLine[]>([])
  const lineCount = useSyncExternalStore(subscribeLineChoice, readLineChoice, readServerLineChoice)
  const [expanded, setExpanded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const captionsEnabled = useCaptionsEnabled()
  // Whether speech has stopped for long enough to get out of the way. Held as
  // state, and only ever written from a timer or an arriving caption, so
  // rendering stays a pure function of state rather than of the clock.
  const [idle, setIdle] = useState(true)

  const segmentToLine = useRef<Map<string, string>>(new Map())
  const lastActivityRef = useRef(0)

  // ── Ingest ──────────────────────────────────────────────────────────────────

  const applySegment = useCallback((
    segment: TranscriptionSegment,
    participant?: Participant | null,
  ) => {
    const text = (segment.text ?? "").trim()
    if (!text) {
      // An empty final segment is the transcriber taking an utterance back: its
      // noise filter only got a verdict once the recogniser committed, and by
      // then interim text may already be on screen. Drop the line rather than
      // leave a sentence up that nobody said — with no final to replace it, it
      // would sit there looking exactly like something the tutor spoke.
      if (segment.final) {
        const lineId = segmentToLine.current.get(segment.id)
        segmentToLine.current.delete(segment.id)
        if (lineId) setLines((prev) => prev.filter((l) => l.id !== lineId))
      }
      return
    }

    const speakerId = participant?.identity ?? "unknown"
    const speakerName = participant?.name ?? participant?.identity ?? "Unknown"
    const isTutor = speakerIsTutor(participant)
    const lineId = segmentToLine.current.get(segment.id) ?? `${speakerId}:${segment.id}`
    if (!segmentToLine.current.has(segment.id)) {
      segmentToLine.current.set(segment.id, lineId)
    }

    const now = Date.now()
    const wokeFromSilence = lastActivityRef.current > 0 && now - lastActivityRef.current > STALE_ON_WAKE_MS
    lastActivityRef.current = now
    setIdle(false)

    setLines((prev) => {
      // Coming back after a long silence: start a fresh transcript rather than
      // resuming under lines nobody can still place in the conversation. The
      // scrollback below keeps them if anyone wants them.
      const base = wokeFromSilence
        ? prev.filter((l) => now - l.updatedAt <= STALE_ON_WAKE_MS)
        : prev

      const idx = base.findIndex((l) => l.id === lineId)
      if (idx >= 0) {
        const next = [...base]
        // createdAt is preserved on purpose: an utterance keeps the position it
        // started in while its interim text is revised. Re-sorting on every
        // update was what made two people talking swap places mid-sentence.
        next[idx] = { ...next[idx], text, final: !!segment.final, speakerName, updatedAt: now }
        return next
      }

      const entry: CaptionLine = {
        id: lineId, speakerId, speakerName, isTutor,
        text, final: !!segment.final, createdAt: now, updatedAt: now,
      }
      const next = [...base, entry]
      return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next
    })
  }, [])

  useEffect(() => {
    const handler = (segments: TranscriptionSegment[], participant?: Participant) => {
      if (process.env.NODE_ENV === "development") {
        console.debug("[captions] TranscriptionReceived", {
          participant: participant?.identity,
          segments: segments.map((s) => ({ id: s.id, text: s.text, final: s.final })),
        })
      }
      segments.forEach((seg) => applySegment(seg, participant))
    }
    room.on(RoomEvent.TranscriptionReceived, handler)
    return () => { room.off(RoomEvent.TranscriptionReceived, handler) }
  }, [room, applySegment])

  // Re-evaluate the idle timeout on a slow tick. Cheap, and it means the
  // overlay clears itself during a long stretch of signing with no speech.
  useEffect(() => {
    const id = setInterval(() => {
      setIdle(lastActivityRef.current === 0 || Date.now() - lastActivityRef.current > IDLE_HIDE_MS)
    }, 5_000)
    return () => clearInterval(id)
  }, [])

  // ── What to show ────────────────────────────────────────────────────────────

  const ordered = useMemo(
    () => lines.filter((l) => l.text.trim()).sort((a, b) => a.createdAt - b.createdAt),
    [lines],
  )

  const visible = useMemo(
    () => (expanded ? ordered : ordered.slice(-lineCount)),
    [ordered, expanded, lineCount],
  )

  // ── Scrollback ──────────────────────────────────────────────────────────────

  const scrollRef = useRef<HTMLDivElement>(null)
  // Stay pinned to the newest line unless the reader has deliberately scrolled
  // up to re-read something — in which case new captions must not yank them
  // back down mid-sentence.
  const stickRef = useRef(true)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [visible])

  // Collapsing returns to the live end of the transcript.
  useEffect(() => { if (!expanded) stickRef.current = true }, [expanded])

  // Turned off by this viewer. Captions keep being collected underneath, so
  // switching them back on shows the conversation so far rather than a blank.
  if (!captionsEnabled) return null

  if (ordered.length === 0) return null

  // Silence, and nobody is reading back. Clear the tutor's hands — but leave one
  // small handle, because a transcript you cannot reopen is not a transcript.
  if (idle && !expanded) {
    return (
      <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none z-50">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1",
            "bg-black/45 hover:bg-black/75 backdrop-blur-sm border border-white/10",
            "text-[11px] font-medium text-white/60 hover:text-white transition-colors",
          )}
          title="Read back what was said"
        >
          <ChevronUp className="size-3" />
          Transcript
        </button>
      </div>
    )
  }

  return (
    <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none z-50 px-3 sm:px-6">
      <div
        className={cn(
          "group/captions relative bg-black/85 backdrop-blur-md rounded-2xl max-w-3xl w-full",
          "shadow-lg border border-white/10",
          // Only interactive when expanded. Collapsed, it must stay transparent
          // to the mouse: it sits over the presentation, and the tutor's hand
          // pointer is driven by pointer events on the slide underneath.
          expanded && "pointer-events-auto",
        )}
      >
        {/* ── Controls ── */}
        <div
          className={cn(
            "pointer-events-auto absolute -top-3 right-2 flex items-center gap-1",
            "opacity-0 focus-within:opacity-100 group-hover/captions:opacity-100 transition-opacity",
            // Hover does not exist on a touch screen, and this is the control
            // that makes the feature usable for the people who need it most.
            "[@media(hover:none)]:opacity-100",
            (settingsOpen || expanded) && "opacity-100",
          )}
        >
          {settingsOpen && (
            <div className="flex items-center gap-0.5 rounded-full bg-zinc-900 border border-white/15 px-1 py-0.5 shadow-lg">
              {LINE_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => writeLineChoice(n)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors",
                    lineCount === n ? "bg-white text-zinc-900" : "text-white/70 hover:text-white",
                  )}
                  aria-pressed={lineCount === n}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="rounded-full bg-zinc-900 border border-white/15 p-1.5 text-white/80 hover:text-white shadow-lg"
            aria-label="Choose how many caption lines to show"
            aria-expanded={settingsOpen}
            title="How many lines to show"
          >
            <Rows3 className="size-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-full bg-zinc-900 border border-white/15 p-1.5 text-white/80 hover:text-white shadow-lg"
            aria-label={expanded ? "Collapse captions" : "Expand captions to read back the conversation"}
            aria-expanded={expanded}
            title={expanded ? "Collapse" : "Read back the conversation"}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          </button>
        </div>

        {/* ── Transcript ── */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn(
            "px-4 py-3 flex flex-col gap-1.5",
            expanded && "max-h-[38vh] overflow-y-auto overscroll-contain",
          )}
          // Additions are announced; the whole transcript is not re-read every
          // time an interim segment is revised.
          aria-live="polite"
          aria-atomic="false"
          aria-label="Live captions"
        >
          {visible.map((line, i) => {
            // Attribute a run of consecutive lines once. Repeating the name on
            // every sentence is what makes a transcript hard to read quickly.
            const prev = i > 0 ? visible[i - 1] : null
            const showSpeaker = !prev || prev.speakerId !== line.speakerId

            return (
              <p
                key={line.id}
                className={cn(
                  "text-sm leading-snug text-white transition-opacity",
                  !line.final && "opacity-80",
                  // Older lines recede slightly so the eye lands on the newest
                  // without the older ones becoming unreadable.
                  !expanded && i < visible.length - 1 && "text-white/70",
                )}
              >
                {showSpeaker && (
                  <span
                    className={cn(
                      "font-semibold mr-1.5",
                      line.isTutor ? "text-amber-300" : "text-sky-300",
                    )}
                  >
                    {line.speakerName}
                    {line.isTutor ? " (Tutor)" : ""}:
                  </span>
                )}
                <span className={cn(!line.final && "italic")}>{line.text}</span>
                {!line.final && (
                  <span
                    className="inline-block ml-1 size-1.5 rounded-full bg-emerald-400 animate-pulse align-middle"
                    aria-hidden
                  />
                )}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}
