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
  // Set on a message sent inside a breakout: only that group (and teachers)
  // receive it. Absent = the whole class.
  groupId?: string
  groupName?: string
}

export type RaisedHand = {
  identity: string
  name: string
}

// Hand raises. A participant's LiveKit identity changes on every reconnect, so
// a student who reloads re-announces their hand under the new identity and the
// tutor answers a late joiner's sync_request with the current list.
export type HandAction =
  | { identity: string; name: string; raised: boolean }
  | { action: "sync_request" }
  | { action: "sync_response"; hands: RaisedHand[] }

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
  // Answer to a sync_request when the stage is empty. Without it a student who
  // reloaded while the tutor was stopping the deck would keep showing the slide
  // they restored from storage, with nothing left to correct it.
  | { action: "sync_idle" }
  // ── Video ──────────────────────────────────────────────────────────────────
  // `ts` is Date.now() at the tutor; students use it to compensate for
  // network latency when seeking to the target currentTime.
  | { action: "video_start"; url: string }
  | { action: "video_state"; playing: boolean; currentTime: number; ts: number }
  | { action: "video_stop" }
  | { action: "video_sync_response"; url: string; playing: boolean; currentTime: number; ts: number }

/**
 * The tutor's hand pointer.
 *
 * `x`/`y` are 0-1 **within the drawn slide**, not within the panel that holds
 * it. That distinction is the whole ticket: the slide is letterboxed inside its
 * panel, and every participant's panel is a different shape — chat open or
 * closed, stacked on mobile, a pinned student changing the split. Normalising
 * against the panel meant the same coordinate landed on a different part of the
 * slide for every person in the room.
 *
 * `n` is a send counter. Moves go out on the lossy channel, where datagrams may
 * arrive out of order; without it a stale packet overwrites a newer one and the
 * pointer visibly jumps backwards.
 */
export type PointerAction =
  | { action: "move"; x: number; y: number; n?: number }
  | { action: "hide" }

export type SpotlightAction =
  | { action: "set"; identity: string }
  | { action: "clear" }
  | { action: "sync_request" }
  | { action: "sync_response"; identity: string | null }

// Tutor's manual ordering of the class grid.
//
// The order the tiles come out in is the room's, not each viewer's: "third
// along" has to mean the same student to the teacher as to the class, or the
// teacher ends up teaching to a room they can't point at. The default sort is
// already computed identically everywhere; drag-to-reorder is the one thing
// that can move a tile, so the tutor's arrangement is broadcast rather than
// kept locally.
//
// `order` is the full list of identities in display order. A late joiner asks
// for it, and a tutor who reloads re-announces the one they still hold.
export type OrderAction =
  | { action: "set"; order: string[] }
  | { action: "sync_request" }
  | { action: "sync_response"; order: string[] | null }

// Gallery (the whole class, nobody big) or spotlight (the normal stage). The
// tutor chooses and the class follows, same shape as `OrderAction`: a late
// joiner asks, and a tutor who (re)connects announces what they have.
export type ClassView = "spotlight" | "gallery"
export type ViewAction =
  | { action: "set"; view: ClassView }
  | { action: "sync_request" }
  | { action: "sync_response"; view: ClassView }

// Tutor-driven microphone control. Students cannot toggle their own mic in the UI;
// they apply these commands locally and the tutor also updates LiveKit permissions
// server-side so unmute can't be bypassed.
export type MuteAction =
  | { action: "mute-all"; from: string }
  | { action: "set-mic"; identity: string; enabled: boolean; from: string }
  // Student → tutor: ask to speak.
  | { action: "request-speak"; identity: string; name: string }
  // Tutor → student: the request was granted. Sent alongside the `set-mic`
  // that actually turns the mic on, so the student sees the answer even if the
  // permission update behind it fails.
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
// selection, camera and screen bounds. Carried opaquely; tldraw renders it as a
// collaborator cursor once merged into the receiver's store. Students also use
// the tutor's camera + screenBounds to follow their viewport, so a picture the
// tutor zoomed-to-fit is the same size on every board. Broadcast lossily.
export type WhiteboardPresence = Record<string, unknown>

export type WhiteboardAction =
  | { action: "start" }                                            // tutor opens the board for everyone
  | { action: "stop" }                                             // tutor closes the board
  | { action: "student_write"; enabled: boolean }                  // tutor allows/revokes student drawing
  | { action: "doc"; changes: WhiteboardDiff }                     // incremental tldraw store changes
  | { action: "presence"; presence: WhiteboardPresence }           // live cursor/presence for one peer
  | { action: "sync_request" }                                     // late joiner asks the tutor
  | { action: "sync_response"; active: boolean; studentWrite: boolean; snapshot: WhiteboardSnapshot | null; presence?: WhiteboardPresence }

// Discriminates on `kind` so the classroom can branch after upload:
//   - "slides" goes through SlidePicker, PptSlideViewer, next/prev, SlideTray.
//   - "video" skips the picker entirely; broadcast URL and mirror playback.
// `total` is only meaningful for slides.
export type UploadedSlides =
  | {
      kind: "slides"; url: string; total: number; mimeType: string; fileName: string
      /**
       * Pages the tutor kept the last time this deck was prepared or presented,
       * when we know them. The picker opens on that choice instead of ticking
       * all of them again — re-excluding the same twelve pages before every
       * repeat of a lesson is exactly the work this is meant to save.
       */
      selectedPages?: number[]
    }
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
  // Stable *user* ids (`participantBaseId(identity)`), NOT raw LiveKit
  // identities. Identities carry a fresh per-connection suffix, so a student
  // who drops off Wi-Fi returns under a different identity — keying on the
  // base id is what lets them rejoin the group they were already in.
  memberIds: string[]
}

// ─── Attention nudge ──────────────────────────────────────────────────────────
// Tutor pings everyone (or a specific breakout group, or one student) with a
// short visual flash + toast. Targeted at BSL classrooms where audio cues are
// unreliable — a screen-wide flash is far more likely to land than a chime.

export type NudgeAction =
  | {
      action: "nudge"
      from: string
      // When set, only that one participant renders the alert. Carries the
      // *base* id (`participantBaseId(identity)`) so a student who dropped and
      // rejoined under a fresh identity still matches. Takes precedence over
      // `groupId`. `null` or undefined → not targeted at an individual.
      targetId?: string | null
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
  // Tutor pushes the deadline out mid-session. Carries the authoritative
  // recomputed timer (rather than a delta) so every client lands on the same
  // deadline no matter which messages they missed. Cancels any wrap-up in
  // progress — adding time means "not yet".
  | { action: "extend"; startedAt: number; durationMin: number; addedMin: number }
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

// ─── Screen share privacy + wide ──────────────────────────────────────────────
// Tutor can mark their shared screen as private; students see a placeholder
// instead of the live feed. Privacy state resets when screen sharing stops.
// A teacher widening the share widens it for the whole class.

export type ScreenAction =
  | { action: "privacy"; private: boolean }
  | { action: "wide"; wide: boolean }
  | { action: "sync_request" }
  | { action: "sync_response"; private: boolean; wide?: boolean }

/** What the tutor's tab tells the class recorder. See RECORDER_TOPIC. */
export type RecorderStateAction =
  // When recording (re)starts: everything that is open right now.
  | {
      action: "state"
      whiteboard: { active: boolean; snapshot: WhiteboardSnapshot | null }
      breakouts: boolean
      /** Who the tutor has spotlighted for everyone, whether the room is in
       *  gallery, and whether the tutor has the students popped out — the only
       *  times the recording shows a student's face. */
      spotlight?: string | null
      gallery?: boolean
      popout?: boolean
    }
  // The tutor opened or closed "Pop out students". Only their own screen shows
  // it, so the recorder hears it from here rather than from the room.
  | { action: "popout"; open: boolean }
