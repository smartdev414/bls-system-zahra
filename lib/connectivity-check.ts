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
}

export type Verdict = {
  /** The mode the student should use, or null when nothing will work. */
  recommendedMode: NetworkMode | null
  headline: string
  explanation: string
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
  signalling:    "Classroom connection",
  media:         "Live video path",
  relay:         "Secure-network fallback",
  reconnect:     "Staying connected",
  devices:       "Camera and microphone",
  storage:       "Lesson materials",
  notifications: "Messages and alerts",
}

const ESSENTIAL: Record<CheckId, boolean> = {
  browser: true, platform: true, signalling: true, media: true,
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
      explanation:
        "Ask your IT team for a current version of Chrome, Edge, Firefox or Safari. " +
        "No install or plugin is needed beyond the browser itself.",
    }
  }

  if (by("platform").state === "fail") {
    return {
      recommendedMode: null,
      headline: "This network is blocking the platform",
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
      explanation:
        "We can reach the classroom but no video path got through, including the port-443 fallback that " +
        "usually works on secure networks. Your IT team will need to allow the hosts listed below.",
    }
  }

  if (media !== "pass" && relay === "pass") {
    return {
      recommendedMode: "restricted",
      headline: "Use Restricted network mode",
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
      explanation:
        "Your class will work, but your network blocks the direct media path, so everything is being relayed. " +
        "Restricted network mode chooses the working path immediately rather than waiting for the blocked one to fail.",
    }
  }

  const storage = by("storage").state
  if (storage === "fail") {
    return {
      recommendedMode: "standard",
      headline: "Live class works — lesson files don't",
      explanation:
        "You can join and take part, but slides, handouts and recordings are blocked on this network. " +
        "Send the requirements list below to your IT team and ask for the storage host to be allowed.",
    }
  }

  return {
    recommendedMode: "standard",
    headline: "You're ready for class",
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
      // than forcing the student back to the lobby every few minutes.
      running("reconnect")
      try {
        const { ok, detail } = fromCheckInfo(await check.checkReconnect())
        set("reconnect", {
          state: ok ? "pass" : "warn",
          summary: ok
            ? "A brief network wobble will recover on its own."
            : "Reconnecting after a wobble may not work — you might have to rejoin manually.",
          detail,
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
