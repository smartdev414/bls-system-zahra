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
/** Tutor's drag-to-reorder of the class grid, mirrored to every client so the
 *  teacher and the class are looking at the same room in the same order. */
export const ORDER_TOPIC     = "cls-order"
/** Tutor's gallery / spotlight choice, mirrored so the class sees the room the
 *  way the teacher has it laid out. */
export const VIEW_TOPIC      = "cls-view"
// Live captions are server-side (Deepgram + LiveKit agent). This topic is kept for
// backwards compatibility if client-side fallback is ever re-enabled.
export const CAPTION_TOPIC   = "cls-captions"
/** Captions a tutor types (or sends from a prepared list) instead of speaking. */
export const TYPED_CAPTION_TOPIC = "cls-typed-caption"

// ─── Hand pointer ─────────────────────────────────────────────────────────────
// The tutor points at a slide and everyone sees a hand follow. Getting this to
// feel immediate is mostly about not throwing away the last position.

/** ~30 fps. Each packet is a few dozen bytes, so the cost of the extra rate is
 *  negligible next to how much smoother the motion reads. */
export const POINTER_SEND_INTERVAL_MS = 33

/**
 * Resend the current position even when the tutor's hand is still.
 *
 * A stationary cursor emits no `pointermove` events at all, so without this the
 * last packet before the tutor stopped moving is the last thing anyone gets —
 * and if that packet was one of the ones dropped by the lossy channel, students
 * are left looking at a stale position while the tutor holds steady on the
 * thing they are talking about. It also gets the pointer to anyone who joined
 * or reconnected mid-gesture.
 */
export const POINTER_KEEPALIVE_MS = 700

/**
 * Last-resort guard on a pointer that will never be taken down.
 *
 * There is deliberately **no** timeout on a stationary pointer. A teacher who
 * points at a diagram and then talks about it for a minute is doing the normal
 * thing, and having the hand fade out under them is the opposite of useful —
 * the whole point is to mark a spot and leave it marked. The pointer comes down
 * when the teacher takes it down, and that instruction travels on the reliable
 * channel, so it arrives.
 *
 * This value only covers the case where no instruction is ever coming: the
 * teacher's browser was killed, or their machine slept, mid-gesture. Because
 * the keepalive is still arriving every 700ms whenever the teacher is present
 * and pointing, fifteen seconds of complete silence means they are not. It is
 * long enough that it can never produce the "it faded while I was pointing at
 * it" complaint this replaced.
 */
export const POINTER_STALE_MS = 15_000

/**
 * Student-side interpolation between samples. Matched to the send interval so
 * the hand arrives at each position just as the next one lands — smooth, with
 * no lag accumulating during a continuous sweep. Longer looked nicer standing
 * still and read as drag while moving, which is the complaint this fixes.
 */
export const POINTER_SMOOTHING_MS = 45

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
