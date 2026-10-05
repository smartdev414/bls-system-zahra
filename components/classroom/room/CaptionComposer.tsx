"use client"

/**
 * Type a caption instead of speaking it.
 *
 * A signing tutor often has something to put in words — a spelling, a page
 * number, "back in five minutes" — and the chat is the wrong place for it: it
 * is off to the side, it is a conversation rather than an announcement, and
 * half the class has it closed. A typed caption lands where the eyes already
 * are, in the captions at the bottom of the stage, attributed like speech.
 *
 * Prepared captions are the other half: phrases written before the lesson and
 * sent with one click, so the tutor never has to stop signing to type them out.
 * They live in the tutor's resource library, one list for every lesson, and can
 * be written there before class or edited here during it.
 *
 * Typing mid-lesson is typing in a hurry, so a grammar assistant reads the
 * caption whenever the tutor pauses and offers a corrected version above the
 * box. It never changes what is sent on its own: Tab takes the suggestion,
 * Enter sends whatever is in the box.
 */

import { useEffect, useRef, useState } from "react"
import { Send, X, ListPlus, Check, Keyboard, Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { parsePreparedCaptions, TYPED_CAPTION_MAX } from "@/lib/library"

// ── Prepared captions ─────────────────────────────────────────────────────────
// Kept in the tutor's library on the server, so they can be written before
// class from any device. Cached here so reopening the composer is instant.

let cachedPrepared: string[] = []

async function loadPrepared(): Promise<string[]> {
  const res = await fetch("/api/tutor/library/captions", { cache: "no-store" })
  if (!res.ok) throw new Error("Could not load prepared captions")
  const body = await res.json() as { captions?: string[] }
  cachedPrepared = body.captions ?? []
  return cachedPrepared
}

async function savePrepared(captions: string[]): Promise<string[]> {
  const res = await fetch("/api/tutor/library/captions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ captions }),
  })
  if (!res.ok) throw new Error("Could not save prepared captions")
  const body = await res.json() as { captions?: string[] }
  cachedPrepared = body.captions ?? captions
  return cachedPrepared
}

// ── Grammar assistant ─────────────────────────────────────────────────────────

/** How long the tutor has to stop typing before the caption is checked. */
const GRAMMAR_PAUSE_MS = 700

/** Too short to have grammar: a page number, "yes", a fingerspelled name. */
const GRAMMAR_MIN_CHARS = 4

// Switched off for the rest of the visit once the server says it has no model.
let grammarAvailable = true

// Corrections already fetched, by the exact text typed; null means "no change".
// Backspacing to an earlier wording then costs nothing.
const grammarCache = new Map<string, string | null>()
const GRAMMAR_CACHE_LIMIT = 100

function rememberGrammar(text: string, corrected: string | null): void {
  if (grammarCache.size >= GRAMMAR_CACHE_LIMIT) grammarCache.clear()
  grammarCache.set(text, corrected)
}

/** The corrected caption, or null when there is nothing to change. */
async function checkGrammar(text: string, signal: AbortSignal): Promise<string | null> {
  const cached = grammarCache.get(text)
  if (cached !== undefined) return cached

  const res = await fetch("/api/tutor/captions/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!res.ok) return null
  const body = await res.json() as { available?: boolean; corrected?: string | null }
  if (body.available === false) {
    grammarAvailable = false
    return null
  }
  const corrected = typeof body.corrected === "string" && body.corrected !== text ? body.corrected : null
  rememberGrammar(text, corrected)
  return corrected
}

// ── Composer ──────────────────────────────────────────────────────────────────

type Props = {
  onSend: (text: string) => void
  onClose: () => void
  /** The tutor's own recent typed captions, newest last. */
  sent: { id: string; text: string }[]
  /** Captions are switched off on this tutor's screen (students still see them). */
  captionsHidden: boolean
}

export function CaptionComposer({ onSend, onClose, sent, captionsHidden }: Props) {
  const [prepared, setPrepared] = useState<string[]>(cachedPrepared)
  const [text, setText] = useState("")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Refresh on open: the tutor may have edited the list in the library since.
  useEffect(() => {
    let alive = true
    loadPrepared()
      .then((list) => { if (alive) setPrepared(list) })
      .catch(() => { /* keep the cached list; typing still works */ })
    return () => { alive = false }
  }, [])

  // Check the grammar once the tutor pauses. Everything here is keyed by the
  // text it was for, so an answer that arrives after they have typed on (or
  // sent) is simply never shown.
  const typed = text.trim()
  const [correction, setCorrection] = useState<{ source: string; text: string } | null>(null)
  const [checkingFor, setCheckingFor] = useState<string | null>(null)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!grammarAvailable || typed.length < GRAMMAR_MIN_CHARS) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setCheckingFor(typed)
      try {
        const corrected = await checkGrammar(typed, ctrl.signal)
        if (!ctrl.signal.aborted && corrected) setCorrection({ source: typed, text: corrected })
      } catch { /* no suggestion; what they typed still sends */ }
      if (!ctrl.signal.aborted) setCheckingFor(null)
    }, GRAMMAR_PAUSE_MS)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [typed])

  const checking = checkingFor !== null && checkingFor === typed
  const suggestion = correction && correction.source === typed && dismissedFor !== typed
    ? correction.text
    : null

  function acceptSuggestion() {
    if (!suggestion) return
    // What the assistant wrote does not need the assistant's opinion.
    rememberGrammar(suggestion, null)
    setText(suggestion)
    inputRef.current?.focus()
  }

  function send(value: string) {
    const t = value.trim().slice(0, TYPED_CAPTION_MAX)
    if (!t) return
    onSend(t)
  }

  function startEditing() {
    setDraft(prepared.join("\n"))
    setEditing(true)
  }

  async function saveEditing() {
    setSaving(true)
    setError(null)
    try {
      setPrepared(await savePrepared(parsePreparedCaptions(draft)))
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={cn(
        "pointer-events-auto w-full max-w-3xl rounded-2xl bg-zinc-900/95 backdrop-blur-md",
        "border border-white/15 shadow-lg p-2 flex flex-col gap-2",
      )}
      // Keep typing out of the room's keyboard shortcuts.
      onKeyDown={(e) => e.stopPropagation()}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-medium text-white/70 px-1" htmlFor="prepared-captions">
            Prepared captions — one per line. Saved to your library; click one to send it straight away.
          </label>
          <textarea
            id="prepared-captions"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            autoFocus
            placeholder={"Welcome to today's class\nPlease turn your cameras on\nWe'll take a 5 minute break"}
            className="w-full resize-y rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-sky-500/60"
          />
          <div className="flex items-center justify-end gap-2">
            {error && <p className="mr-auto text-xs text-rose-300 px-1">{error}</p>}
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 h-8 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEditing}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* What went out — the tutor sees it here as well as in the captions. */}
          {sent.length > 0 && (
            <div className="flex flex-col gap-0.5 px-1" aria-live="polite">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/40">Sent to the class</p>
              {sent.map((l, i) => (
                <p
                  key={l.id}
                  className={cn(
                    "flex items-start gap-1.5 text-sm leading-snug",
                    i === sent.length - 1 ? "text-white" : "text-white/55",
                  )}
                >
                  <Check className="size-3.5 mt-0.5 shrink-0 text-emerald-400" aria-hidden />
                  <span className="break-words min-w-0">{l.text}</span>
                </p>
              ))}
            </div>
          )}
          {captionsHidden && (
            <p className="px-1 text-[11px] text-amber-300/90">
              Captions are turned off on your screen, so you won&apos;t see these at the bottom — the class still does.
            </p>
          )}

          {/* Prepared: one click sends */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {prepared.map((p, i) => (
              <button
                key={`${i}:${p}`}
                type="button"
                onClick={() => send(p)}
                className="shrink-0 max-w-[16rem] truncate rounded-full px-3 h-7 text-xs font-medium bg-zinc-800 hover:bg-sky-600 text-zinc-200 hover:text-white border border-white/10 transition-colors"
                title={`Send: ${p}`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={startEditing}
              className="shrink-0 flex items-center gap-1 rounded-full px-3 h-7 text-xs font-medium text-white/60 hover:text-white border border-dashed border-white/20"
              title="Write captions before class and send them with one click"
            >
              <ListPlus className="size-3.5" />
              {prepared.length ? "Edit prepared" : "Prepare captions"}
            </button>
          </div>

          {/* Grammar assistant: offered, never applied on its own */}
          {suggestion && (
            <div
              className="flex items-start gap-2 rounded-xl bg-violet-500/10 border border-violet-400/25 px-3 py-2"
              role="status"
            >
              <Sparkles className="size-3.5 mt-0.5 shrink-0 text-violet-300" aria-hidden />
              <p className="flex-1 min-w-0 break-words text-sm leading-snug text-white">
                <span className="sr-only">Suggested correction: </span>
                {suggestion}
              </p>
              <button
                type="button"
                onClick={acceptSuggestion}
                className="shrink-0 flex items-center gap-1.5 px-2 h-6 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white"
                title="Replace what you typed with this correction"
              >
                Use
                <kbd className="rounded bg-black/30 px-1 text-[10px] font-medium text-white/80">Tab</kbd>
              </button>
              <button
                type="button"
                onClick={() => setDismissedFor(typed)}
                className="shrink-0 p-1 rounded-lg text-white/50 hover:text-white hover:bg-white/10"
                aria-label="Dismiss the suggested correction"
                title="Keep what I typed"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* Free typing */}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); send(text); setText("") }}
          >
            {checking
              ? <Loader2 className="size-4 text-violet-300 shrink-0 ml-1 animate-spin" aria-label="Checking grammar" />
              : <Keyboard className="size-4 text-white/50 shrink-0 ml-1" aria-hidden />}
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose()
                if (e.key === "Tab" && !e.shiftKey && suggestion) { e.preventDefault(); acceptSuggestion() }
              }}
              maxLength={TYPED_CAPTION_MAX}
              placeholder="Type a caption and press Enter — it shows at the bottom for everyone"
              aria-label="Type a caption"
              className="flex-1 min-w-0 h-9 rounded-xl bg-black/40 border border-white/10 px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-sky-500/60"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 disabled:hover:bg-sky-600"
            >
              <Send className="size-3.5" />
              <span className="hidden sm:inline">Send</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-zinc-800"
              aria-label="Close caption typing"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </form>
        </>
      )}
    </div>
  )
}
