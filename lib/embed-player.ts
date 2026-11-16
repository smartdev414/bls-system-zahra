"use client"

import type { VideoLink } from "./video-link"
import { videoLinkUrl } from "./video-link"

/**
 * One small player interface over YouTube's IFrame API and Vimeo's player.js,
 * so the lesson page and the classroom drive a linked video exactly as they
 * drive a `<video>`: play, pause, seek, and events back with the time.
 *
 * Both APIs are loaded from their own sites on first use, once per page.
 */

export type EmbedPlayerOptions = {
  /** The site's own controls. Off for students in a class, who follow the tutor. */
  controls: boolean
  muted: boolean
  autoplay?: boolean
  /** Seconds to start from. */
  start?: number
}

export type EmbedPlayerEvents = {
  onPlay?: (time: number) => void
  onPause?: (time: number) => void
  /** A jump in the timeline, by the viewer or by us. */
  onSeek?: (time: number) => void
  onEnded?: () => void
  /** About once a second while the player is on the page. */
  onTime?: (time: number, duration: number) => void
  /** The video cannot be played here: removed, private, or its owner blocks embedding. */
  onError?: (reason: "unavailable" | "blocked") => void
  /** Captions were turned on or off, or switched language. See {@link Captions}. */
  onCaptions?: (captions: Captions) => void
}

/**
 * The caption state of a player: `null` when off, otherwise the track's
 * language code — or `""` when they are on but the language isn't known.
 */
export type Captions = string | null

export type EmbedPlayer = {
  /** Resolves false when the browser refused to start it without a tap. */
  play: () => Promise<boolean>
  pause: () => void
  seek: (time: number) => void
  setMuted: (muted: boolean) => void
  /** Turn captions off (`null`), on in a language, or on in the default track (`""`). */
  setCaptions: (captions: Captions) => void
  /** Last known position, in seconds. */
  time: () => number
  playing: () => boolean
  /** The `<iframe>` once created, for sizing and for the hand pointer. */
  iframe: () => HTMLIFrameElement | null
  destroy: () => void
}

// ── Script loading ────────────────────────────────────────────────────────────

type YTPlayer = {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  mute(): void
  unMute(): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  getIframe(): HTMLIFrameElement
  destroy(): void
  // Not in YouTube's published reference, but long-standing and what its own
  // CC button drives. Optional-called: if YouTube ever drops them, caption
  // following stops and nothing else breaks.
  getOption?(module: string, option: string): unknown
  setOption?(module: string, option: string, value: unknown): void
  loadModule?(module: string): void
  unloadModule?(module: string): void
}

type VimeoPlayer = {
  play(): Promise<void>
  pause(): Promise<void>
  setCurrentTime(seconds: number): Promise<number>
  setMuted(muted: boolean): Promise<boolean>
  getDuration(): Promise<number>
  enableTextTrack(language: string, kind?: string): Promise<unknown>
  disableTextTrack(): Promise<void>
  getTextTracks(): Promise<{ language: string; kind: string; mode: string }[]>
  on(event: string, cb: (data: { seconds?: number; duration?: number; name?: string; method?: string; language?: string | null }) => void): void
  ready(): Promise<void>
  destroy(): Promise<void>
}

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer
      PlayerState: Record<string, number>
    }
    onYouTubeIframeAPIReady?: () => void
    Vimeo?: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => VimeoPlayer }
  }
}

let ytApi: Promise<NonNullable<Window["YT"]>> | null = null
let vimeoApi: Promise<NonNullable<Window["Vimeo"]>> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(s)
  })
}

function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  ytApi ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT!)
    }
    loadScript("https://www.youtube.com/iframe_api").catch((err) => {
      ytApi = null
      reject(err)
    })
  })
  return ytApi
}

function loadVimeo() {
  if (window.Vimeo?.Player) return Promise.resolve(window.Vimeo)
  vimeoApi ??= loadScript("https://player.vimeo.com/api/player.js")
    .then(() => window.Vimeo!)
    .catch((err) => {
      vimeoApi = null
      throw err
    })
  return vimeoApi
}

function fillHost(iframe: HTMLIFrameElement | null) {
  if (!iframe) return
  iframe.style.position = "absolute"
  iframe.style.inset = "0"
  iframe.style.width = "100%"
  iframe.style.height = "100%"
  iframe.style.border = "0"
  iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media")
}

// ── YouTube ───────────────────────────────────────────────────────────────────

const YT_ENDED = 0
const YT_PLAYING = 1
const YT_PAUSED = 2
const YT_BUFFERING = 3

async function createYouTube(
  host: HTMLElement, link: VideoLink, opts: EmbedPlayerOptions, ev: EmbedPlayerEvents,
): Promise<EmbedPlayer> {
  const YT = await loadYouTube()
  const mount = document.createElement("div")
  host.appendChild(mount)

  let destroyed = false
  let lastTime = opts.start ?? 0
  let lastPoll = Date.now()
  let isPlaying = false

  const player = await new Promise<YTPlayer>((resolve) => {
    const p = new YT.Player(mount, {
      videoId: link.id,
      host: "https://www.youtube-nocookie.com",
      playerVars: {
        controls: opts.controls ? 1 : 0,
        disablekb: opts.controls ? 0 : 1,
        fs: opts.controls ? 1 : 0,
        rel: 0,
        playsinline: 1,
        iv_load_policy: 3,
        autoplay: opts.autoplay ? 1 : 0,
        mute: opts.muted ? 1 : 0,
        start: Math.floor(opts.start ?? 0),
        origin: window.location.origin,
      },
      events: {
        onReady: () => resolve(p),
        onStateChange: (e: { data: number }) => {
          const t = p.getCurrentTime?.() ?? lastTime
          lastTime = t
          lastPoll = Date.now()
          if (e.data === YT_PLAYING) {
            if (!isPlaying) { isPlaying = true; ev.onPlay?.(t) }
          } else if (e.data === YT_PAUSED) {
            if (isPlaying) { isPlaying = false; ev.onPause?.(t) }
          } else if (e.data === YT_ENDED) {
            if (isPlaying) { isPlaying = false; ev.onPause?.(t) }
            ev.onEnded?.()
          }
        },
        // 2 bad id · 5 HTML5 error · 100 removed/private · 101/150 owner blocks embedding
        onError: (e: { data: number }) => ev.onError?.(e.data === 101 || e.data === 150 ? "blocked" : "unavailable"),
      },
    })
  })
  fillHost(player.getIframe())

  // Captions: the track YouTube is showing, or null. With captions off the
  // module is unloaded and the read comes back empty or throws.
  const readCaptions = (): Captions => {
    try {
      const track = player.getOption?.("captions", "track") as { languageCode?: string } | undefined
      if (!track || typeof track !== "object" || !("languageCode" in track)) return null
      return track.languageCode ?? ""
    } catch {
      return null
    }
  }
  let lastCaptions: Captions = null

  // YouTube has no "seeked" event: a jump shows up as the time moving by more
  // than the clock did since the last look.
  const poll = setInterval(() => {
    if (destroyed) return
    const now = Date.now()
    const t = player.getCurrentTime()
    const expected = lastTime + (isPlaying ? (now - lastPoll) / 1000 : 0)
    if (Math.abs(t - expected) > 1.5) ev.onSeek?.(t)
    lastTime = t
    lastPoll = now
    ev.onTime?.(t, player.getDuration() || 0)
    // Nor a captions event: same trick, look once a second.
    const c = readCaptions()
    if (c !== lastCaptions) {
      lastCaptions = c
      ev.onCaptions?.(c)
    }
  }, 1000)

  return {
    play: async () => {
      player.playVideo()
      // A refused autoplay leaves the player unstarted without telling us.
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 250))
        const s = player.getPlayerState()
        if (s === YT_PLAYING) return true
      }
      return player.getPlayerState() === YT_BUFFERING
    },
    pause: () => player.pauseVideo(),
    seek: (t) => { player.seekTo(t, true); lastTime = t; lastPoll = Date.now() },
    setMuted: (m) => (m ? player.mute() : player.unMute()),
    setCaptions: (c) => {
      try {
        if (c === null) {
          player.setOption?.("captions", "track", {})
          player.unloadModule?.("captions")
          return
        }
        player.loadModule?.("captions")
        if (c) player.setOption?.("captions", "track", { languageCode: c })
      } catch { /* this video has no captions, or the player isn't ready */ }
    },
    time: () => player.getCurrentTime() ?? lastTime,
    playing: () => isPlaying,
    iframe: () => player.getIframe(),
    destroy: () => {
      destroyed = true
      clearInterval(poll)
      try { player.destroy() } catch { /* already gone */ }
      mount.remove()
    },
  }
}

// ── Vimeo ─────────────────────────────────────────────────────────────────────

async function createVimeo(
  host: HTMLElement, link: VideoLink, opts: EmbedPlayerOptions, ev: EmbedPlayerEvents,
): Promise<EmbedPlayer> {
  const Vimeo = await loadVimeo()
  const mount = document.createElement("div")
  host.appendChild(mount)

  let lastTime = opts.start ?? 0
  let lastTimeAt = Date.now()
  let duration = 0
  let isPlaying = false
  const setTime = (t: number | undefined) => {
    if (typeof t === "number") { lastTime = t; lastTimeAt = Date.now() }
  }
  // timeupdate comes a few times a second; between them, count on from the last one.
  const now = () => lastTime + (isPlaying ? (Date.now() - lastTimeAt) / 1000 : 0)

  const player = new Vimeo.Player(mount, {
    url: videoLinkUrl(link),
    // Hiding the controls needs a paid Vimeo plan; on a free one they show anyway.
    controls: opts.controls,
    muted: opts.muted,
    autoplay: !!opts.autoplay,
    playsinline: true,
    dnt: true,
    title: false,
    byline: false,
    portrait: false,
  })
  player.on("play", (d) => { setTime(d.seconds); isPlaying = true; ev.onPlay?.(lastTime) })
  player.on("pause", (d) => { setTime(d.seconds); isPlaying = false; ev.onPause?.(lastTime) })
  player.on("seeked", (d) => { setTime(d.seconds); ev.onSeek?.(lastTime) })
  player.on("ended", () => { setTime(now()); isPlaying = false; ev.onEnded?.() })
  player.on("timeupdate", (d) => {
    setTime(d.seconds)
    duration = d.duration ?? duration
  })
  let captions: Captions = null
  player.on("texttrackchange", (d) => {
    captions = d.language ?? null
    ev.onCaptions?.(captions)
  })
  player.on("error", (d: { name?: string; method?: string }) => {
    // A refused API call (a seek past the end, a play refused for want of a
    // tap) is reported here too, tagged with the method. Only an error from the
    // player itself means the video can't be shown.
    if (d.method || d.name === "NotAllowedError") return
    ev.onError?.(d.name === "PrivacyError" ? "blocked" : "unavailable")
  })

  try {
    await player.ready()
  } catch {
    ev.onError?.("unavailable")
  }
  fillHost(mount.querySelector("iframe"))
  if (opts.start) await player.setCurrentTime(opts.start).catch(() => {})
  duration = await player.getDuration().catch(() => 0)

  // timeupdate stops while paused; report steadily like the YouTube side.
  const tick = setInterval(() => ev.onTime?.(now(), duration), 1000)

  return {
    play: () => player.play().then(() => true, () => false),
    pause: () => { void player.pause().catch(() => {}) },
    seek: (t) => {
      // Vimeo refuses a time past the end — where a late joiner lands once the tutor's video is over.
      const to = duration ? Math.min(Math.max(0, t), Math.max(0, duration - 0.1)) : Math.max(0, t)
      setTime(to)
      void player.setCurrentTime(to).catch(() => {})
    },
    setMuted: (m) => { void player.setMuted(m).catch(() => {}) },
    setCaptions: (c) => {
      if (c === captions) return
      if (c === null) { void player.disableTextTrack().catch(() => {}); return }
      void (async () => {
        const tracks = await player.getTextTracks().catch(() => [])
        const pick = tracks.find((t) => t.language === c) ?? (c === "" ? tracks[0] : undefined)
        if (pick) await player.enableTextTrack(pick.language, pick.kind).catch(() => {})
      })()
    },
    time: now,
    playing: () => isPlaying,
    iframe: () => mount.querySelector("iframe"),
    destroy: () => {
      clearInterval(tick)
      void player.destroy().catch(() => {})
      mount.remove()
    },
  }
}

/**
 * Put a player for `link` inside `host` (which should be `position: relative`
 * and sized; the iframe fills it). Call `destroy` when done.
 */
export function createEmbedPlayer(
  host: HTMLElement, link: VideoLink, opts: EmbedPlayerOptions, events: EmbedPlayerEvents = {},
): Promise<EmbedPlayer> {
  return link.provider === "youtube"
    ? createYouTube(host, link, opts, events)
    : createVimeo(host, link, opts, events)
}
