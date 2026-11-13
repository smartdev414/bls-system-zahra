"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { useSearchParams } from "next/navigation"
import { EmbeddedVideo } from "@/components/ui/embedded-video"
import { LinkedVideoPlayer } from "@/components/classroom/room/LinkedVideoPlayer"
import { isVideoLink } from "@/lib/video-link"

// The phone app loads this page with ?url=<YouTube or Vimeo link> and either
//
//   mode=lesson&start=<secs>  — the student's own player. Posts
//                               { time, duration } about once a second and
//                               { ended: true } at the end.
//   mode=class                — follows the tutor. The app calls
//                               window.tmsSetVideo({ playing, currentTime, ts })
//                               whenever the tutor plays, pauses or seeks.
declare global {
  interface Window {
    tmsSetVideo?: (next: { playing?: boolean; currentTime?: number; ts?: number }) => void
  }
}

const noop = () => () => {}
const post = (data: unknown) => window.ReactNativeWebView?.postMessage(JSON.stringify(data))

export function VideoEmbed() {
  const isClient = useSyncExternalStore(noop, () => true, () => false)
  const params = useSearchParams()
  const url = params.get("url")
  const mode = params.get("mode") === "class" ? "class" : "lesson"
  const start = Math.max(0, Number(params.get("start")) || 0)

  const [state, setState] = useState({ playing: false, currentTime: 0, ts: 0 })

  useEffect(() => {
    window.tmsSetVideo = (next) =>
      setState((prev) => ({
        playing: typeof next.playing === "boolean" ? next.playing : prev.playing,
        currentTime: typeof next.currentTime === "number" ? next.currentTime : prev.currentTime,
        ts: typeof next.ts === "number" ? next.ts : Date.now(),
      }))
    post({ ready: true })
    return () => { delete window.tmsSetVideo }
  }, [])

  if (!isClient || !url || !isVideoLink(url)) return <div className="fixed inset-0 bg-black" />

  return (
    <div className="fixed inset-0 bg-black">
      {mode === "class" ? (
        <LinkedVideoPlayer
          isTutor={false}
          url={url}
          playing={state.playing}
          currentTime={state.currentTime}
          asOf={state.ts}
          onPlayPause={() => {}}
          onSeek={() => {}}
        />
      ) : (
        <EmbeddedVideo
          url={url}
          muted
          start={start > 5 ? start : undefined}
          className="absolute inset-0"
          onProgress={(time, duration) => post({ time, duration })}
          onPlay={() => post({ playing: true })}
          onEnded={() => post({ ended: true })}
        />
      )}
    </div>
  )
}
