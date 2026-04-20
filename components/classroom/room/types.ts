export type MsgType = "text" | "reaction" | "system"

export type ChatMsg = {
  id: string
  from: string
  text: string
  ts: number
  type: MsgType
}

export type RaisedHand = {
  identity: string
  name: string
}

export type JoinRequest = {
  id: string
  student: { id: string; name: string; email: string; avatarUrl: string | null }
  message: string | null
  status: "PENDING" | "APPROVED" | "REJECTED"
  responseMessage: string | null
  createdAt: string
  respondedAt: string | null
}

// Tutor-driven presentation protocol. Slides and video share the same topic so
// only one presentation can be live at a time. Each action is tagged so the
// receiver can route (slides → render page, video → mirror playback state).
export type PptAction =
  // ── Slides ─────────────────────────────────────────────────────────────────
  | { action: "start";   url: string; total: number; page: number }
  | { action: "navigate"; page: number }
  | { action: "stop" }
  | { action: "sync_request" }
  | { action: "sync_response"; url: string; total: number; page: number }
  // ── Video ──────────────────────────────────────────────────────────────────
  // `ts` is Date.now() at the tutor; students use it to compensate for
  // network latency when seeking to the target currentTime.
  | { action: "video_start"; url: string }
  | { action: "video_state"; playing: boolean; currentTime: number; ts: number }
  | { action: "video_stop" }
  | { action: "video_sync_response"; url: string; playing: boolean; currentTime: number; ts: number }

export type PointerAction =
  | { action: "move"; x: number; y: number }  // x,y are 0-1 normalized slide coords
  | { action: "hide" }

export type SpotlightAction =
  | { action: "set"; identity: string }
  | { action: "clear" }
  | { action: "sync_request" }
  | { action: "sync_response"; identity: string | null }

// Tutor broadcasts a single action that asks every student to mute their own mic.
// LiveKit clients can't force-mute another participant, so students self-mute on receipt.
export type MuteAction =
  | { action: "mute-all"; from: string }

// Session-level admin actions the tutor can issue to the whole room.
//  - refresh: every client (including tutor) reloads its page — recovery for a frozen session.
export type SessionControlAction =
  | { action: "refresh"; from: string }

// Discriminates on `kind` so the classroom can branch after upload:
//   - "slides" goes through SlidePicker, PptSlideViewer, next/prev, SlideTray.
//   - "video" skips the picker entirely; broadcast URL and mirror playback.
// `total` is only meaningful for slides.
export type UploadedSlides =
  | { kind: "slides"; url: string; total: number; mimeType: string; fileName: string }
  | { kind: "video";  url: string;                 mimeType: string; fileName: string }

export type CaptionEntry = {
  id: string
  speakerName: string
  text: string
  final: boolean
}
