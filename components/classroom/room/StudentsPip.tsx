"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { useParticipants, useTracks, VideoTrack } from "@livekit/components-react"
import { Track } from "livekit-client"
import { Camera } from "lucide-react"
import { isLiveVideo } from "@/components/classroom/localCameraView"
import { RaisedHandBadge } from "./RaisedHandBadge"

/**
 * A teacher sharing another tab lost sight of the class: the classroom page,
 * and every pop-out drawn inside it, is hidden the moment they switch tabs.
 * Document Picture-in-Picture gives us a real always-on-top window that stays
 * over any tab or app, and the student grid is portalled into it so it keeps
 * the LiveKit room context. LiveKit's adaptive stream already counts a video in
 * a Document PiP window as visible, so the class keeps streaming while the
 * classroom tab itself is in the background.
 *
 * Chrome / Edge 116+ only. Elsewhere the button is not offered.
 */

type DocumentPip = {
  window: Window | null
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>
}

function documentPip(): DocumentPip | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture
}

// The PiP document starts blank: carry over the app's CSS (Tailwind, fonts) and
// the root classes that switch on its theme variables.
function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement("style")
      style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n")
      target.head.appendChild(style)
    } catch {
      // Cross-origin sheet — its rules are unreadable, so link it instead.
      if (!sheet.href) continue
      const link = target.createElement("link")
      link.rel = "stylesheet"
      link.href = sheet.href
      target.head.appendChild(link)
    }
  }
  target.documentElement.className = document.documentElement.className
  target.body.className = `${document.body.className} bg-zinc-950 m-0 overflow-hidden`
}

const noSubscribe = () => () => {}

export function useStudentsPip() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  // False on the server so its render and the first client render agree.
  const supported = useSyncExternalStore(noSubscribe, () => !!documentPip(), () => false)

  // Dropping the window from state closes it — see the cleanup below.
  const close = useCallback(() => setPipWindow(null), [])

  const open = useCallback(async () => {
    const api = documentPip()
    if (!api) return
    try {
      const w = await api.requestWindow({ width: 480, height: 300 })
      w.document.title = "Students"
      copyStyles(w.document)
      w.addEventListener("pagehide", () => setPipWindow(null), { once: true })
      setPipWindow(w)
    } catch (err) {
      console.warn("[classroom] students pop-out failed", err)
    }
  }, [])

  const toggle = useCallback(() => {
    if (pipWindow) close()
    else void open()
  }, [pipWindow, open, close])

  // Closes the window when it's dropped from state, and when the teacher leaves
  // the classroom — it must not be stranded on their screen.
  useEffect(() => () => { pipWindow?.close() }, [pipWindow])

  return { supported, pipWindow, toggle }
}

/** Best-fit column count for n 16:9 tiles in a w×h box. */
function bestColumns(n: number, w: number, h: number) {
  let best = 1
  let bestTileW = 0
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const tileW = Math.min(w / cols, (h / rows) * (16 / 9))
    if (tileW > bestTileW) { bestTileW = tileW; best = cols }
  }
  return best
}

export function StudentsPipPortal({
  pipWindow,
  localIdentity,
  raisedHandIds,
  onLowerHand,
}: {
  pipWindow: Window
  localIdentity: string
  raisedHandIds: Set<string>
  onLowerHand?: (identity: string) => void
}) {
  const participants = useParticipants()
  const camTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })

  const [size, setSize] = useState({ w: pipWindow.innerWidth, h: pipWindow.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ w: pipWindow.innerWidth, h: pipWindow.innerHeight })
    pipWindow.addEventListener("resize", onResize)
    return () => pipWindow.removeEventListener("resize", onResize)
  }, [pipWindow])

  // Raised hands first — that's what the teacher is watching for.
  const students = useMemo(
    () =>
      participants
        .filter((p) => p.metadata !== "tutor" && p.identity !== localIdentity)
        .sort((a, b) => Number(raisedHandIds.has(b.identity)) - Number(raisedHandIds.has(a.identity))),
    [participants, localIdentity, raisedHandIds],
  )

  const GAP = 4
  const cols = bestColumns(Math.max(1, students.length), size.w - GAP * 2, size.h - GAP * 2)

  return createPortal(
    <div className="h-screen w-screen bg-zinc-950 text-white">
      {students.length === 0 ? (
        <div className="h-full flex items-center justify-center text-sm text-zinc-500">
          No students have joined yet
        </div>
      ) : (
        <div
          className="h-full grid content-center"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP, padding: GAP }}
        >
          {students.map((p) => {
            const camRef = camTracks.find((t) => t.participant.identity === p.identity && isLiveVideo(t))
            const name = p.name || p.identity
            const hand = raisedHandIds.has(p.identity)
            return (
              <div
                key={p.identity}
                className={
                  "relative aspect-video bg-zinc-900 rounded-md overflow-hidden " +
                  (hand ? "ring-2 ring-amber-400" : "ring-1 ring-white/10")
                }
              >
                {camRef ? (
                  // Not cropped: a signer's hands live at the edges of the frame.
                  <VideoTrack trackRef={camRef} className="w-full h-full object-contain" />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-1 text-zinc-500">
                    <div className="size-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold">
                      {name[0]?.toUpperCase()}
                    </div>
                    <Camera className="size-3" />
                  </div>
                )}
                <span className="absolute bottom-0.5 left-1 max-w-[90%] truncate text-[0.6875rem] font-medium bg-black/60 rounded px-1">
                  {name}
                </span>
                {hand && (
                  <RaisedHandBadge
                    name={name}
                    size={32}
                    className="absolute top-1 right-1"
                    onLower={onLowerHand ? () => onLowerHand(p.identity) : undefined}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>,
    pipWindow.document.body,
  )
}
