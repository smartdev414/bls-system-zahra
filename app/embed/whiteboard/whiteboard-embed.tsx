"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useSearchParams } from "next/navigation"
import type { WhiteboardApi } from "@/components/classroom/room/TldrawBoard"
import type {
  ChatAttachment,
  WhiteboardAction,
  WhiteboardDiff,
  WhiteboardPresence,
  WhiteboardSnapshot,
} from "@/components/classroom/room/types"

const TldrawBoard = dynamic(() => import("@/components/classroom/room/TldrawBoard"), { ssr: false })

// Messages between this page and the phone app.
//   app → page: window.tmsWhiteboard({ action, fromTutor })  — a board message from the room
//               window.tmsWhiteboardPeerLeft(identity)       — drop a departed peer's cursor
//   page → app: { wb: WhiteboardAction }                      — publish on the board topic
//               { share: ChatAttachment }                     — post a board snapshot to chat
//               { ready: true }                               — the bridge above is installed
type Incoming = WhiteboardAction & { fromTutor?: boolean }

declare global {
  interface Window {
    tmsWhiteboard?: (message: Incoming) => void
    tmsWhiteboardPeerLeft?: (identity: string) => void
    ReactNativeWebView?: { postMessage: (data: string) => void }
  }
}

const post = (data: unknown) => window.ReactNativeWebView?.postMessage(JSON.stringify(data))
const noop = () => () => {}

export function WhiteboardEmbed() {
  const isClient = useSyncExternalStore(noop, () => true, () => false)
  const params = useSearchParams()
  const sessionId = params.get("session") ?? ""
  const identity = params.get("identity") ?? ""
  const name = params.get("name") ?? "Student"
  const follow = params.get("follow")
  const [studentWrite, setStudentWrite] = useState(params.get("write") === "1")
  const writeRef = useRef(studentWrite)
  useEffect(() => {
    writeRef.current = studentWrite
  }, [studentWrite])

  // Same buffering as the website classroom: messages that arrive before tldraw has mounted
  // are kept and applied once the board registers its bridge.
  const api = useRef<WhiteboardApi | null>(null)
  const pending = useRef<{ snapshot?: WhiteboardSnapshot; changes: WhiteboardDiff[]; presence?: WhiteboardPresence }>({
    changes: [],
  })

  useEffect(() => {
    window.tmsWhiteboard = (data) => {
      const fromTutor = data.fromTutor === true
      switch (data.action) {
        case "student_write":
          if (fromTutor) setStudentWrite(data.enabled)
          return
        case "doc":
          if (!fromTutor && !writeRef.current) return
          if (api.current) api.current.applyChanges(data.changes)
          else pending.current.changes.push(data.changes)
          return
        case "presence": {
          const presence =
            fromTutor || writeRef.current ? data.presence : { ...data.presence, scribbles: [], brush: null }
          api.current?.applyPresence(presence)
          return
        }
        case "sync_response":
          if (!fromTutor) return
          setStudentWrite(data.studentWrite)
          if (data.snapshot) {
            if (api.current) api.current.applySnapshot(data.snapshot)
            else pending.current.snapshot = data.snapshot
          }
          if (data.presence) {
            if (api.current) api.current.applyPresence(data.presence)
            else pending.current.presence = data.presence
          }
          return
      }
    }
    window.tmsWhiteboardPeerLeft = (peer) => api.current?.removePeer(peer)
    // Tell the app it can start relaying (anything it had queued is delivered now).
    post({ ready: true })
    return () => {
      delete window.tmsWhiteboard
      delete window.tmsWhiteboardPeerLeft
    }
  }, [])

  const registerApi = useCallback((next: WhiteboardApi | null) => {
    api.current = next
    if (!next) return
    const p = pending.current
    if (p.snapshot) next.applySnapshot(p.snapshot)
    for (const changes of p.changes) next.applyChanges(changes)
    if (p.presence) next.applyPresence(p.presence)
    pending.current = { changes: [] }
  }, [])

  const send = useCallback((action: WhiteboardAction) => post({ wb: action }), [])
  const share = useCallback((attachment: ChatAttachment) => post({ share: attachment }), [])

  if (!isClient || !sessionId || !identity) return <div className="flex-1 bg-white" />

  return (
    <div className="fixed inset-0 bg-white">
      <TldrawBoard
        isTutor={false}
        canWrite={studentWrite}
        studentsCanWrite={studentWrite}
        onToggleStudentWrite={() => {}}
        onStop={() => {}}
        onMinimize={() => post({ minimize: true })}
        sessionId={sessionId}
        localIdentity={identity}
        localName={name}
        followIdentity={follow}
        send={send}
        registerApi={registerApi}
        onShareToChat={share}
      />
    </div>
  )
}
