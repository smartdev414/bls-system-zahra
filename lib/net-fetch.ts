"use client"

/**
 * `fetch` with a deadline, a diagnosis, and no way to hang forever.
 *
 * The browser's own `fetch` has no timeout. On a healthy network that never
 * matters, because something always answers. On café or hotel Wi-Fi it is the
 * whole problem: the access point accepts the connection and then delivers
 * nothing, and the promise stays pending until Chrome's internal limit — which
 * is minutes, not seconds. Every caller waiting on it stays in its loading
 * state, spinners keep turning, buttons stay disabled. Nothing has crashed and
 * nothing will recover. That is what "it kept freezing" looks like from the
 * inside, and no amount of retry logic further up helps, because the request
 * that would trigger the retry never finishes.
 *
 * So: every request gets an `AbortController` and a deadline. Failures are
 * classified rather than lumped together, because "your Wi-Fi needs you to
 * sign in", "you're offline" and "our server said no" need three different
 * things from the user. Outcomes are reported to `lib/network-health.ts`, which
 * owns the recovery probe and the banner.
 *
 * Retries are for GET only, and only for link failures. Replaying a POST
 * because the response was slow is how a student ends up joining a class twice
 * or sending the same chat message three times.
 */

import {
  looksLikeCaptivePortal, reportNetworkFailure, reportNetworkSuccess,
  type NetFailureKind,
} from "./network-health"

/**
 * Long enough to survive an ordinary slow request on a shared line, short
 * enough that a stalled one is visibly a failure rather than a freeze.
 */
export const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Background polling deadline. Must stay below the shortest poll interval
 * (8s in the classroom) so a stalled request cannot outlive the tick that
 * replaces it and pile up behind the browser's per-host connection limit —
 * which stalls every *other* request on the page too, including the ones the
 * student is actually waiting for.
 */
export const POLL_TIMEOUT_MS = 6_000

export type NetFetchOptions = {
  /** Deadline in ms. */
  timeoutMs?: number
  /**
   * Extra attempts after the first, for link failures only. Ignored for
   * anything but GET — see the note above about replayed mutations.
   */
  retries?: number
  /** Caller's own abort signal, honoured alongside the deadline. */
  signal?: AbortSignal
  /**
   * Set false for background work (polling, prefetch) so a failure does not
   * move the global banner. A poll failing while the user is idle is not worth
   * a "you're offline" bar; the next foreground request will say so if it is
   * genuinely down.
   */
  report?: boolean
}

/**
 * Structurally compatible with the `FetchError` shape `hooks/use-fetch.ts`
 * already throws, so existing `catch` blocks and error toasts keep working.
 */
export class NetError extends Error {
  readonly kind: NetFailureKind
  readonly status?: number
  readonly details?: unknown

  constructor(kind: NetFailureKind, message: string, status?: number, details?: unknown) {
    super(message)
    this.name = "NetError"
    this.kind = kind
    this.status = status
    this.details = details
  }
}

/** Plain-English message per failure, written for the person, not the log. */
const MESSAGE: Record<NetFailureKind, string> = {
  offline:
    "You appear to be offline. We'll keep trying — nothing is lost.",
  timeout:
    "The network didn't respond in time. This is usually a busy or unstable Wi-Fi connection.",
  "captive-portal":
    "This Wi-Fi needs you to sign in first. Open a new tab, load any website, complete the Wi-Fi login, then come back.",
  server:
    "Request failed.",
  unknown:
    "Something went wrong reaching the platform.",
}

export function messageFor(kind: NetFailureKind): string {
  return MESSAGE[kind]
}

const RETRY_BACKOFF_MS = [400, 1_200, 2_500]

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isGet(init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase()
  return method === "GET" || method === "HEAD"
}

/**
 * One attempt, with a deadline. Resolves with the response even for 4xx/5xx —
 * an answer from us is a working link, whatever it says.
 */
async function attempt(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  external: AbortSignal | undefined,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  const onExternalAbort = () => controller.abort()
  external?.addEventListener("abort", onExternalAbort)

  try {
    const res = await fetch(input, { ...init, signal: controller.signal })

    if (looksLikeCaptivePortal(res)) {
      throw new NetError("captive-portal", MESSAGE["captive-portal"], res.status)
    }
    return res
  } catch (err) {
    if (err instanceof NetError) throw err

    // The caller cancelled — a navigation, an unmount, a superseded search.
    // Not a network event, and must not touch the health status.
    if (external?.aborted) {
      throw new NetError("unknown", "Request cancelled")
    }
    if (timedOut) {
      throw new NetError("timeout", MESSAGE.timeout)
    }
    // A TypeError from `fetch` means the request never completed at the
    // transport level: DNS, TLS, connection refused, or no network at all.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new NetError("offline", MESSAGE.offline)
    }
    throw new NetError("offline", MESSAGE.offline, undefined, String(err))
  } finally {
    clearTimeout(timer)
    external?.removeEventListener("abort", onExternalAbort)
  }
}

/**
 * The request every other layer should use. Returns the `Response` — including
 * error statuses — or throws a `NetError` describing what the network did.
 */
export async function netFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: NetFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = isGet(init) ? 1 : 0,
    signal,
    report = true,
  } = options

  const maxAttempts = 1 + Math.max(0, isGet(init) ? retries : 0)
  let last: NetError | null = null

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await attempt(input, init, timeoutMs, signal)
      if (report) reportNetworkSuccess()
      return res
    } catch (err) {
      last = err instanceof NetError
        ? err
        : new NetError("unknown", MESSAGE.unknown, undefined, String(err))

      // A cancelled request is not a failure and never retries.
      if (signal?.aborted) throw last

      // A captive portal will answer the retry exactly the same way, and each
      // attempt costs the user another deadline's worth of waiting.
      if (last.kind === "captive-portal") break

      const isLast = i === maxAttempts - 1
      if (isLast) break
      await sleep(RETRY_BACKOFF_MS[Math.min(i, RETRY_BACKOFF_MS.length - 1)])
    }
  }

  if (report && last) reportNetworkFailure(last.kind)
  throw last ?? new NetError("unknown", MESSAGE.unknown)
}

/**
 * `netFetch` plus JSON parsing, for callers that only want the body. Throws a
 * `NetError` for both network failures and error statuses, so one `catch`
 * covers everything and `kind` says which happened.
 */
export async function netJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: NetFetchOptions = {},
): Promise<T> {
  const res = await netFetch(input, init, options)
  const type = res.headers.get("content-type") ?? ""
  const body = type.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "")

  if (!res.ok) {
    const message =
      (typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ??
      (typeof body === "string" && body.length ? body : null) ??
      `Request failed (${res.status})`
    throw new NetError("server", message, res.status, body)
  }

  return body as T
}
