export type MsgType = "text" | "reaction" | "system"

export type ChatAttachment = {
  fileUrl: string
  fileName: string
  fileSize: number
  mimeType: string
}

export type ChatMsg = {
  id: string
  from: string
  text: string
  ts: number
  type: MsgType
  attachment?: ChatAttachment
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

// Tutor-driven microphone control. Students cannot toggle their own mic in the UI;
// they apply these commands locally and the tutor also updates LiveKit permissions
// server-side so unmute can't be bypassed.
export type MuteAction =
  | { action: "mute-all"; from: string }
  | { action: "set-mic"; identity: string; enabled: boolean; from: string }
  // Student → tutor: ask to speak. The tutor can acknowledge without unmuting.
  | { action: "request-speak"; identity: string; name: string }
  // Tutor → student: the request was acknowledged; mic stays off until enabled.
  | { action: "accept-speak"; identity: string; from: string }
  // Tutor → student: their request was declined (mic stays off).
  | { action: "deny-speak"; identity: string; from: string }

// Session-level admin actions the tutor can issue to the whole room.
//  - refresh: every client (including tutor) reloads its page — recovery for a frozen session.
export type SessionControlAction =
  | { action: "refresh"; from: string }

// ─── Whiteboard ───────────────────────────────────────────────────────────────
// Collaborative drawing surface powered by tldraw. The classroom shell stays
// agnostic of tldraw's record internals: local edits are broadcast as opaque
// tldraw store diffs (`doc`) and late joiners receive a full tldraw store
// snapshot (`sync_response`). The shell only owns the lifecycle (open/close)
// and the student-write permission; tldraw owns the document state.

// A tldraw `RecordsDiff`, serialised as-is over the wire. Records are plain
// JSON objects keyed by id; `updated` carries [from, to] tuples.
export type WhiteboardDiff = {
  added?: Record<string, unknown>
  updated?: Record<string, [unknown, unknown]>
  removed?: Record<string, unknown>
}

// A tldraw store snapshot (`getSnapshot(store)` output) — opaque JSON.
export type WhiteboardSnapshot = Record<string, unknown>

// A serialised tldraw `TLInstancePresence` record — one peer's live cursor,
// selection and camera. Carried opaquely; tldraw renders it as a collaborator
// cursor once merged into the receiver's store. Broadcast lossily (high churn).
export type WhiteboardPresence = Record<string, unknown>

export type WhiteboardAction =
  | { action: "start" }                                            // tutor opens the board for everyone
  | { action: "stop" }                                             // tutor closes the board
  | { action: "student_write"; enabled: boolean }                  // tutor allows/revokes student drawing
  | { action: "doc"; changes: WhiteboardDiff }                     // incremental tldraw store changes
  | { action: "presence"; presence: WhiteboardPresence }           // live cursor/presence for one peer
  | { action: "sync_request" }                                     // late joiner asks the tutor
  | { action: "sync_response"; active: boolean; studentWrite: boolean; snapshot: WhiteboardSnapshot | null }

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

// Broadcast over CAPTION_TOPIC by each speaker's browser (Web Speech API).
export type CaptionMessage = {
  id: string
  name: string
  text: string
  final: boolean
}

// ─── Breakout rooms ───────────────────────────────────────────────────────────
// Simulated breakouts: everyone stays in the same LiveKit room, but each client
// filters what it renders and hears based on group membership. The tutor
// orchestrates groups and can "visit" (join audio of) one at a time. This is
// sufficient for a trusted classroom context — a real privacy-isolated
// breakout would require separate LiveKit rooms + token refresh.

export type BreakoutGroup = {
  id: string
  name: string
  memberIds: string[]   // participant identities assigned to this group
}

// ─── Attention nudge ──────────────────────────────────────────────────────────
// Tutor pings everyone (or a specific breakout group) with a short visual
// flash + toast. Targeted at BSL classrooms where audio cues are unreliable —
// a screen-wide flash is far more likely to land than a chime.

export type NudgeAction =
  | {
      action: "nudge"
      from: string
      // When set, only clients in that group render the alert. `null` or
      // undefined → broadcast to everyone in the room.
      groupId?: string | null
      // Optional custom message shown below "Heads up"; defaults to a generic
      // attention prompt tuned for the room context.
      message?: string | null
    }

export type BreakoutAction =
  | { action: "start"; groups: BreakoutGroup[]; visitingGroupId: string | null; startedAt: number; durationMin?: number | null }
  // Full snapshot while live — receivers must set `active` so late/missed `start` still works.
  | { action: "update"; groups: BreakoutGroup[]; startedAt: number; durationMin?: number | null }
  | { action: "visit"; groupId: string | null }                       // tutor enters/leaves a group (audio bridge)
  | { action: "closing"; endsAt: number }                             // wrap-up countdown before returning to main room
  | { action: "stop" }
  | { action: "sync_request" }
  | { action: "sync_response"
      active: boolean
      groups: BreakoutGroup[]
      visitingGroupId: string | null
      startedAt: number | null
      durationMin: number | null
      closingAt: number | null
    }

// ─── Screen share privacy ─────────────────────────────────────────────────────
// Tutor can mark their shared screen as private; students see a placeholder
// instead of the live feed. Privacy state resets when screen sharing stops.

export type ScreenAction =
  | { action: "privacy"; private: boolean }
  | { action: "sync_request" }
  | { action: "sync_response"; private: boolean }
