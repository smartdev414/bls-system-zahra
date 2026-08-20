"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { Bell } from "lucide-react"

// How long the alert stays up. The student version is deliberately long — a
// nudge that vanishes before the student has looked back at the screen is a
// nudge that never happened. The tutor's own echo is short: it only has to
// confirm the ping went out without covering the class they're teaching.
const AUTO_DISMISS_MS = 6000
const SELF_DISMISS_MS = 1800

export function NudgeOverlay({
  from,
  message,
  self = false,
  onDismiss,
}: {
  from: string
  message?: string | null
  /** True for the tutor's local echo of their own nudge — compact, no shake. */
  self?: boolean
  onDismiss: () => void
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, self ? SELF_DISMISS_MS : AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [onDismiss, self])

  // Escape dismisses early, same as clicking the card.
  useEffect(() => {
    if (self) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onDismiss, self])

  // Haptic burst for phones and tablets. No-op on desktop. Longer and harder
  // than a notification buzz — this is the one cue a Deaf student feels rather
  // than sees, so it has to be unmistakable.
  useEffect(() => {
    if (self) return
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return
    try { navigator.vibrate([250, 90, 250, 90, 400]) } catch { /* blocked by policy */ }
  }, [self])

  // Three-note chime for hearing students. Synthesised rather than shipped as
  // an asset so there's nothing to load at the moment it's needed. Silently
  // does nothing if the browser blocks audio.
  useEffect(() => {
    if (self) return
    let ctx: AudioContext | null = null
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      ctx = new Ctor()
      const start = ctx.currentTime + 0.01
      const notes = [880, 1174.7, 880]   // A5 · D6 · A5
      notes.forEach((freq, i) => {
        const at   = start + i * 0.17
        const osc  = ctx!.createOscillator()
        const gain = ctx!.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(freq, at)
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16)
        osc.connect(gain).connect(ctx!.destination)
        osc.start(at)
        osc.stop(at + 0.18)
      })
    } catch { /* no audio available — the visuals carry it */ }
    const c = ctx
    return () => { try { void c?.close() } catch { /* already closed */ } }
  }, [self])

  // Room shake: physically jolts the classroom shell so the movement is caught
  // in peripheral vision even when the student is looking away from the screen.
  // We shake the classroom shell rather than <body> because a transform on an
  // ancestor re-anchors `position: fixed` children to it — shaking <body> would
  // drag this overlay (and the whole fullscreen room) around with it.
  // Respects prefers-reduced-motion — the card and flash still fire.
  useEffect(() => {
    if (self) return
    if (typeof document === "undefined") return
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce) return
    const target = document.querySelector<HTMLElement>("[data-classroom-shell]") ?? document.body
    target.classList.add("nudge-shake")
    const t = setTimeout(() => target.classList.remove("nudge-shake"), 1600)
    return () => {
      clearTimeout(t)
      target.classList.remove("nudge-shake")
    }
  }, [self])

  // ── Tutor echo: small confirmation strip, nothing blocked ──────────────────
  if (self) {
    return (
      <div className="fixed inset-x-0 top-0 z-[95] pointer-events-none flex justify-center" aria-hidden>
        <div className="mt-20 bg-amber-400 text-zinc-950 px-4 py-2 rounded-xl shadow-xl flex items-center gap-2 animate-nudge-pop">
          <Bell className="size-4 shrink-0" />
          <span className="text-xs font-black uppercase tracking-wider">Nudge sent</span>
        </div>
        <style jsx global>{`
          @keyframes nudge-pop {
            0%   { transform: scale(0.85) translateY(-8px); opacity: 0; }
            15%  { transform: scale(1.05) translateY(0);    opacity: 1; }
            100% { transform: scale(1)    translateY(0);    opacity: 1; }
          }
          .animate-nudge-pop { animation: nudge-pop 0.35s ease-out forwards; }
        `}</style>
      </div>
    )
  }

  // ── Student: full-screen, unmissable ───────────────────────────────────────
  // Portalled to <body> so the classroom shell can be shaken underneath it
  // without dragging the alert along. A nudge only ever arrives from a live data
  // channel, so this never renders during SSR — the guard is belt-and-braces.
  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center cursor-pointer"
      aria-live="assertive"
      role="alertdialog"
      aria-label={`${from} needs your attention`}
      onClick={onDismiss}
    >
      {/* Dimmer — pulls every other pixel on the page down so the card is the
          only thing with contrast left. */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px] animate-nudge-dim" />

      {/* Edge strobe — thick amber band pulsing around the whole viewport.
          Drawn as an inset box-shadow rather than a ring utility: Tailwind v4
          dropped `ring-inset`, so a ring on a viewport-sized box lands entirely
          outside the screen and is never seen. */}
      <div
        className="absolute inset-0 animate-nudge-flash pointer-events-none"
        style={{
          boxShadow:
            "inset 0 0 0 18px rgb(251 191 36), inset 0 0 90px 24px rgb(251 191 36 / 0.55)",
        }}
      />

      {/* The pop-up itself */}
      <div className="relative w-[min(92vw,30rem)] bg-amber-400 text-zinc-950 rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.7)] px-8 py-9 text-center animate-nudge-card">
        <div className="mx-auto mb-4 size-20 rounded-full bg-zinc-950/10 flex items-center justify-center">
          <Bell className="size-11 animate-nudge-bell" strokeWidth={2.5} />
        </div>

        <p className="text-4xl sm:text-5xl font-black uppercase tracking-tight leading-none">
          Eyes up
        </p>
        <p className="mt-3 text-base sm:text-lg font-bold leading-snug">
          {message || `${from} needs your attention`}
        </p>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss() }}
          className="mt-6 w-full bg-zinc-950 text-amber-300 rounded-xl px-6 py-3 text-sm font-black uppercase tracking-wider hover:bg-zinc-800 transition-colors"
        >
          Got it
        </button>
      </div>

      <style jsx global>{`
        @keyframes nudge-dim {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        /* Four hard strobes rather than three soft fades. */
        @keyframes nudge-flash {
          0%, 12%, 24%, 36%, 48% { opacity: 1; }
          6%, 18%, 30%, 42%      { opacity: 0; }
          100%                   { opacity: 0; }
        }
        /* Pop in, then wobble twice so the card itself keeps moving. */
        @keyframes nudge-card {
          0%   { transform: scale(0.6) rotate(0deg);    opacity: 0; }
          12%  { transform: scale(1.08) rotate(0deg);   opacity: 1; }
          20%  { transform: scale(1) rotate(-3.5deg);   opacity: 1; }
          28%  { transform: scale(1.03) rotate(3.5deg); }
          36%  { transform: scale(1) rotate(-2.5deg);   }
          44%  { transform: scale(1.02) rotate(2.5deg); }
          52%  { transform: scale(1) rotate(0deg);      }
          64%  { transform: scale(1.05) rotate(-2deg);  }
          72%  { transform: scale(1) rotate(2deg);      }
          80%  { transform: scale(1) rotate(0deg);      }
          100% { transform: scale(1) rotate(0deg);      opacity: 1; }
        }
        /* Bell swings like it's actually ringing. */
        @keyframes nudge-bell {
          0%, 60%, 100% { transform: rotate(0deg); }
          5%,  15%, 25%, 35%, 45% { transform: rotate(-18deg); }
          10%, 20%, 30%, 40%, 50% { transform: rotate(18deg); }
        }
        .animate-nudge-dim   { animation: nudge-dim 0.18s ease-out forwards; }
        .animate-nudge-flash { animation: nudge-flash 2.6s ease-in-out forwards; }
        .animate-nudge-card  { animation: nudge-card 2.6s ease-in-out forwards; }
        .animate-nudge-bell  { animation: nudge-bell 2.2s ease-in-out 1; transform-origin: 50% 12%; }

        /* Whole-room jolt: big amplitude, three bursts, with a slight tilt so
           it reads as a shake and not a scroll. Offsets are percentages of the
           shell's own width and it is scaled up 6% for the duration, so the
           displacement never uncovers the page behind it — on a phone or on a
           widescreen alike. */
        @keyframes nudge-shake {
          0%, 100%              { transform: scale(1.06) translate3d(0, 0, 0) rotate(0deg); }
          2%, 10%, 18%          { transform: scale(1.06) translate3d(-2%, 0, 0) rotate(-0.6deg); }
          6%, 14%, 22%          { transform: scale(1.06) translate3d(2%, 0, 0) rotate(0.6deg); }
          26%                   { transform: scale(1.06) translate3d(0, 0, 0) rotate(0deg); }
          36%, 44%, 52%         { transform: scale(1.06) translate3d(-1.5%, 0, 0) rotate(-0.5deg); }
          40%, 48%, 56%         { transform: scale(1.06) translate3d(1.5%, 0, 0) rotate(0.5deg); }
          60%                   { transform: scale(1.06) translate3d(0, 0, 0) rotate(0deg); }
          70%, 78%, 86%         { transform: scale(1.06) translate3d(-0.8%, 0, 0) rotate(-0.3deg); }
          74%, 82%, 90%         { transform: scale(1.06) translate3d(0.8%, 0, 0) rotate(0.3deg); }
        }
        body.nudge-shake { animation: nudge-shake 1.5s ease-in-out 1; }
        @media (prefers-reduced-motion: reduce) {
          body.nudge-shake    { animation: none; }
          .animate-nudge-card { animation: nudge-dim 0.2s ease-out forwards; }
          .animate-nudge-bell { animation: none; }
        }
      `}</style>
    </div>,
    document.body,
  )
}
