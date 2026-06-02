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

export const POINTER_SEND_INTERVAL_MS = 50  // throttle pointer moves to ~20 fps
export const POINTER_AUTO_HIDE_MS     = 1500

export const enc = new TextEncoder()
export const dec = new TextDecoder()

export const QUICK_REACTIONS = ["👍", "✋", "❓", "👏", "😮", "❤️"]
