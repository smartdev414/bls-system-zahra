"use client"

/**
 * One place that knows whether this browser can currently reach us.
 *
 * The secure-network work (see `lib/network-mode.ts`) answers "will this
 * network let us through at all?". This answers a different question that
 * public Wi-Fi asks constantly: "is the link working *right now*?"
 *
 * Café, hotel, airport and train Wi-Fi does not fail cleanly. It goes away for
 * eight seconds and comes back. It hands you an IP address and then a captive
 * portal that swallows every request and answers 200 OK with a login page. It
 * keeps the TCP connection open while delivering nothing, so a `fetch()` sits
 * there for the browser's own timeout — up to five minutes in Chrome — with the
 * UI spinner still turning. That last one is what "the platform keeps freezing"
 * almost always is: nothing crashed, a promise simply never settled.
 *
 * So requests get deadlines (`lib/net-fetch.ts`), and every outcome is reported
 * here. This module turns that stream of outcomes into one status the UI can
 * show, drives a recovery probe while we look cut off, and tells pollers when
 * to pick up again — so a lesson that went quiet for a minute catches up by
 * itself instead of waiting for the student to reload.
 *
 * Deliberately not a React context: media code, plain `fetch` wrappers and
 * components all report into it, and half of them are outside the tree.
 */

export type NetworkStatus =
  /** Requests are landing. */
  | "online"
  /** Something failed, but not enough to call it down yet. */
  | "unstable"
  /** Nothing is getting through. */
  | "offline"
  /** Requests are answered, but by a Wi-Fi login page rather than by us. */
  | "captive-portal"

export type NetworkSnapshot = {
  status: NetworkStatus
  /** Epoch ms of the last request that provably reached our server. */
  lastOkAt: number | null
  /** Consecutive failures since the last success. */
  failures: number
  /** True while a recovery probe is in flight. */
  probing: boolean
}

/** Reasons a request can fail, as far as the user's network is concerned. */
export type NetFailureKind =
  /** The browser says there is no network, or the request never left. */
  | "offline"
  /** We gave up waiting. The signature failure of a stalled café link. */
  | "timeout"
  /** A Wi-Fi login page answered instead of us. */
  | "captive-portal"
  /** We reached the server and it said no. Not a network fault. */
  | "server"
  | "unknown"

/** Failures that say something about the *link* rather than about the request. */
export function isLinkFailure(kind: NetFailureKind): boolean {
  return kind === "offline" || kind === "timeout" || kind === "captive-portal"
}

// ─── Store ────────────────────────────────────────────────────────────────────

// One failure is noise — a single request can lose a race with a Wi-Fi roam.
// Two in a row, or one that took the full deadline, is a link that is down.
const FAILURES_BEFORE_OFFLINE = 2

// Probe backoff while we look cut off. Starts fast because most café outages
// are seconds long, then backs off so a genuinely dead link is not hammered.
const PROBE_BACKOFF_MS = [1_500, 3_000, 6_000, 12_000, 20_000, 30_000]
const PROBE_TIMEOUT_MS = 6_000

const SERVER_SNAPSHOT: NetworkSnapshot = {
  status: "online", lastOkAt: null, failures: 0, probing: false,
}

let snapshot: NetworkSnapshot = { ...SERVER_SNAPSHOT }

const listeners = new Set<() => void>()
const recoveryListeners = new Set<() => void>()

let started = false
let probeTimer: ReturnType<typeof setTimeout> | null = null
let probeAttempt = 0

function emit() {
  for (const l of listeners) l()
}

/**
 * Snapshots are replaced wholesale and only when something actually changed:
 * `useSyncExternalStore` compares by identity and will loop forever on a fresh
 * object per read.
 */
function patch(next: Partial<NetworkSnapshot>) {
  const merged = { ...snapshot, ...next }
  if (
    merged.status === snapshot.status &&
    merged.lastOkAt === snapshot.lastOkAt &&
    merged.failures === snapshot.failures &&
    merged.probing === snapshot.probing
  ) return

  const wasDegraded = snapshot.status !== "online"
  snapshot = merged
  emit()

  if (wasDegraded && merged.status === "online") {
    for (const l of recoveryListeners) l()
  }
}

export function getNetworkSnapshot(): NetworkSnapshot {
  return snapshot
}

export function getServerNetworkSnapshot(): NetworkSnapshot {
  return SERVER_SNAPSHOT
}

export function subscribeNetwork(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Fires when the link comes back after a degraded spell. Pollers use this to
 * refetch at once rather than waiting out the rest of their interval, which is
 * the difference between a chat that catches up instantly and one that looks
 * stuck for another thirty seconds.
 */
export function subscribeNetworkRecovery(listener: () => void): () => void {
  start()
  recoveryListeners.add(listener)
  return () => { recoveryListeners.delete(listener) }
}

// ─── Reporting ────────────────────────────────────────────────────────────────

/** Called for every request that reached us and got a real answer. */
export function reportNetworkSuccess(): void {
  cancelProbe()
  probeAttempt = 0

  // The overwhelmingly common case: things were fine and are still fine. Update
  // the timestamp in place rather than through `patch`, which would notify every
  // subscriber — and therefore re-render the banner — once per successful
  // request on the page.
  if (snapshot.status === "online" && snapshot.failures === 0 && !snapshot.probing) {
    snapshot = { ...snapshot, lastOkAt: Date.now() }
    return
  }

  patch({ status: "online", lastOkAt: Date.now(), failures: 0, probing: false })
}

/**
 * Called for every request that did not. Only link failures move the status —
 * a 500 from our own API says nothing about the café's Wi-Fi, and telling a
 * student "you appear to be offline" when they are not is worse than silence.
 */
export function reportNetworkFailure(kind: NetFailureKind): void {
  if (!isLinkFailure(kind)) return

  if (kind === "captive-portal") {
    patch({ status: "captive-portal", failures: snapshot.failures + 1 })
    scheduleProbe()
    return
  }

  const failures = snapshot.failures + 1
  // A request that ran out its full deadline is not ambiguous — something is
  // swallowing traffic. Don't make the user wait for a second one.
  const down = failures >= FAILURES_BEFORE_OFFLINE || kind === "offline"
  patch({ status: down ? "offline" : "unstable", failures })
  if (down) scheduleProbe()
}

// ─── Recovery probe ───────────────────────────────────────────────────────────

function cancelProbe() {
  if (probeTimer) { clearTimeout(probeTimer); probeTimer = null }
}

function scheduleProbe() {
  if (typeof window === "undefined") return
  if (probeTimer) return
  const delay = PROBE_BACKOFF_MS[Math.min(probeAttempt, PROBE_BACKOFF_MS.length - 1)]
  probeTimer = setTimeout(() => { probeTimer = null; void probe() }, delay)
}

/**
 * A deliberately plain `fetch` — not `netFetch`, which reports back into this
 * module and would recurse. `/api/health` is the right target: it is small,
 * uncached, needs no login, and returns JSON, so a captive portal answering
 * HTML in its place is unmistakable.
 */
async function probe() {
  if (typeof window === "undefined") return
  if (navigator.onLine === false) {
    patch({ status: "offline", probing: false })
    probeAttempt = Math.min(probeAttempt + 1, PROBE_BACKOFF_MS.length - 1)
    scheduleProbe()
    return
  }

  patch({ probing: true })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const res = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    })

    if (looksLikeCaptivePortal(res)) {
      probeAttempt = Math.min(probeAttempt + 1, PROBE_BACKOFF_MS.length - 1)
      patch({ status: "captive-portal", probing: false })
      scheduleProbe()
      return
    }

    // Any answer that is really ours means the link is back. A 503 from a
    // degraded database is our problem, not the network's, and the banner
    // telling the student their Wi-Fi is down would simply be wrong.
    reportNetworkSuccess()
  } catch {
    probeAttempt = Math.min(probeAttempt + 1, PROBE_BACKOFF_MS.length - 1)
    patch({ status: "offline", probing: false })
    scheduleProbe()
  } finally {
    clearTimeout(timer)
  }
}

/** Ask for an immediate recheck — used by the banner's "Try again" button. */
export function probeNetworkNow(): void {
  cancelProbe()
  probeAttempt = 0
  void probe()
}

// ─── Captive portal ───────────────────────────────────────────────────────────

/**
 * A captive portal is not an error. It is a different server answering
 * confidently in our place, so every ordinary check passes and the app instead
 * receives a login page where it expected JSON. Three tells, cheapest first.
 */
export function looksLikeCaptivePortal(res: Response): boolean {
  // RFC 6585's dedicated status. Rare in the wild, free to check.
  if (res.status === 511) return true

  // Followed a redirect off our own origin: the portal grabbing the request.
  try {
    if (res.redirected && new URL(res.url).origin !== window.location.origin) return true
  } catch { /* opaque or unparseable URL — fall through */ }

  // HTML where the app asked for JSON. This is how most portals actually show
  // up, and why an unguarded `res.json()` throws a syntax error somewhere
  // unrelated instead of saying "sign in to the Wi-Fi".
  //
  // Restricted to success statuses on purpose: a portal answers 200 with a login
  // page, whereas an HTML body on a 4xx/5xx is our own error page and must not
  // be reported to the student as a Wi-Fi problem.
  const type = res.headers.get("content-type") ?? ""
  if (res.ok && type.includes("text/html")) return true

  return false
}

// ─── Browser events ───────────────────────────────────────────────────────────

function start() {
  if (started || typeof window === "undefined") return
  started = true

  // `navigator.onLine` is only trustworthy in one direction: false really does
  // mean no network, while true only means an interface is up — which on café
  // Wi-Fi is true throughout a captive portal and throughout an outage
  // upstream of the access point. So use it to fail fast, never to declare
  // things well.
  window.addEventListener("offline", () => {
    patch({ status: "offline", failures: snapshot.failures + 1 })
  })
  window.addEventListener("online", () => {
    probeAttempt = 0
    cancelProbe()
    void probe()
  })

  // Coming back to a backgrounded tab is the other moment worth rechecking:
  // laptops suspend, Wi-Fi reassociates on a different AP, and every socket the
  // page held is quietly dead while the UI still looks connected.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && snapshot.status !== "online") {
      probeAttempt = 0
      cancelProbe()
      void probe()
    }
  })

  if (navigator.onLine === false) {
    patch({ status: "offline" })
    scheduleProbe()
  }
}
