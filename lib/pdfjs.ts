"use client"

/**
 * The one place the app loads pdf.js.
 *
 * Four surfaces render PDFs — the classroom stage, the slide picker, the tutor's
 * thumbnail tray, and the page count taken at upload — and each used to import
 * pdf.js and configure its worker itself. They all configured it the same wrong
 * way, so a browser that disliked that configuration lost every one of them at
 * once.
 *
 * ── The worker ──────────────────────────────────────────────────────────────
 * pdf.js does its parsing in a Web Worker, and a worker script has to be
 * same-origin. When `workerSrc` points somewhere else, pdf.js works around that
 * by writing a tiny same-origin blob that `await import()`s the real script
 * across origins, and starting *that* as a module worker.
 *
 * That indirection is where Safari lost the slides. It does not run the
 * blob-wrapped cross-origin module worker the way Chrome does, and the failure
 * is silent: no `error` event fires, so pdf.js's own fallback to main-thread
 * parsing never triggers either. `getDocument()` simply never settles. On the
 * student's screen that is "Loading presentation…", forever, while the tutor on
 * Chrome sees the deck and has no idea anything is wrong.
 *
 * So we serve the worker ourselves, from `/pdf/`, copied out of the installed
 * `pdfjs-dist` at build time by `scripts/copy-pdf-worker.mjs`. Same origin means
 * pdf.js starts it directly: no blob, no cross-origin import, nothing for Safari
 * to refuse. It also drops a hard runtime dependency on a public CDN being
 * reachable — schools and colleges block those, and a blocked CDN took the
 * slides down exactly the same way.
 *
 * ── The build ───────────────────────────────────────────────────────────────
 * pdfjs-dist ships two builds. The default one targets only the newest browsers
 * and calls `Uint8Array.prototype.toHex`, `Promise.try` and
 * `Map.prototype.getOrInsertComputed` with no fallback — `toHex` on every file
 * it opens. On anything older (an office PC on a pinned Chrome or Edge, Firefox
 * ESR) the worker throws and the student gets "Could not load the presentation."
 * while every other student sees the deck. The legacy build carries polyfills
 * for all of that, so it is the one we load, here and in the worker copy.
 *
 * The CDN stays as a fallback for the one case the local copy can be missing:
 * a build that skipped the copy step. Degraded, but better than a blank stage.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfjsModule = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfDocument = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfPage = any

/** Copied here by `scripts/copy-pdf-worker.mjs`, version-locked to the bundle. */
const LOCAL_WORKER_SRC = "/pdf/pdf.worker.min.mjs"

const cdnWorkerSrc = (version: string) =>
  `https://unpkg.com/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`

/**
 * How long to wait for a PDF to open before calling it a failure.
 *
 * Generous — a large deck over a school connection is legitimately slow — but
 * finite. The whole point of this module is that a student never again sits in
 * front of a spinner with no end and no explanation.
 */
export const PDF_OPEN_TIMEOUT_MS = 30_000

/**
 * Canvas ceilings. Safari (iPadOS and iOS especially, which is most of the
 * students) refuses to back a canvas past a total pixel budget, and it refuses
 * *quietly* — `getContext` succeeds, every draw call succeeds, and the element
 * paints as a blank rectangle. A Retina tablet at full stage width crosses the
 * line without anything looking unreasonable, so clamp before we ask.
 */
const MAX_CANVAS_SIDE = 4_096
const MAX_CANVAS_AREA = 16_000_000

/**
 * Largest render scale that keeps the backing store inside what every browser
 * will actually allocate. `width`/`height` are the page's unscaled dimensions.
 */
export function safeRenderScale(scale: number, width: number, height: number): number {
  if (!(scale > 0) || !(width > 0) || !(height > 0)) return 0

  const sideLimit = Math.min(MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height)
  const areaLimit = Math.sqrt(MAX_CANVAS_AREA / (width * height))

  return Math.min(scale, sideLimit, areaLimit)
}

/**
 * `Promise.withResolvers` for Safari before 17.4.
 *
 * pdf.js 5 uses it, and Safari only shipped it in March 2024 — so on iPadOS 16
 * and 17.0-17.3, which covers a large share of the tablets students bring to
 * class and every device an institution has pinned to an older OS, pdf.js
 * throws `Promise.withResolvers is not a function` and no slide ever appears.
 * The tutor on Chrome sees the deck and has no reason to suspect anything.
 *
 * Two copies of this shim exist by necessity: this one for the main thread, and
 * one prepended to the worker by `scripts/copy-pdf-worker.mjs`, because a worker
 * shares no globals with the page that starts it. Keep them in step.
 */
function installPromiseWithResolvers(): void {
  const P = Promise as unknown as {
    withResolvers?: unknown
  }
  if (typeof P.withResolvers === "function") return

  P.withResolvers = function withResolvers<T>(this: PromiseConstructor) {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new this<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}

let pdfjsPromise: Promise<PdfjsModule> | null = null

/** Load pdf.js once per page and point it at a worker it can actually start. */
export function getPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    // Before the import, so nothing pdf.js runs on the way up can trip over it.
    installPromiseWithResolvers()
    const pdfjsLib: PdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs")
    pdfjsLib.GlobalWorkerOptions.workerSrc = await resolveWorkerSrc(pdfjsLib.version)
    return pdfjsLib
  })()
  return pdfjsPromise
}

/**
 * Prefer the local copy; reach for the CDN only when the server says, in so
 * many words, that the local copy is not there — a deployment whose build
 * skipped `scripts/copy-pdf-worker.mjs`.
 *
 * A HEAD that *throws* is not that answer. It means the request never completed
 * (offline, a proxy interfering, a browser quirk), and in a correctly built
 * deployment the local worker is still the right file and the only one Safari
 * will reliably start. Guessing "CDN" on no evidence would trade the working
 * path for the broken one, so an inconclusive probe keeps the local path.
 */
async function resolveWorkerSrc(version: string): Promise<string> {
  try {
    const res = await fetch(LOCAL_WORKER_SRC, { method: "HEAD" })
    if (res.ok) return LOCAL_WORKER_SRC

    console.warn(
      `[pdfjs] ${LOCAL_WORKER_SRC} is missing (HTTP ${res.status}) — did the build run ` +
      "scripts/copy-pdf-worker.mjs? Falling back to the CDN, which Safari may reject " +
      "and locked-down networks may block.",
    )
    return cdnWorkerSrc(version)
  } catch {
    console.warn(`[pdfjs] could not probe ${LOCAL_WORKER_SRC}; using it anyway.`)
    return LOCAL_WORKER_SRC
  }
}

export class PdfOpenTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`PDF did not open within ${Math.round(timeoutMs / 1000)}s`)
    this.name = "PdfOpenTimeoutError"
  }
}

/**
 * Open a PDF by URL, on a deadline.
 *
 * pdf.js has no timeout of its own: if the worker never answers, or the file
 * never arrives, the promise stays pending for the rest of the lesson. Callers
 * need a failure they can show and offer a retry for, so give them one.
 */
async function attemptOpen(
  url: string,
  timeoutMs: number,
  extra: Record<string, unknown>,
): Promise<PdfDocument> {
  const pdfjsLib = await getPdfjs()
  const task = pdfjsLib.getDocument({ url, withCredentials: false, ...extra })
  // Once we stop awaiting it — because the deadline won the race — a later
  // rejection has nobody listening, and an unhandled one is noise in the
  // console of every browser we are trying to read console output from.
  task.promise.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PdfOpenTimeoutError(timeoutMs)), timeoutMs)
      }),
    ])
  } catch (err) {
    // Stop the abandoned load so a timed-out deck isn't still streaming in the
    // background while the student retries.
    try { await task.destroy() } catch { /* already gone */ }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function openPdf(
  url: string,
  { timeoutMs = PDF_OPEN_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<PdfDocument> {
  try {
    return await attemptOpen(url, timeoutMs, {})
  } catch (err) {
    // A timeout is a slow link, and asking the same question again more slowly
    // does not help. Anything else is worth one more try on the simplest
    // possible request.
    if (err instanceof PdfOpenTimeoutError) throw err

    /**
     * By default pdf.js streams the file in HTTP ranges, which is much kinder
     * to a large deck. It also depends on the storage host returning
     * `Access-Control-Expose-Headers` for `Content-Range`, `Accept-Ranges` and
     * `Content-Length` — and a bucket whose CORS rules predate that, or a proxy
     * that strips them, breaks the ranged path while leaving a plain GET
     * perfectly healthy. Browsers differ in how much of that they paper over,
     * which is exactly how a deck ends up working in one and not another.
     *
     * So: fall back to fetching the whole file in one request. Slower to first
     * paint on a big deck, and it works wherever ordinary CORS works.
     */
    console.warn("[pdfjs] ranged load failed; retrying as a single request", err)
    return attemptOpen(url, timeoutMs, {
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
    })
  }
}
