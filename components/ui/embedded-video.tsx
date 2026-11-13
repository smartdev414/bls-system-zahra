"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { parseVideoLink, videoLinkUrl } from "@/lib/video-link"
import { createEmbedPlayer, type EmbedPlayer } from "@/lib/embed-player"

type Props = {
  /** A YouTube or Vimeo link, as stored (see lib/video-link.ts). */
  url: string
  className?: string
  muted?: boolean
  autoPlay?: boolean
  /** Seconds to start from — where the student stopped last time. */
  start?: number
  /** About once a second: position and length, in seconds. */
  onProgress?: (time: number, duration: number) => void
  onPlay?: () => void
  onEnded?: () => void
}

/**
 * A lesson video that lives on YouTube or Vimeo, played in their own player
 * with its own controls. Reports progress the way the lesson page's `<video>`
 * does, so "picked up where you left off" and the 90% tick work the same.
 */
export function EmbeddedVideo(props: Props) {
  // Remounted per video, so an error from the last one doesn't linger.
  return <Embedded key={props.url} {...props} />
}

function Embedded({ url, className, muted, autoPlay, start, onProgress, onPlay, onEnded }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<"unavailable" | "blocked" | null>(null)
  // Latest callbacks, so the player is made once per video rather than per render.
  const cb = useRef({ onProgress, onPlay, onEnded })
  useEffect(() => { cb.current = { onProgress, onPlay, onEnded } })

  const link = parseVideoLink(url)
  const key = link ? videoLinkUrl(link) : null

  useEffect(() => {
    const host = hostRef.current
    const parsed = parseVideoLink(key)
    if (!host || !parsed) return
    let player: EmbedPlayer | null = null
    let cancelled = false
    createEmbedPlayer(
      host,
      parsed,
      { controls: true, muted: !!muted, autoplay: !!autoPlay, start },
      {
        onTime: (t, d) => cb.current.onProgress?.(t, d),
        onPlay: () => cb.current.onPlay?.(),
        onEnded: () => cb.current.onEnded?.(),
        onError: (reason) => { if (!cancelled) setError(reason) },
      },
    ).then(
      (p) => { if (cancelled) p.destroy(); else player = p },
      () => { if (!cancelled) setError("unavailable") },
    )
    return () => { cancelled = true; player?.destroy() }
    // The start point and flags only matter when the player is made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <div className={cn("relative bg-black", className)}>
      <div ref={hostRef} className="absolute inset-0" />
      {(error || !link) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 px-8 text-center">
          <AlertTriangle className="size-8 text-amber-500" />
          <p className="text-sm text-zinc-200 font-medium">
            {error === "blocked"
              ? "This video's owner doesn't allow it to be played on other websites"
              : "This video can't be played"}
          </p>
          <a
            href={key ?? url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 underline underline-offset-2 hover:text-white"
          >
            Open it on {link?.provider === "vimeo" ? "Vimeo" : "YouTube"} <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </div>
  )
}
