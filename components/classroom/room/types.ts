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

// Tutor-driven microphone control. Students cannot toggle their own mic in the UI;
// they apply these commands locally and the tutor also updates LiveKit permissions
// server-side so unmute can't be bypassed.
export type MuteAction =
  | { action: "mute-all"; from: string }
  | { action: "set-mic"; identity: string; enabled: boolean; from: string }

// Session-level admin actions the tutor can issue to the whole room.
//  - refresh: every client (including tutor) reloads its page — recovery for a frozen session.
export type SessionControlAction =
  | { action: "refresh"; from: string }

// ─── Whiteboard ───────────────────────────────────────────────────────────────
// Collaborative drawing surface. Coordinates are normalised to [0,1] against
// the board's rendered rect so everyone sees the same layout regardless of
// their screen size/aspect.
//
// Shape identity persists from client to client so deletes can target a
// specific shape rather than diff-ing whole lists. The union is kept as a
// single-member discriminated union so additional kinds can be added later
// without churn in consumers.

export type WhiteboardStroke = {
  id: string
  kind: "stroke"
  author: string           // participant identity of the person who drew it
  color: string            // CSS color (e.g. "#ef4444")
  width: number            // stroke width in normalised board units (×1000 for px-feel)
  points: [number, number][]
}

// A free-floating text label. Position is the top-left corner, normalised to
// [0,1] like strokes so it lands in the same place on every screen. `size` is
// the font size in normalised board units (× the board's min dimension for px).
export type WhiteboardText = {
  id: string
  kind: "text"
  author: string
  color: string
  x: number
  y: number
  text: string
  size: number
}

export type WhiteboardShape = WhiteboardStroke | WhiteboardText

export type WhiteboardAction =
  | { action: "start" }                                            // tutor opens the board for everyone
  | { action: "stop" }                                             // tutor closes the board
  | { action: "add";    shape: WhiteboardShape }                   // any participant adds a shape
  | { action: "update"; shape: WhiteboardShape }                   // any participant moves/edits a shape
  | { action: "delete"; id: string }                               // any participant erases a shape
  | { action: "clear" }                                            // tutor wipes everything
  | { action: "sync_request" }                                     // late joiner asks the tutor
  | { action: "sync_response"; active: boolean; shapes: WhiteboardShape[] }

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
  | { action: "update"; groups: BreakoutGroup[] }                     // tutor edits assignments live
  | { action: "visit"; groupId: string | null }                       // tutor enters/leaves a group (audio bridge)
  | { action: "stop" }
  | { action: "sync_request" }
  | { action: "sync_response"
      active: boolean
      groups: BreakoutGroup[]
      visitingGroupId: string | null
      startedAt: number | null
      durationMin: number | null
    }

// ─── Screen share privacy ─────────────────────────────────────────────────────
// Tutor can mark their shared screen as private; students see a placeholder
// instead of the live feed. Privacy state resets when screen sharing stops.

export type ScreenAction =
  | { action: "privacy"; private: boolean }
  | { action: "sync_request" }
  | { action: "sync_response"; private: boolean }
