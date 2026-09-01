"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Tldraw,
  allDefaultFontFaces,
  getSnapshot,
  loadSnapshot,
  type Editor,
  type TLRecord,
  type TLShapeId,
} from "tldraw"
// These reactive primitives + presence helpers are re-exported by `tldraw` at
// runtime, but its bundled .d.ts omits them — so we import each from its own
// canonical sub-package (tldraw pins exact versions, so there's a single
// hoisted copy and the signals interoperate with tldraw's store).
import { atom, react } from "@tldraw/state"
import { useValue } from "@tldraw/state-react"
import { useEditor } from "@tldraw/editor"
import { DraggableStylePanel } from "./DraggableStylePanel"
import {
  InstancePresenceRecordType,
  UserRecordType,
  createPresenceStateDerivation,
  type TLAssetStore,
  type TLInstancePresence,
  type TLUser,
} from "@tldraw/tlschema"
import "tldraw/tldraw.css"
import { PencilLine, Users, Share2, Download, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type {
  ChatAttachment,
  WhiteboardAction,
  WhiteboardDiff,
  WhiteboardPresence,
  WhiteboardSnapshot,
} from "./types"

// Throttle for outgoing cursor/presence frames (~16 fps). Lossy by design.
const PRESENCE_THROTTLE_MS = 60

// Stable per-author colour. The same identity always maps to the same colour
// across clients, so authorship chips and live cursors stay consistent for
// everyone in the room. Tuned for legibility on tldraw's light canvas.
const AUTHOR_COLORS = [
  "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
  "#db2777", "#0891b2", "#ca8a04", "#4f46e5", "#be123c",
]
function colorForId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length]
}

// Authorship metadata stamped onto every locally-created shape's `meta` field.
type AuthorMeta = { authorId?: string; authorName?: string; authorColor?: string }

// Overlay rendered inside tldraw's canvas (so it pans/zooms with the board).
// Shows a small author chip on the hovered shape and any selected shapes; every
// other shape stays clean. Chips counter-scale by 1/zoom to keep a constant
// on-screen size regardless of zoom level.
function AuthorBadges() {
  const editor = useEditor()
  const { zoom, chips } = useValue(
    "wb-author-chips",
    () => {
      const ids = new Set<TLShapeId>()
      const hovered = editor.getHoveredShapeId()
      if (hovered) ids.add(hovered)
      for (const id of editor.getSelectedShapeIds()) ids.add(id)

      const chips: { id: string; x: number; y: number; name: string; color: string }[] = []
      for (const id of ids) {
        const shape = editor.getShape(id)
        const bounds = editor.getShapePageBounds(id)
        const meta = shape?.meta as AuthorMeta | undefined
        if (!bounds || !meta?.authorName) continue
        chips.push({
          id,
          x: bounds.x,
          y: bounds.y,
          name: meta.authorName,
          color: meta.authorColor ?? "#2563eb",
        })
      }
      return { zoom: editor.getZoomLevel(), chips }
    },
    [editor],
  )

  return (
    <>
      {chips.map((c) => (
        <div
          key={c.id}
          style={{ position: "absolute", left: c.x, top: c.y, width: 0, height: 0, pointerEvents: "none" }}
        >
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              transform: `scale(${1 / zoom})`,
              transformOrigin: "bottom left",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              marginBottom: 4,
              borderRadius: 6,
              background: c.color,
              color: "#fff",
              fontSize: 11,
              lineHeight: "14px",
              fontWeight: 600,
              whiteSpace: "nowrap",
              boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
            }}
          >
            <PencilLine style={{ width: 11, height: 11 }} />
            {c.name}
          </div>
        </div>
      ))}
    </>
  )
}

// Imperative bridge handed up to ClassroomRoom so the data-channel layer can
// drive the tldraw store without knowing anything about tldraw internals.
export type WhiteboardApi = {
  applyChanges: (changes: WhiteboardDiff) => void
  applySnapshot: (snapshot: WhiteboardSnapshot) => void
  getSnapshot: () => WhiteboardSnapshot | null
  /** Merge a peer's live cursor/presence record into the local store. */
  applyPresence: (presence: WhiteboardPresence) => void
  /** Drop a departed peer's cursor (called when they leave the room). */
  removePeer: (identity: string) => void
}

type TldrawBoardProps = {
  isTutor: boolean
  canWrite: boolean
  studentsCanWrite: boolean
  onToggleStudentWrite: () => void
  onStop: () => void
  sessionId: string
  /** Local participant identity + display name — used to attribute shapes and cursors. */
  localIdentity: string
  localName: string
  onShareToChat: (attachment: ChatAttachment) => void
  /** Broadcast a whiteboard action over the LiveKit data channel. */
  send: (action: WhiteboardAction) => void
  /** Register/unregister the imperative store bridge with the parent. */
  registerApi: (api: WhiteboardApi | null) => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

/**
 * Make sure tldraw's fonts are loaded before anyone measures text against them.
 *
 * tldraw sizes a text shape by measuring it in the DOM and baking the result
 * into `props.w`, but its default faces are fetched lazily from tldraw's CDN.
 * Until a face arrives, measurement falls back to the platform's generic
 * `sans-serif`, which is a different width per glyph.
 *
 * That matters here more than in a single-player board, because this whiteboard
 * syncs by putting a peer's shape records straight into the local store: a text
 * shape carries the *sender's* measured width, while the receiver's canvas
 * measures the same text itself. If the two clients resolved different faces —
 * the tutor on a warm cache, a student on a cold one, or a school network that
 * is slow to reach the CDN — they disagree about how wide that text is. Each
 * time either side changes the size, tldraw repositions the shape from the
 * difference between the old and new measurements, so the disagreement is
 * re-applied and the text drifts out of its box a little further every time.
 * Loading every face up front makes all clients measure identically.
 */
function preloadBoardFonts(editor: Editor) {
  try {
    editor.fonts.requestFonts(allDefaultFontFaces)
  } catch { /* font manager is best-effort; the board still works */ }
}

/** Load whatever faces the shapes now on the board actually need. */
function loadFontsForSeededBoard(editor: Editor) {
  void editor.fonts.loadRequiredFontsForCurrentPage().catch(() => { /* best-effort */ })
}

/**
 * Put whiteboard pictures somewhere every client can actually fetch them from.
 *
 * tldraw's default asset store keeps an added image in the tab it was added in:
 * the asset record ends up holding either a `blob:` URL, which resolves in that
 * one tab and nowhere else, or a data URL of the whole file. This board syncs by
 * putting tldraw's record diffs straight onto the LiveKit data channel, so both
 * end the same way for everybody else in the room — a blob URL that resolves to
 * nothing on their machine, or a diff far past the channel's per-message ceiling
 * that never leaves the sender at all. Either way the class sees an empty frame
 * where the teacher's picture should be.
 *
 * Uploading to S3 first and syncing the resulting https URL fixes both: the diff
 * stays a few hundred bytes, every client loads the same file, and the picture is
 * still there when the board is reopened from its saved snapshot next lesson.
 */
function createBoardAssetStore(sessionIdRef: React.RefObject<string>): TLAssetStore {
  return {
    async upload(_asset, file, abortSignal) {
      const contentType = file.type || "application/octet-stream"
      const fileName = file.name || `whiteboard-asset-${uid()}`
      try {
        const presignRes = await fetch(
          `/api/sessions/${sessionIdRef.current}/whiteboard-asset-presign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName, contentType, fileSize: file.size }),
            signal: abortSignal,
          },
        )
        if (!presignRes.ok) {
          const err = (await presignRes.json().catch(() => null)) as { message?: string } | null
          throw new Error(err?.message ?? "Could not get an upload URL")
        }
        const { presignedUrl, fileUrl } = (await presignRes.json()) as {
          presignedUrl: string
          fileUrl: string
        }
        const uploadRes = await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
          signal: abortSignal,
        })
        if (!uploadRes.ok) throw new Error("Upload failed")
        return { src: fileUrl }
      } catch (e) {
        // A silent failure here reads as "the image just didn't appear", which
        // is the same thing the class sees when it fails for them instead — so
        // say plainly that nobody got it rather than leaving a broken frame.
        if (!abortSignal?.aborted) {
          toast.error(
            e instanceof Error
              ? `${e.message} — the picture wasn't added to the whiteboard.`
              : "The picture wasn't added to the whiteboard.",
          )
        }
        throw e
      }
    },
  }
}

export default function TldrawBoard({
  isTutor,
  canWrite,
  studentsCanWrite,
  onToggleStudentWrite,
  onStop,
  sessionId,
  localIdentity,
  localName,
  onShareToChat,
  send,
  registerApi,
}: TldrawBoardProps) {
  const editorRef = useRef<Editor | null>(null)
  // When true, store mutations are coming from the network/seed and must not be
  // re-broadcast (would echo forever).
  const applyingRemote = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep latest props reachable from the once-created onMount closure.
  const sendRef = useRef(send)
  const registerApiRef = useRef(registerApi)
  const isTutorRef = useRef(isTutor)
  const canWriteRef = useRef(canWrite)
  const sessionIdRef = useRef(sessionId)
  const localIdentityRef = useRef(localIdentity)
  const localNameRef = useRef(localName)
  useEffect(() => { sendRef.current = send }, [send])
  useEffect(() => { registerApiRef.current = registerApi }, [registerApi])
  useEffect(() => { isTutorRef.current = isTutor }, [isTutor])
  useEffect(() => { canWriteRef.current = canWrite }, [canWrite])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { localIdentityRef.current = localIdentity }, [localIdentity])
  useEffect(() => { localNameRef.current = localName }, [localName])

  const [sharing, setSharing] = useState(false)

  // One store for the life of the board. `sessionIdRef` is read at upload time,
  // so a changing session id never forces tldraw to rebuild its own store.
  const assetStore = useMemo(() => createBoardAssetStore(sessionIdRef), [])

  // Reflect the live permission into the editor whenever it changes.
  useEffect(() => {
    editorRef.current?.updateInstanceState({ isReadonly: !canWrite })
  }, [canWrite])

  // ── Persistence: debounced autosave of the full snapshot (tutor only) ───────
  const scheduleSave = useCallback(() => {
    if (!isTutorRef.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const editor = editorRef.current
      if (!editor) return
      const snapshot = getSnapshot(editor.store)
      void fetch(`/api/sessions/${sessionIdRef.current}/whiteboard`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
      }).catch(() => { /* autosave is best-effort */ })
    }, 1000)
  }, [])

  // ── tldraw mount: seed, wire local→remote sync, expose the bridge ───────────
  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    editor.updateInstanceState({ isReadonly: !canWriteRef.current })

    // Start fetching the text faces immediately: every measurement taken before
    // they land is taken against the wrong font. See preloadBoardFonts.
    preloadBoardFonts(editor)

    const authorId = localIdentityRef.current
    const authorName = localNameRef.current
    const authorColor = colorForId(authorId)

    // Authorship: stamp every shape the local user creates with who made it, so
    // "who drew/wrote this" survives in the document. Shapes arriving from peers
    // already carry their author and are applied under `applyingRemote`, so we
    // skip those to avoid re-attributing them to the local user.
    const stopStamp = editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
      if (applyingRemote.current) return shape
      if ((shape.meta as AuthorMeta)?.authorId) return shape
      return { ...shape, meta: { ...shape.meta, authorId, authorName, authorColor } }
    })

    // Live cursors: derive this user's presence record and broadcast it lossily
    // on change (throttled). Peers merge it into their store and tldraw renders
    // the collaborator cursor. A stable presence id keyed off the identity lets
    // peers drop the cursor cleanly when the user leaves.
    const user = UserRecordType.create({
      id: UserRecordType.createId(authorId),
      name: authorName,
      color: authorColor,
    })
    const $user = atom<TLUser | null>("wb-user", user)
    const presenceId = InstancePresenceRecordType.createId(authorId)
    const $presence = createPresenceStateDerivation($user, { instanceId: presenceId })(editor.store)
    let presencePending: TLInstancePresence | null = null
    let presenceTimer: ReturnType<typeof setTimeout> | null = null
    const flushPresence = () => {
      presenceTimer = null
      if (!presencePending) return
      sendRef.current({ action: "presence", presence: presencePending as unknown as WhiteboardPresence })
      presencePending = null
    }
    const stopPresence = react("wb-presence-broadcast", () => {
      const p = $presence.get()
      if (!p) return
      presencePending = p
      if (!presenceTimer) presenceTimer = setTimeout(flushPresence, PRESENCE_THROTTLE_MS)
    })

    // Seed the board. Tutor reads the persisted snapshot from the DB; students
    // ask the tutor for the current live state.
    if (isTutorRef.current) {
      void (async () => {
        try {
          const res = await fetch(`/api/sessions/${sessionIdRef.current}/whiteboard`)
          if (!res.ok) return
          const { snapshot } = (await res.json()) as { snapshot: WhiteboardSnapshot | null }
          if (snapshot) {
            applyingRemote.current = true
            try { loadSnapshot(editor.store, snapshot as Parameters<typeof loadSnapshot>[1]) }
            finally { applyingRemote.current = false }
            loadFontsForSeededBoard(editor)
          }
        } catch { /* empty board is fine */ }
      })()
    } else {
      sendRef.current({ action: "sync_request" })
    }

    // Local user edits → broadcast as opaque tldraw diffs (+ autosave).
    const unlisten = editor.store.listen(
      (entry) => {
        if (applyingRemote.current) return
        sendRef.current({
          action: "doc",
          changes: entry.changes as unknown as WhiteboardDiff,
        })
        scheduleSave()
      },
      { source: "user", scope: "document" },
    )

    const api: WhiteboardApi = {
      applyChanges: (changes) => {
        const ed = editorRef.current
        if (!ed) return
        applyingRemote.current = true
        try {
          ed.store.mergeRemoteChanges(() => {
            const toPut: TLRecord[] = []
            if (changes.added) toPut.push(...(Object.values(changes.added) as TLRecord[]))
            if (changes.updated) {
              for (const tuple of Object.values(changes.updated)) {
                toPut.push(tuple[1] as TLRecord)
              }
            }
            if (toPut.length) ed.store.put(toPut)
            if (changes.removed) {
              const ids = Object.keys(changes.removed) as TLRecord["id"][]
              if (ids.length) ed.store.remove(ids)
            }
          })
        } finally {
          applyingRemote.current = false
        }
      },
      applySnapshot: (snapshot) => {
        const ed = editorRef.current
        if (!ed) return
        applyingRemote.current = true
        try { loadSnapshot(ed.store, snapshot as Parameters<typeof loadSnapshot>[1]) }
        finally { applyingRemote.current = false }
        loadFontsForSeededBoard(ed)
      },
      getSnapshot: () => {
        const ed = editorRef.current
        return ed ? (getSnapshot(ed.store) as unknown as WhiteboardSnapshot) : null
      },
      applyPresence: (presence) => {
        const ed = editorRef.current
        if (!ed) return
        // Presence is a session-scoped record, so this merge never trips the
        // document listener above — no echo back onto the wire.
        try {
          ed.store.mergeRemoteChanges(() => {
            ed.store.put([presence as unknown as TLInstancePresence])
          })
        } catch { /* ignore a malformed presence frame */ }
      },
      removePeer: (identity) => {
        const ed = editorRef.current
        if (!ed) return
        const id = InstancePresenceRecordType.createId(identity)
        try { ed.store.mergeRemoteChanges(() => ed.store.remove([id])) } catch { /* already gone */ }
      },
    }
    registerApiRef.current(api)

    return () => {
      unlisten()
      stopStamp()
      stopPresence()
      if (presenceTimer) clearTimeout(presenceTimer)
      registerApiRef.current(null)
      editorRef.current = null
    }
  }, [scheduleSave])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  // ── Export helpers (PNG snapshot of the current page) ───────────────────────
  const buildBoardBlob = useCallback(async (): Promise<Blob | null> => {
    const editor = editorRef.current
    if (!editor) return null
    const ids = Array.from(editor.getCurrentPageShapeIds()) as TLShapeId[]
    if (ids.length === 0) return null
    try {
      const { blob } = await editor.toImage(ids, { format: "png", background: true, padding: 24 })
      return blob
    } catch {
      return null
    }
  }, [])

  const handleDownload = useCallback(async () => {
    const blob = await buildBoardBlob()
    if (!blob) {
      toast.error("Nothing to export yet")
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `whiteboard-${uid()}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [buildBoardBlob])

  const handleShare = useCallback(async () => {
    if (sharing) return
    setSharing(true)
    try {
      const blob = await buildBoardBlob()
      if (!blob) throw new Error("Nothing to share yet")
      const fileName = `whiteboard-${uid()}.png`
      const presignRes = await fetch(`/api/sessions/${sessionId}/chat-upload-presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, contentType: "image/png", fileSize: blob.size }),
      })
      if (!presignRes.ok) {
        const err = (await presignRes.json()) as { message?: string }
        throw new Error(err.message ?? "Could not get upload URL")
      }
      const { presignedUrl, fileUrl } = (await presignRes.json()) as {
        presignedUrl: string
        fileUrl: string
      }
      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: blob,
      })
      if (!uploadRes.ok) throw new Error("Upload failed")
      onShareToChat({ fileUrl, fileName, fileSize: blob.size, mimeType: "image/png" })
      toast.success("Whiteboard shared to the chat — everyone can open or download it.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not share the whiteboard")
    } finally {
      setSharing(false)
    }
  }, [sharing, sessionId, onShareToChat, buildBoardBlob])

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full flex flex-col bg-zinc-100">
      {/* Classroom header strip above tldraw's own UI */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border-b border-zinc-700">
        <div className="flex items-center gap-1 mr-1">
          <PencilLine className="size-3.5 text-amber-400" />
          <span className="text-xs font-bold text-white">Whiteboard</span>
          {!canWrite && (
            <span className="text-[10px] font-medium text-zinc-400 bg-zinc-700/80 px-1.5 py-0.5 rounded-md ml-1">
              View only
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {isTutor && (
            <button
              type="button"
              onClick={onToggleStudentWrite}
              className={cn(
                "flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium transition-colors",
                studentsCanWrite
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700",
              )}
              title={studentsCanWrite ? "Students can write — click to make view-only" : "Let students write"}
            >
              <Users className="size-3.5" />
              {studentsCanWrite ? "Students can write" : "Let them write"}
            </button>
          )}

          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-60"
            title="Share a snapshot to the chat"
          >
            {sharing ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
            Share
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Download a PNG snapshot"
          >
            <Download className="size-3.5" />
          </button>

          {isTutor && (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium bg-red-600/90 text-white hover:bg-red-600 transition-colors"
              title="Close the whiteboard for everyone"
            >
              <X className="size-3.5" /> Close
            </button>
          )}
        </div>
      </div>

      {/* tldraw fills the remaining space */}
      <div className="relative flex-1 min-h-0">
        <Tldraw
          onMount={handleMount}
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
          assets={assetStore}
          components={{ InFrontOfTheCanvas: AuthorBadges, StylePanel: DraggableStylePanel }}
        />
      </div>
    </div>
  )
}
