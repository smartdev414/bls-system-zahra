"use client"

import { useEffect } from "react"
import { Bell } from "lucide-react"

export function NudgeOverlay({
  from,
  message,
  onDismiss,
}: {
  from: string
  message?: string | null
  onDismiss: () => void
}) {
  // Auto-dismiss after ~2.2s (matches the three pulses).
  useEffect(() => {
    const t = setTimeout(onDismiss, 2200)
    return () => clearTimeout(t)
  }, [onDismiss])

  // Soft haptic for devices that support it. No-op on desktop.
  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate([120, 80, 120]) } catch { /* ignore */ }
    }
  }, [])

  // Room shake: briefly nudge the document body horizontally. Respects
  // prefers-reduced-motion so motion-sensitive users aren't shaken.
  useEffect(() => {
    if (typeof document === "undefined") return
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce) return
    const target = document.body
    target.classList.add("nudge-shake")
    const t = setTimeout(() => target.classList.remove("nudge-shake"), 550)
    return () => {
      clearTimeout(t)
      target.classList.remove("nudge-shake")
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[95] pointer-events-none flex items-start justify-center"
      aria-live="assertive"
      role="alert"
    >
      {/* Edge glow — three pulses of amber ring around the viewport */}
      <div className="absolute inset-0 ring-[12px] ring-amber-400/80 ring-inset animate-nudge-flash rounded-none" />

      {/* Banner card near the top */}
      <div className="mt-24 bg-amber-400 text-zinc-950 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-nudge-pop">
        <Bell className="size-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-black uppercase tracking-wider leading-tight">
            Eyes up
          </p>
          <p className="text-xs font-medium leading-tight">
            {message || `${from} needs your attention`}
          </p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes nudge-flash {
          0%, 100% { opacity: 0; }
          10%, 40%, 70% { opacity: 1; }
          25%, 55%, 85% { opacity: 0.2; }
        }
        @keyframes nudge-pop {
          0%   { transform: scale(0.85) translateY(-8px); opacity: 0; }
          15%  { transform: scale(1.05) translateY(0);    opacity: 1; }
          100% { transform: scale(1)    translateY(0);    opacity: 1; }
        }
        .animate-nudge-flash { animation: nudge-flash 2.2s ease-in-out forwards; }
        .animate-nudge-pop   { animation: nudge-pop 0.35s ease-out forwards; }

        @keyframes nudge-shake {
          0%, 100% { transform: translate3d(0, 0, 0); }
          15%      { transform: translate3d(-3px, 0, 0); }
          30%      { transform: translate3d(3px, 0, 0); }
          45%      { transform: translate3d(-3px, 0, 0); }
          60%      { transform: translate3d(3px, 0, 0); }
          75%      { transform: translate3d(-2px, 0, 0); }
          90%      { transform: translate3d(2px, 0, 0); }
        }
        body.nudge-shake { animation: nudge-shake 0.5s ease-in-out 1; }
        @media (prefers-reduced-motion: reduce) {
          body.nudge-shake { animation: none; }
        }
      `}</style>
    </div>
  )
}
