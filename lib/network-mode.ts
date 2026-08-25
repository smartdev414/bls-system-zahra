/**
 * Network modes for students on locked-down corporate networks.
 *
 * Some students join class from an NHS trust, a police force, a school or a
 * council office. Those networks routinely:
 *
 *   - block **all outbound UDP**, which is what WebRTC normally uses for media;
 *   - allow only ports 80/443, so a media server on a high UDP port is
 *     unreachable;
 *   - run a TLS-inspecting proxy that can break long-lived WebSocket upgrades;
 *   - cap bandwidth per user, or share one line across a whole department;
 *   - disable the camera at OS/policy level.
 *
 * WebRTC already has an answer to the first three: relay every packet through a
 * TURN server listening on TCP/TLS 443, which looks like ordinary HTTPS on the
 * wire. LiveKit Cloud runs those TURN servers and hands them to the client
 * automatically — but the client only *uses* them when direct paths fail, and
 * on a hostile network "fail" can take 15-30 seconds of ICE timeouts and often
 * ends with a half-broken connection instead of a clean fallback.
 *
 * Setting `iceTransportPolicy: "relay"` skips straight to the path that works.
 * That is what "Restricted network" mode does. "Minimal data" additionally
 * trims the video the client sends and receives for capped or shared lines.
 *
 * The mode is stored **per device**, not per user account: the restriction
 * belongs to the hospital PC, not to the student, and the same student on their
 * home laptop should get the full-quality path.
 */

import type { RoomConnectOptions, RoomOptions } from "livekit-client"

export type NetworkMode = "standard" | "restricted" | "minimal"

export const NETWORK_MODES: NetworkMode[] = ["standard", "restricted", "minimal"]

export const NETWORK_MODE_LABELS: Record<NetworkMode, string> = {
  standard:   "Standard",
  restricted: "Restricted network",
  minimal:    "Minimal data",
}

export const NETWORK_MODE_DESCRIPTIONS: Record<NetworkMode, string> = {
  standard:
    "Best quality. Uses the fastest direct connection available.",
  restricted:
    "For workplace networks that block video calls. Sends everything through an HTTPS-style connection on port 443, the same port ordinary websites use.",
  minimal:
    "Restricted network plus reduced video quality. For slow, shared or metered connections. Sign language stays readable — the picture is smaller, not slower.",
}

/** Human-readable one-liners for the connection-check verdict. */
export const NETWORK_MODE_VERDICT: Record<NetworkMode, string> = {
  standard:   "Your connection supports the full classroom experience.",
  restricted: "Your network blocks the direct video path. Restricted network mode routes around it.",
  minimal:    "Your connection is tight. Minimal data mode keeps class usable.",
}

const STORAGE_KEY = "bsl:network-mode"
/** Support can send a student a link with ?network=restricted to force a mode. */
const QUERY_PARAM = "network"

function isMode(v: unknown): v is NetworkMode {
  return typeof v === "string" && (NETWORK_MODES as string[]).includes(v)
}

/**
 * The mode this device should use. Reads, in order: an explicit `?network=`
 * query parameter (which is also persisted, so the link only has to be clicked
 * once), then the stored preference, then "standard".
 *
 * Safe to call during render — returns "standard" on the server and whenever
 * storage is unavailable (private browsing, policy-disabled site data), which
 * is itself common on locked-down machines.
 */
export function readNetworkMode(): NetworkMode {
  if (typeof window === "undefined") return "standard"

  try {
    const fromQuery = new URLSearchParams(window.location.search).get(QUERY_PARAM)
    if (isMode(fromQuery)) {
      writeNetworkMode(fromQuery)
      return fromQuery
    }
  } catch { /* malformed URL — fall through to storage */ }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isMode(stored)) return stored
  } catch { /* storage disabled */ }

  return "standard"
}

export function writeNetworkMode(mode: NetworkMode): void {
  try { window.localStorage.setItem(STORAGE_KEY, mode) } catch { /* storage disabled */ }
}

/**
 * The next mode to try after a failed connection attempt. Returns null once
 * there is nothing left to escalate to, which is the signal to stop retrying
 * and show the student the diagnostics instead of spinning forever.
 */
export function escalateNetworkMode(mode: NetworkMode): NetworkMode | null {
  if (mode === "standard")   return "restricted"
  if (mode === "restricted") return "minimal"
  return null
}

// ─── LiveKit options per mode ─────────────────────────────────────────────────

/**
 * `RoomConnectOptions` for a mode.
 *
 * The restricted modes give the handshake noticeably longer than the 15s
 * default: a TLS-inspecting proxy adds a round trip to every step, and a
 * relayed candidate pair has further to travel. Failing at 15s on a network
 * that would have connected at 22s is the single most common "it just doesn't
 * work here" report.
 */
export function connectOptionsFor(mode: NetworkMode): RoomConnectOptions {
  if (mode === "standard") return {}

  return {
    rtcConfig: {
      // Only relayed (TURN) candidates. On LiveKit Cloud these include
      // turns:…:443, which is indistinguishable from HTTPS to a firewall.
      iceTransportPolicy: "relay",
    },
    peerConnectionTimeout: 30_000,
    websocketTimeout:      30_000,
    maxRetries:            3,
  }
}

/**
 * `RoomOptions` for a mode.
 *
 * Note what "minimal" does *not* do: it never drops to audio-only. This is a
 * British Sign Language classroom — video is the lesson, not a nicety. So the
 * savings come from resolution and from not publishing the student's own camera
 * by default, never from turning the tutor's picture off.
 *
 * `degradationPreference: "maintain-framerate"` is deliberate for the same
 * reason. When bandwidth runs short, WebRTC must sacrifice either sharpness or
 * smoothness; fingerspelling and rapid handshapes survive a soft picture far
 * better than they survive dropped frames.
 */
export function roomOptionsFor(mode: NetworkMode): RoomOptions {
  const base: RoomOptions = {
    // Only fetch the resolution each video element actually needs, and pause
    // layers nobody is watching. Both cut a restricted line's load sharply.
    adaptiveStream: true,
    dynacast:       true,
  }

  if (mode === "standard") return base

  if (mode === "restricted") {
    return {
      ...base,
      videoCaptureDefaults: {
        resolution: { width: 640, height: 360, frameRate: 24 },
      },
      publishDefaults: {
        degradationPreference: "maintain-framerate",
        simulcast: true,
      },
    }
  }

  // minimal
  return {
    ...base,
    videoCaptureDefaults: {
      resolution: { width: 320, height: 180, frameRate: 15 },
    },
    publishDefaults: {
      degradationPreference: "maintain-framerate",
      videoEncoding: { maxBitrate: 150_000, maxFramerate: 15 },
      // One layer instead of three: a capped line gains more from not sending
      // the extra simulcast streams than the SFU gains from having them.
      simulcast: false,
    },
  }
}

/** Whether the student's own camera should start off in this mode. */
export function camerasOffByDefault(mode: NetworkMode): boolean {
  return mode === "minimal"
}
