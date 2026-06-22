"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  type Editor,
  type TLRecord,
  type TLShapeId,
} from "tldraw"
import "tldraw/tldraw.css"
import { PencilLine, Users, Share2, Download, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type {
  ChatAttachment,
  WhiteboardAction,
  WhiteboardDiff,
  WhiteboardSnapshot,
} from "./types"

// Imperative bridge handed up to ClassroomRoom so the data-channel layer can
// drive the tldraw store without knowing anything about tldraw internals.
export type WhiteboardApi = {
  applyChanges: (changes: WhiteboardDiff) => void
  applySnapshot: (snapshot: WhiteboardSnapshot) => void
  getSnapshot: () => WhiteboardSnapshot | null
}

type TldrawBoardProps = {
  isTutor: boolean
  canWrite: boolean
  studentsCanWrite: boolean
  onToggleStudentWrite: () => void
  onStop: () => void
  sessionId: string
  onShareToChat: (attachment: ChatAttachment) => void
  /** Broadcast a whiteboard action over the LiveKit data channel. */
  send: (action: WhiteboardAction) => void
  /** Register/unregister the imperative store bridge with the parent. */
  registerApi: (api: WhiteboardApi | null) => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

export default function TldrawBoard({
  isTutor,
  canWrite,
  studentsCanWrite,
  onToggleStudentWrite,
  onStop,
  sessionId,
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
  useEffect(() => { sendRef.current = send }, [send])
  useEffect(() => { registerApiRef.current = registerApi }, [registerApi])
  useEffect(() => { isTutorRef.current = isTutor }, [isTutor])
  useEffect(() => { canWriteRef.current = canWrite }, [canWrite])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])

  const [sharing, setSharing] = useState(false)

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
      },
      getSnapshot: () => {
        const ed = editorRef.current
        return ed ? (getSnapshot(ed.store) as unknown as WhiteboardSnapshot) : null
      },
    }
    registerApiRef.current(api)

    return () => {
      unlisten()
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
        />
      </div>
    </div>
  )
}
