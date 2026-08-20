// ─── Data channel topics ──────────────────────────────────────────────────────

export const CHAT_TOPIC      = "cls-chat"
export const HAND_TOPIC      = "cls-hand"
export const PPT_TOPIC       = "cls-ppt"
export const POINTER_TOPIC   = "cls-pointer"
export const SPOTLIGHT_TOPIC = "cls-spotlight"
export const MUTE_TOPIC      = "cls-mute-all"
export const CONTROL_TOPIC   = "cls-control"
export const WHITEBOARD_TOPIC = "cls-whiteboard"
export const BREAKOUT_TOPIC       = "cls-breakouts"
/** Seconds shown to everyone after tutor clicks End breakouts before the room resets. */
export const BREAKOUT_WRAP_UP_SEC = 30
export const NUDGE_TOPIC     = "cls-nudge"
export const SCREEN_TOPIC    = "cls-screen"
// Live captions are server-side (Deepgram + LiveKit agent). This topic is kept for
// backwards compatibility if client-side fallback is ever re-enabled.
export const CAPTION_TOPIC   = "cls-captions"

export const POINTER_SEND_INTERVAL_MS = 50  // throttle pointer moves to ~20 fps
export const POINTER_AUTO_HIDE_MS     = 1500

export const enc = new TextEncoder()
export const dec = new TextDecoder()

export const QUICK_REACTIONS = ["👍", "✋", "❓", "👏", "😮", "❤️"]

// How many chat messages are kept in sessionStorage so the conversation
// survives a reload or a dropped connection. Enough to scroll back through a
// breakout discussion without risking the storage quota.
export const CHAT_HISTORY_LIMIT = 300

// ─── Screen share quality ─────────────────────────────────────────────────────
// A shared screen is mostly small, static text, and it lands in a panel that is
// often only half the stage wide — so every pixel of capture resolution and
// every bit of bitrate shows up directly as readable (or unreadable) text.
// LiveKit's defaults are tuned for motion: 1080p capture at ~2.5 Mbps with
// simulcast on. These override that in three ways:
//   • capture up to 1440p, so a Retina / QHD screen isn't downscaled on capture
//   • `contentHint: "text"` tells the encoder to hold detail and sacrifice
//     framerate — exactly the right trade for slides and documents
//   • a single high-bitrate layer (no simulcast) with maintain-resolution
//     degradation, so a busy network drops frames rather than sharpness
//
// Safari 17 has a bug where specifying *any* resolution yields a low-resolution
// capture, so we leave the constraint off there and take its native default.
// https://bugs.webkit.org/show_bug.cgi?id=263015
const IS_SAFARI =
  typeof navigator !== "undefined" &&
  /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)

export const SCREEN_SHARE_CAPTURE = {
  audio: false,
  contentHint: "text" as const,
  // Let the teacher swap the shared window mid-lesson without restarting.
  surfaceSwitching: "include" as const,
  // Sharing the classroom tab itself is a hall-of-mirrors; keep it out of the picker.
  selfBrowserSurface: "exclude" as const,
  ...(IS_SAFARI ? {} : { resolution: { width: 2560, height: 1440, frameRate: 15 } }),
}

export const SCREEN_SHARE_PUBLISH = {
  screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 15, priority: "high" as const },
  simulcast: false,
  degradationPreference: "maintain-resolution" as const,
}

/** Zoom limits for the student-side magnifier on a shared screen. */
export const SCREEN_ZOOM_MIN  = 1
export const SCREEN_ZOOM_MAX  = 5
export const SCREEN_ZOOM_STEP = 0.25
