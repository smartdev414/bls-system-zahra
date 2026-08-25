"use client"

/**
 * Interval polling that behaves on a bad link.
 *
 * A bare `setInterval(() => fetch(...), 8000)` is fine on an office LAN and
 * pathological on café Wi-Fi. Three things go wrong, and all three show up as
 * "the page froze":
 *
 *   1. **Pile-up.** The link stalls, requests stop completing, and the interval
 *      keeps firing. Within a minute there are eight in flight. Browsers allow
 *      only six connections per host, so the queue backs up and every *other*
 *      request on the page — the one the student is actually waiting for —
 *      waits behind a poll nobody is looking at.
 *   2. **Background bursts.** A backgrounded tab has its timers throttled, then
 *      fires everything it owes the moment the student switches back, on a link
 *      that has usually just reassociated to a different access point.
 *   3. **Stale-until-the-next-tick.** The link recovers and the UI stays wrong
 *      for the remainder of the interval, which for the notification bell is
 *      another thirty seconds of looking broken.
 *
 * So: one run at a time, never while hidden or while the link is down, and an
 * immediate catch-up run the moment either of those clears.
 */

import { useEffect, useRef } from "react"
import {
  getNetworkSnapshot, subscribeNetwork, subscribeNetworkRecovery,
} from "@/lib/network-health"

type PollOptions = {
  /** Set false to suspend polling entirely (e.g. the panel is closed). */
  enabled?: boolean
  /** Run once as soon as the effect mounts. Default true. */
  immediate?: boolean
  /**
   * Keep polling while the tab is in the background. Default false — almost
   * nothing needs it, and it is where the throttled-burst problem comes from.
   */
  whenHidden?: boolean
}

/**
 * Calls `fn` every `intervalMs`. `fn` is read from a ref, so an inline closure
 * is fine and does not restart the interval on every render.
 */
export function usePoll(
  fn: () => void | Promise<void>,
  intervalMs: number,
  { enabled = true, immediate = true, whenHidden = false }: PollOptions = {},
): void {
  const fnRef = useRef(fn)
  fnRef.current = fn

  const runningRef = useRef(false)
  // Set when a tick was skipped, so the next time we are allowed to run we do
  // it at once instead of waiting out another full interval.
  const missedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const canRun = () => {
      if (cancelled) return false
      if (!whenHidden && typeof document !== "undefined" && document.hidden) return false
      // "unstable" still runs: one failed request is not a reason to stop
      // asking, and the retry is how we find out the link came back.
      const status = getNetworkSnapshot().status
      return status !== "offline" && status !== "captive-portal"
    }

    const run = async () => {
      if (!canRun()) { missedRef.current = true; return }
      // Overlap guard. Under a stall this is what keeps one request in flight
      // instead of one per tick.
      if (runningRef.current) { missedRef.current = true; return }

      runningRef.current = true
      try {
        await fnRef.current()
      } catch { /* the caller owns its own error reporting */ }
      finally { runningRef.current = false }
    }

    const catchUp = () => {
      if (!missedRef.current) return
      missedRef.current = false
      void run()
    }

    if (immediate) void run()
    const timer = setInterval(() => { void run() }, intervalMs)

    const onVisible = () => { if (!document.hidden) catchUp() }
    document.addEventListener("visibilitychange", onVisible)
    const unsubRecovery = subscribeNetworkRecovery(catchUp)
    // Also catch the case where polling was suspended because we were offline
    // and the status improved without a full recovery transition.
    const unsubStatus = subscribeNetwork(() => { if (canRun()) catchUp() })

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      unsubRecovery()
      unsubStatus()
    }
  }, [enabled, immediate, intervalMs, whenHidden])
}
