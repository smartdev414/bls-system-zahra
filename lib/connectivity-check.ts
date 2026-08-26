"use client"

/**
 * Connection diagnostics for students on locked-down networks.
 *
 * Runs the same connection a live class makes, against the same servers, and
 * reports in plain English what worked. The point is not to reassure — it is to
 * produce something a student can act on:
 *
 *   - "you're fine, join the class";
 *   - "your network blocks the direct video path, switch to Restricted mode"
 *     (which the page then does for them); or
 *   - "your network blocks this outright — here is the exact list of hosts to
 *     send to your IT team".
 *
 * A synthetic ping cannot distinguish those. A TLS-inspecting proxy will happily
 * answer an HTTPS request and then refuse the WebSocket upgrade; a firewall will
 * pass the WebSocket and then silently drop the UDP media. So the checks make
 * real LiveKit connections using a scratch room from /api/connectivity/token.
 */

import { ConnectionCheck, type CheckInfo } from "livekit-client"
import { looksLikeCaptivePortal } from "./network-health"
import type { NetworkMode } from "./network-mode"

/**
 * livekit-client re-exports `CheckStatus` as a *type* from ConnectionCheck.d.ts,
 * which shadows the value export from Checker.d.ts — so it cannot be referenced
 * as a value through the package entry point. These are that enum's values.
 */
const CHECK_STATUS = { IDLE: 0, RUNNING: 1, SKIPPED: 2, SUCCESS: 3, FAILED: 4 } as const

export type CheckId =
  | "browser"
  | "platform"
  | "stability"
  | "signalling"
  | "media"
  | "relay"
  | "reconnect"
  | "devices"
  | "storage"
  | "notifications"

export type CheckState = "pending" | "running" | "pass" | "warn" | "fail" | "skipped"

export type CheckResult = {
  id: CheckId
  title: string
  /** One line the student can understand without knowing what a firewall is. */
  summary: string
  state: CheckState
  /** Technical lines, shown under "details" and included in the IT report. */
  detail: string[]
  /** True when class is impossible if this fails. */
  essential: boolean
  /**
   * A machine-readable cause, where one check has found something the verdict
   * needs to act on specifically rather than by state alone.
   */
  code?: "captive-portal"
}

export type Verdict = {
  /** The mode the student should use, or null when nothing will work. */
  recommendedMode: NetworkMode | null
  headline: string
  explanation: string
  /**
   * How the verdict should read. Not derivable from `recommendedMode`: an
   * unsteady café link needs no mode change and is still bad news, and showing
   * "too unsteady for a live class" in reassuring green is the kind of mixed
   * message that makes a student ignore the page.
   */
   tone: "pass" | "warn" | "fail"
}

export type CheckRun = {
  results: CheckResult[]
  verdict: Verdict
  /** Positive evidence that plain UDP egress works. Null when undetermined. */
  udpAvailable: boolean | null
}

const TITLES: Record<CheckId, string> = {
  browser:       "Browser support",
  platform:      "Platform reachable",
  stability:     "Connection steadiness",
  signalling:    "Classroom connection",
  media:         "Live video path",
  relay:         "Secure-network fallback",
  reconnect:     "Staying connected",
  devices:       "Camera and microphone",
  storage:       "Lesson materials",
  notifications: "Messages and alerts",
}

const ESSENTIAL: Record<CheckId, boolean> = {
  browser: true, platform: true, stability: false, signalling: true, media: true,
  relay: false, reconnect: false, devices: false, storage: true, notifications: false,
}

function blank(id: CheckId): CheckResult {
  return { id, title: TITLES[id], summary: "Waiting…", state: "pending", detail: [], essential: ESSENTIAL[id] }
}

export function initialResults(): CheckResult[] {
  return (Object.keys(TITLES) as CheckId[]).map(blank)
}

type Emit = (results: CheckResult[]) => void

/** Turn a LiveKit CheckInfo into our shape, keeping every log line for IT. */
function fromCheckInfo(info: CheckInfo): { ok: boolean; detail: string[] } {
  return {
    ok: info.status === CHECK_STATUS.SUCCESS,
    detail: info.logs.map((l) => (l.level === "info" ? l.message : `${l.level}: ${l.message}`)),
  }
}

/**
 * livekit-client appends one fixed line — "reconnection is only possible in
 * Redis-based configurations" — to *every* failed reconnect probe, whatever the
 * cause. It is written for people running a single-node self-hosted LiveKit,
 * where Redis supplies the room-to-node routing table that lets a dropped
 * client find its room again. We are on LiveKit Cloud, which is already
 * multi-node and Redis-backed, so the line is never true here — and it reliably
 * sends whoever reads this report hunting for a Redis URL to configure, of
 * which there is none. Drop it and say what actually failed instead.
 */
const SDK_REDIS_HINT = /reconnection is only possible in Redis-based configurations/i

/** What a failed reconnect probe on this deployment actually means, for IT. */
const RECONNECT_NOTE =
  "note: this test drops the connection and allows five seconds for it to recover fully. " +
  "Failing it points at a slow link, or a proxy that is slow to re-open WebSocket connections — " +
  "not at a fault in the classroom service, and a real lesson often reconnects fine. " +
  "If the signalling check also failed, that is the problem to fix first."

/**
 * LiveKit's WebRTC check logs every ICE candidate it sees, tagged with protocol
 * and type. A public (non-private) UDP candidate is direct evidence that this
 * network lets UDP out — which is the single fact that decides whether the
 * student needs Restricted mode. Absence of evidence is reported as unknown
 * rather than as a blocked path.
 */
function detectUdp(detail: string[]): boolean | null {
  const sawCandidates = detail.some((d) => /\b(udp|tcp)\b.*\b(srflx|host|relay|prflx)\b/.test(d))
  if (!sawCandidates) return null
  return detail.some((d) => /^udp\b/.test(d) && !d.includes("(private)"))
}

async function timeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  })
  try {
    return await Promise.race([p, guard])
  } finally {
    clearTimeout(timer!)
  }
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkBrowser(): CheckResult {
  const detail: string[] = [navigator.userAgent]
  const missing: string[] = []

  if (typeof RTCPeerConnection === "undefined") missing.push("WebRTC (RTCPeerConnection)")
  if (typeof WebSocket === "undefined") missing.push("WebSockets")
  if (!navigator.mediaDevices) missing.push("camera/microphone access (navigator.mediaDevices)")
  if (!window.isSecureContext) missing.push("a secure (HTTPS) context")

  let storageOk = true
  try {
    window.localStorage.setItem("bsl:probe", "1")
    window.localStorage.removeItem("bsl:probe")
  } catch {
    storageOk = false
  }
  if (!storageOk) {
    detail.push(
      "Browser storage is disabled by policy or private browsing. The platform works without it; " +
      "only conveniences such as restoring a half-typed chat message after a reload are lost.",
    )
  }

  if (missing.length > 0) {
    return {
      ...blank("browser"),
      state: "fail",
      summary: `This browser is missing ${missing.join(", ")}.`,
      detail: [...detail, `Missing: ${missing.join(", ")}`],
    }
  }

  return {
    ...blank("browser"),
    state: storageOk ? "pass" : "warn",
    summary: storageOk
      ? "Your browser supports everything the classroom needs."
      : "Your browser can run the classroom, but site data is blocked — a few conveniences will be lost.",
    detail,
  }
}

async function checkPlatform(): Promise<CheckResult> {
  try {
    const res = await timeout(fetch("/api/health", { cache: "no-store" }), 15_000, "Platform check")

    // A captive portal answers confidently in our place, so every naive check
    // passes and the failure surfaces much later as a JSON parse error inside
    // something unrelated. Catching it here is the difference between "sign in
    // to the café Wi-Fi" and twenty minutes of blaming the platform.
    if (looksLikeCaptivePortal(res)) {
      return {
        ...blank("platform"),
        state: "fail",
        code: "captive-portal",
        summary:
          "This Wi-Fi is intercepting your connection. Open a new tab, load any website, " +
          "complete the Wi-Fi sign-in, then run this test again.",
        detail: [
          `HTTP ${res.status} from /api/health`,
          `Final URL: ${res.url}`,
          `Content-Type: ${res.headers.get("content-type") ?? "(none)"}`,
          "A login or terms page answered instead of the platform. This is normal on café, " +
          "hotel, airport and train Wi-Fi and is not a fault with your computer or with us.",
        ],
      }
    }

    const body = await res.json().catch(() => null) as
      | { status?: string; db?: boolean; config?: Record<string, boolean> }
      | null

    const detail = [`HTTP ${res.status} from /api/health`]
    if (body?.config) {
      detail.push(
        ...Object.entries(body.config).map(([k, v]) => `${k}: ${v ? "configured" : "NOT configured"}`),
      )
    }

    if (!res.ok || body?.db === false) {
      return {
        ...blank("platform"),
        state: "fail",
        summary: "The platform is reachable but reporting a fault. This is a problem at our end, not yours.",
        detail,
      }
    }
    return {
      ...blank("platform"),
      state: "pass",
      summary: "The platform loads normally on this network.",
      detail,
    }
  } catch (err) {
    return {
      ...blank("platform"),
      state: "fail",
      summary: "Could not reach the platform. Your network may be blocking it.",
      detail: [String(err)],
    }
  }
}

/**
 * How steady the link is, as opposed to whether it exists.
 *
 * Every other check here answers a yes/no question — can we reach the signal
 * server, does UDP get out, is the storage host allowed. A café connection
 * passes all of them and still fails a lesson, because what it actually does is
 * work, then not work, then work again. That is invisible to a single request
 * and obvious over ten seconds of them.
 *
 * So: a short burst of small, uncached requests, timing each. Three numbers
 * come out — how many never arrived, how long a round trip takes, and how much
 * that varies. The third is the one that matters for live video. A steady 300ms
 * link carries a class perfectly well; a link that swings between 40ms and
 * 900ms is one that will freeze, because the jitter buffer has to choose
 * between adding delay and dropping frames, and dropping frames is what
 * destroys fingerspelling.
 */
async function checkStability(): Promise<CheckResult> {
  const PROBES = 6
  const PROBE_TIMEOUT_MS = 4_000
  // Enough consecutive losses to call it: continuing just makes an already
  // stuck student wait longer for a conclusion they can already guess.
  const ABANDON_AFTER_FAILURES = 3

  const rtts: number[] = []
  let failures = 0
  let portal = false

  for (let i = 0; i < PROBES; i++) {
    const started = performance.now()
    try {
      // A cache-busting query keeps a proxy from answering out of its own store,
      // which would measure the proxy rather than the link.
      const res = await timeout(
        fetch(`/api/health?probe=${i}-${Math.random().toString(36).slice(2)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        }),
        PROBE_TIMEOUT_MS,
        "Steadiness probe",
      )
      if (looksLikeCaptivePortal(res)) { portal = true; break }
      // Drain the body: timing the headers alone would miss a link that stalls
      // partway through a response, which is the classic shared-Wi-Fi failure.
      await res.text()
      rtts.push(performance.now() - started)
    } catch {
      failures++
      if (failures >= ABANDON_AFTER_FAILURES) break
    }
  }

  if (portal) {
    return {
      ...blank("stability"),
      state: "fail",
      code: "captive-portal",
      summary: "A Wi-Fi sign-in page is answering instead of us. Complete the Wi-Fi login and test again.",
      detail: ["A captive portal intercepted the steadiness probes."],
    }
  }

  if (rtts.length === 0) {
    return {
      ...blank("stability"),
      state: "fail",
      summary: "Nothing got through. Your connection is down or being blocked.",
      detail: [`${failures} of ${PROBES} probes failed or timed out.`],
    }
  }

  const sorted = [...rtts].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const spread = sorted[sorted.length - 1] - sorted[0]
  const loss = failures / (rtts.length + failures)

  const detail = [
    `Probes: ${rtts.length + failures} sent, ${failures} lost`,
    `Round trip: median ${Math.round(median)}ms, fastest ${Math.round(sorted[0])}ms, slowest ${Math.round(sorted[sorted.length - 1])}ms`,
    `Variation: ${Math.round(spread)}ms`,
  ]

  // Thresholds are deliberately forgiving. This measures an HTTPS round trip
  // through whatever proxy sits in the way, not raw network latency, so a
  // healthy home line commonly reads 150-300ms here. The aim is to separate
  // "unremarkable" from "this will visibly break", not to grade connections.
  if (loss > 0.15 || median > 1_200 || spread > 1_500) {
    return {
      ...blank("stability"),
      state: "fail",
      summary:
        "This connection is too unsteady for a live class. Video will freeze and you may be dropped.",
      detail,
    }
  }

  if (failures > 0 || median > 600 || spread > 600) {
    return {
      ...blank("stability"),
      state: "warn",
      summary:
        "Your connection works but wobbles. Class will run; expect the picture to soften at times.",
      detail,
    }
  }

  return {
    ...blank("stability"),
    state: "pass",
    summary: "Your connection is steady enough for live video.",
    detail,
  }
}

async function checkDevices(): Promise<CheckResult> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return {
      ...blank("devices"),
      state: "warn",
      summary: "This browser will not let the page see your camera or microphone.",
      detail: ["navigator.mediaDevices.enumerateDevices is unavailable"],
    }
  }

  try {
    // Labels are hidden until permission is granted, so ask first — but treat a
    // refusal as information, not failure. A student with a policy-disabled
    // camera can still attend, watch, read captions and use chat.
    let granted = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      stream.getTracks().forEach((t) => t.stop())
      granted = true
    } catch { /* denied, blocked by policy, or no device */ }

    const devices = await navigator.mediaDevices.enumerateDevices()
    const cams = devices.filter((d) => d.kind === "videoinput")
    const mics = devices.filter((d) => d.kind === "audioinput")
    const detail = [
      `cameras: ${cams.length}`,
      `microphones: ${mics.length}`,
      `permission granted: ${granted}`,
      ...devices.map((d) => `${d.kind}: ${d.label || "(label hidden until permission granted)"}`),
    ]

    if (cams.length === 0) {
      return {
        ...blank("devices"),
        state: "warn",
        summary: "No camera found. You can still attend, watch and use chat — you just won't be seen signing.",
        detail,
      }
    }
    if (!granted) {
      return {
        ...blank("devices"),
        state: "warn",
        summary: "A camera exists but access was refused. That may be your choice, or a policy on this computer.",
        detail,
      }
    }
    return {
      ...blank("devices"),
      state: "pass",
      summary: `Camera and microphone are available (${cams.length} camera${cams.length === 1 ? "" : "s"}).`,
      detail,
    }
  } catch (err) {
    return {
      ...blank("devices"),
      state: "warn",
      summary: "Could not check your camera and microphone.",
      detail: [String(err)],
    }
  }
}

async function checkStorage(host: string | null): Promise<CheckResult> {
  if (!host) {
    return { ...blank("storage"), state: "skipped", summary: "File storage is not configured on this server.", detail: [] }
  }
  try {
    // `no-cors` gives an opaque response: we learn nothing about the status
    // code, but a *network* failure still rejects — which is exactly the signal
    // we want, because a blocked host fails to connect at all.
    await timeout(fetch(`https://${host}/`, { mode: "no-cors", cache: "no-store" }), 12_000, "Storage check")
    return {
      ...blank("storage"),
      state: "pass",
      summary: "Lesson materials, slides and recordings will download normally.",
      detail: [`reached https://${host}/`],
    }
  } catch (err) {
    return {
      ...blank("storage"),
      state: "fail",
      summary: "Your network is blocking our file storage. Slides, handouts and recordings will not load.",
      detail: [`https://${host}/ — ${String(err)}`],
    }
  }
}

async function checkNotifications(configured: boolean): Promise<CheckResult> {
  if (!configured) {
    return { ...blank("notifications"), state: "skipped", summary: "Notifications are not configured on this server.", detail: [] }
  }

  const key = process.env.NEXT_PUBLIC_PUSHER_KEY
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
  if (!key || !cluster) {
    return { ...blank("notifications"), state: "skipped", summary: "Notifications are not configured on this server.", detail: [] }
  }

  const { default: Pusher } = await import("pusher-js")
  const client = new Pusher(key, {
    cluster,
    forceTLS: true,
    authEndpoint: "/api/pusher/auth",
  })

  try {
    await timeout(
      new Promise<void>((resolve, reject) => {
        client.connection.bind("connected", () => resolve())
        client.connection.bind("failed", () => reject(new Error("connection failed")))
        client.connection.bind("unavailable", () => reject(new Error("service unavailable")))
      }),
      20_000,
      "Notifications check",
    )
    return {
      ...blank("notifications"),
      state: "pass",
      summary: "Messages and 'your class is starting' alerts will arrive live.",
      detail: [`connected via ${client.connection.state}`],
    }
  } catch (err) {
    return {
      ...blank("notifications"),
      state: "warn",
      summary:
        "Live notifications are blocked. Class still works — messages and alerts appear when you refresh the page.",
      detail: [String(err)],
    }
  } finally {
    try { client.disconnect() } catch { /* already gone */ }
  }
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

function decide(results: CheckResult[], udpAvailable: boolean | null): Verdict {
  const by = (id: CheckId) => results.find((r) => r.id === id)!

  if (by("browser").state === "fail") {
    return {
      recommendedMode: null,
      headline: "This browser can't run the classroom",
      tone: "fail",
      explanation:
        "Ask your IT team for a current version of Chrome, Edge, Firefox or Safari. " +
        "No install or plugin is needed beyond the browser itself.",
    }
  }

  // Before anything else: if a Wi-Fi login page is answering in our place, every
  // other result below is a measurement of the portal, not of the network. The
  // fix takes ten seconds and has nothing to do with us.
  if (results.some((r) => r.code === "captive-portal")) {
    return {
      recommendedMode: null,
      headline: "Sign in to this Wi-Fi first",
      tone: "fail",
      explanation:
        "A Wi-Fi login or terms page is answering instead of the platform, so nothing here could be " +
        "tested properly. Open a new tab, load any website, complete the Wi-Fi sign-in, then run this " +
        "test again. This is normal on café, hotel, airport and train networks.",
    }
  }

  if (by("platform").state === "fail") {
    return {
      recommendedMode: null,
      headline: "This network is blocking the platform",
      tone: "fail",
      explanation:
        "The site itself could not be reached. Send your IT team the requirements list below — " +
        "they need to allow our address before anything else can be tested.",
    }
  }

  const signalling = by("signalling").state
  const media = by("media").state
  const relay = by("relay").state

  if (signalling === "fail") {
    return {
      recommendedMode: null,
      headline: "This network is blocking live classes",
      tone: "fail",
      explanation:
        "The classroom connection could not be established. This is almost always a firewall or web filter " +
        "rather than a fault with your computer. Send the requirements list below to your IT team — " +
        "it names the exact hosts and ports they need to allow.",
    }
  }

  if (media !== "pass" && relay !== "pass") {
    return {
      recommendedMode: null,
      headline: "Live video is blocked on this network",
      tone: "fail",
      explanation:
        "We can reach the classroom but no video path got through, including the port-443 fallback that " +
        "usually works on secure networks. Your IT team will need to allow the hosts listed below.",
    }
  }

  if (media !== "pass" && relay === "pass") {
    return {
      recommendedMode: "restricted",
      headline: "Use Restricted network mode",
      tone: "warn",
      explanation:
        "The normal video path is blocked here, but the port-443 fallback works. Restricted network mode " +
        "uses it from the start, so you join quickly instead of waiting for the blocked path to time out.",
    }
  }

  // Media path works. Prefer restricted anyway when the direct path was never
  // actually direct — relaying is what is happening regardless, and choosing it
  // up front removes 15-30 seconds of ICE timeouts from every join.
  if (udpAvailable === false) {
    return {
      recommendedMode: "restricted",
      headline: "Use Restricted network mode",
      tone: "warn",
      explanation:
        "Your class will work, but your network blocks the direct media path, so everything is being relayed. " +
        "Restricted network mode chooses the working path immediately rather than waiting for the blocked one to fail.",
    }
  }

  // The link works and the route works. What is left is whether the link is
  // steady enough to hold a lesson — the question a café connection fails.
  const stability = by("stability").state
  if (stability === "fail") {
    return {
      recommendedMode: "standard",
      headline: "This connection is too unsteady for a live class",
      tone: "fail",
      explanation:
        "Everything is reachable, but the connection itself keeps stalling — video will freeze and you " +
        "may be dropped mid-lesson. A phone hotspot is very often steadier than shared public Wi-Fi. " +
        "If you have to stay on this network, sit closer to the router and close other tabs and devices " +
        "using it. The classroom will lower your video quality by itself when it detects this.",
    }
  }

  const storage = by("storage").state
  if (storage === "fail") {
    return {
      recommendedMode: "standard",
      headline: "Live class works — lesson files don't",
      tone: "warn",
      explanation:
        "You can join and take part, but slides, handouts and recordings are blocked on this network. " +
        "Send the requirements list below to your IT team and ask for the storage host to be allowed.",
    }
  }

  if (stability === "warn") {
    return {
      recommendedMode: "standard",
      headline: "Ready for class — but keep an eye on the connection",
      tone: "warn",
      explanation:
        "Everything works and you can join now. Your connection is a little uneven, which usually shows " +
        "up as the picture softening for a few seconds at a time. The classroom handles that by itself; " +
        "it will tell you on screen if it has to reduce your video quality, and it will put you back into " +
        "class automatically if the connection drops.",
    }
  }

  return {
    recommendedMode: "standard",
    headline: "You're ready for class",
    tone: "pass",
    explanation:
      "Everything the classroom needs works on this network, on the fastest available path.",
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

type Config = {
  storageHost: string | null
  livekitConfigured: boolean
  pusherConfigured: boolean
}

/**
 * Runs the full check, emitting after every step so the UI can show progress.
 * Never throws: a check that blows up becomes a failed row, because a
 * diagnostics page that itself errors is worse than useless to someone who is
 * already stuck.
 */
export async function runConnectivityCheck(config: Config, emit: Emit): Promise<CheckRun> {
  const results = initialResults()
  const set = (id: CheckId, patch: Partial<CheckResult>) => {
    const i = results.findIndex((r) => r.id === id)
    results[i] = { ...results[i], ...patch }
    emit([...results])
  }
  const running = (id: CheckId) => set(id, { state: "running", summary: "Checking…" })

  running("browser")
  set("browser", checkBrowser())

  running("platform")
  set("platform", await checkPlatform())

  running("stability")
  set("stability", await checkStability())

  let udpAvailable: boolean | null = null

  // ── LiveKit checks: real connections to the real media servers ──
  if (!config.livekitConfigured) {
    for (const id of ["signalling", "media", "relay", "reconnect"] as CheckId[]) {
      set(id, { state: "skipped", summary: "Live classroom is not configured on this server." })
    }
  } else {
    running("signalling")
    let creds: { token: string; wsUrl: string } | null = null
    try {
      const res = await timeout(fetch("/api/connectivity/token", { method: "POST" }), 15_000, "Diagnostic token")
      if (!res.ok) throw new Error(`token request returned HTTP ${res.status}`)
      creds = await res.json() as { token: string; wsUrl: string }
    } catch (err) {
      for (const id of ["signalling", "media", "relay", "reconnect"] as CheckId[]) {
        set(id, {
          state: id === "signalling" ? "fail" : "skipped",
          summary: id === "signalling"
            ? "Could not start the classroom test."
            : "Skipped — the classroom test could not start.",
          detail: [String(err)],
        })
      }
    }

    if (creds) {
      const check = new ConnectionCheck(creds.wsUrl, creds.token)

      // Signalling — the WebSocket upgrade. The step TLS-inspecting proxies break.
      try {
        const { ok, detail } = fromCheckInfo(await check.checkWebsocket())
        set("signalling", {
          state: ok ? "pass" : "fail",
          summary: ok
            ? "The classroom's control connection works on this network."
            : "The classroom's control connection is blocked. This is usually a web filter or proxy.",
          detail,
        })
      } catch (err) {
        set("signalling", {
          state: "fail",
          summary: "The classroom's control connection is blocked.",
          detail: [String(err)],
        })
      }

      // Media — a full WebRTC connection on the default path.
      running("media")
      try {
        const { ok, detail } = fromCheckInfo(await check.checkWebRTC())
        udpAvailable = detectUdp(detail)
        set("media", {
          state: ok ? "pass" : "fail",
          summary: ok
            ? udpAvailable === false
              ? "Live video connects, but only by relaying — the direct path is blocked here."
              : "Live video connects on the fastest path."
            : "Live video could not connect on the normal path.",
          detail,
        })
      } catch (err) {
        set("media", {
          state: "fail",
          summary: "Live video could not connect on the normal path.",
          detail: [String(err)],
        })
      }

      // Relay — the port-443 fallback, i.e. exactly what Restricted mode uses.
      running("relay")
      try {
        const info = await check.checkTURN()
        const { ok, detail } = fromCheckInfo(info)
        set("relay", {
          state: info.status === CHECK_STATUS.SKIPPED ? "skipped" : ok ? "pass" : "fail",
          summary: ok
            ? "The secure-network fallback works — Restricted network mode will connect here."
            : "The secure-network fallback did not connect.",
          detail,
        })
      } catch (err) {
        set("relay", {
          state: "fail",
          summary: "The secure-network fallback did not connect.",
          detail: [String(err)],
        })
      }

      // Reconnect — proves the proxy will let a dropped session resume, rather
      // than forcing the student back to the lobby every few minutes. The probe
      // gives the room five seconds flat to come back, so a network that is
      // merely slow fails it; that is why this is a warning and never a failure.
      running("reconnect")
      try {
        const { ok, detail } = fromCheckInfo(await check.checkReconnect())
        set("reconnect", {
          state: ok ? "pass" : "warn",
          summary: ok
            ? "A brief network wobble will recover on its own."
            : "Recovery took longer than the five seconds this test allows — usually a slow link or a proxy that is slow to re-open the connection.",
          detail: ok ? detail : [...detail.filter((d) => !SDK_REDIS_HINT.test(d)), RECONNECT_NOTE],
        })
      } catch (err) {
        set("reconnect", {
          state: "warn",
          summary: "Could not test reconnection.",
          detail: [String(err)],
        })
      }
    }
  }

  running("devices")
  set("devices", await checkDevices())

  running("storage")
  set("storage", await checkStorage(config.storageHost))

  running("notifications")
  set("notifications", await checkNotifications(config.pusherConfigured))

  const verdict = decide(results, udpAvailable)
  return { results, verdict, udpAvailable }
}

// ─── IT report ────────────────────────────────────────────────────────────────

/**
 * A plain-text report the student can paste into an IT ticket. Deliberately
 * plain text: service-desk systems mangle rich text, and the person reading it
 * needs the facts, not our styling.
 */
export function buildItReport(run: CheckRun, opts: { appHost: string | null; userAgent: string }): string {
  const lines: string[] = []
  lines.push("BSL Learning Platform — connection test result")
  lines.push(`Run at: ${new Date().toISOString()}`)
  if (opts.appHost) lines.push(`Platform: https://${opts.appHost}`)
  lines.push(`Browser: ${opts.userAgent}`)
  lines.push("")
  lines.push(`VERDICT: ${run.verdict.headline}`)
  lines.push(run.verdict.explanation)
  lines.push("")
  lines.push("RESULTS")
  for (const r of run.results) {
    lines.push(`  [${r.state.toUpperCase()}] ${r.title} — ${r.summary}`)
    for (const d of r.detail) lines.push(`        ${d}`)
  }
  lines.push("")
  if (opts.appHost) {
    lines.push(`Full network requirements for the IT team: https://${opts.appHost}/it-requirements`)
  } else {
    lines.push("Full network requirements for the IT team: /it-requirements on this site")
  }
  return lines.join("\n")
}
