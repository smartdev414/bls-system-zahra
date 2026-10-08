"use client"

// The dictionary's recording page: works through every sign that has no video
// yet, one after another, without touching the mouse. The camera stays on for
// the whole sitting and each take uploads in the background, so the next word
// is ready the moment the last one is accepted.
//
// components/ui/camera-recorder.tsx is the one-off version of this (one
// recording, then the camera is released) used by lessons and the sign form.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ArrowLeft, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle,
  Loader2, RotateCcw, Square, TriangleAlert, Video,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { COURSE_LEVELS, levelColor, type CourseLevel } from "@/lib/levels"
import { LOGO_MARK_SRC, MARK_W, MARK_H } from "@/components/layout/logo"
import {
  createLessonVideoCanvas, supportsLessonVideoCanvas, watermarkTileAspect,
  type BackgroundMethod, type LessonVideoCanvas,
  WATERMARK_HEIGHT, WATERMARK_MARGIN, WATERMARK_PADDING, WATERMARK_RADIUS,
} from "@/lib/lesson-video-canvas"

// Shared with the lesson recorder, so a colour chosen there carries over.
const BACKGROUND_PREF_KEY = "recorder:background"
const BACKGROUND_METHOD_PREF_KEY = "recorder:background-method"
const STUDIO_PREFS_KEY = "sign-recorder:prefs"
const WATERMARK_TILE_ASPECT = watermarkTileAspect(MARK_W / MARK_H)
const RECORDING_VIDEO_BITRATE = 4_000_000
// A sign takes a few seconds. This only catches a recording left running.
const MAX_TAKE_SECONDS = 60
const COUNTDOWN_OPTIONS = [0, 3, 5]

const BACKGROUND_PRESETS = [
  { label: "White", value: "#ffffff" },
  { label: "Light grey", value: "#d1d5db" },
  { label: "Dark grey", value: "#374151" },
  { label: "Black", value: "#000000" },
  { label: "Blue", value: "#1e40af" },
  { label: "Green", value: "#166534" },
]

// MP4 first: it plays everywhere, including the iOS app, which WebM does not.
const RECORDING_MIME_TYPES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm",
]

type QueueSign = {
  id: string
  word: string
  category: string
  level: CourseLevel
  description: string
}

type QueueData = { signs: QueueSign[]; hasMore: boolean; remaining: number; categories: string[] }
type Phase = "idle" | "countdown" | "recording" | "review"
type TakeStatus = "uploading" | "saved" | "failed"
type Take = { sign: QueueSign; blob: Blob; url: string }
type StudioPrefs = { review: boolean; countdown: number }

function readBackgroundPreference(): string | null {
  try {
    const value = window.localStorage.getItem(BACKGROUND_PREF_KEY)
    return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null
  } catch {
    return null
  }
}

function writeBackgroundPreference(color: string | null): void {
  try {
    if (color) window.localStorage.setItem(BACKGROUND_PREF_KEY, color)
    else window.localStorage.removeItem(BACKGROUND_PREF_KEY)
  } catch {
    // Private mode / quota — ignore. The preference simply won't persist.
  }
}

function readMethodPreference(): BackgroundMethod {
  try {
    const value = window.localStorage.getItem(BACKGROUND_METHOD_PREF_KEY)
    return value === "model" || value === "backdrop" ? value : "auto"
  } catch {
    return "auto"
  }
}

function writeMethodPreference(method: BackgroundMethod): void {
  try {
    window.localStorage.setItem(BACKGROUND_METHOD_PREF_KEY, method)
  } catch {
    // Private mode / quota — ignore. The preference simply won't persist.
  }
}

function readStudioPrefs(): StudioPrefs {
  const fallback = { review: true, countdown: 3 }
  try {
    const saved = JSON.parse(window.localStorage.getItem(STUDIO_PREFS_KEY) ?? "null") as Partial<StudioPrefs> | null
    return {
      review: typeof saved?.review === "boolean" ? saved.review : fallback.review,
      countdown: COUNTDOWN_OPTIONS.includes(saved?.countdown as number) ? (saved?.countdown as number) : fallback.countdown,
    }
  } catch {
    return fallback
  }
}

function writeStudioPrefs(prefs: StudioPrefs): void {
  try {
    window.localStorage.setItem(STUDIO_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Same as above.
  }
}

/** Uploads one take and attaches it to its sign. */
async function persistTake(sign: QueueSign, blob: Blob): Promise<void> {
  const contentType = blob.type === "video/mp4" ? "video/mp4" : "video/webm"
  const extension = contentType === "video/mp4" ? "mp4" : "webm"
  const baseName = sign.word.replace(/[^\w\- ]+/g, "").trim() || "sign"

  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: `${baseName}.${extension}`, contentType, fileSize: blob.size }),
  })
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({})) as { message?: string }
    throw new Error(err.message ?? "Could not get upload URL")
  }
  const { presignedUrl, fileUrl } = await presignRes.json() as { presignedUrl: string; fileUrl: string }

  const uploadRes = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  })
  if (!uploadRes.ok) throw new Error("Upload to S3 failed")

  const saveRes = await fetch(`/api/admin/signs/${sign.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl: fileUrl }),
  })
  if (!saveRes.ok) {
    const err = await saveRes.json().catch(() => ({})) as { message?: string }
    throw new Error(err.message ?? "Could not save the video to the sign")
  }
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

export function SignRecordingStudio() {
  // ── Queue ──────────────────────────────────────────────────────────────────
  const [category, setCategory] = useState("all")
  const [level, setLevel] = useState("all")
  const [items, setItems] = useState<QueueSign[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [categories, setCategories] = useState<string[]>([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError, setQueueError] = useState(false)
  const [index, setIndex] = useState(0)
  const [statuses, setStatuses] = useState<Record<string, TakeStatus>>({})
  // Takes whose upload failed, kept so they can be retried without re-signing.
  const failedTakesRef = useRef(new Map<string, Blob>())
  const queueRequestRef = useRef(0)
  const currentRowRef = useRef<HTMLButtonElement>(null)

  // ── Camera ─────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rendererRef = useRef<LessonVideoCanvas | null>(null)
  const [ready, setReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [rendererActive, setRendererActive] = useState(false)
  // null = keep the camera's real background.
  const [background, setBackground] = useState<string | null>(() => readBackgroundPreference())
  const [backgroundReady, setBackgroundReady] = useState(false)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  // How the signer is cut out: by the model (works anywhere), or by replacing
  // the colour of a plain cloth hung behind them (much cleaner hands). "auto"
  // does the second whenever it can see such a cloth.
  const [method, setMethod] = useState<BackgroundMethod>(() => readMethodPreference())
  const [backdropDetected, setBackdropDetected] = useState(false)
  const [backdropStrength, setBackdropStrength] = useState(0.5)
  const [videoAspect, setVideoAspect] = useState<number | null>(null)

  // ── Recording ──────────────────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<StudioPrefs>(() => readStudioPrefs())
  const [phase, setPhase] = useState<Phase>("idle")
  const [countdown, setCountdown] = useState(0)
  const [duration, setDuration] = useState(0)
  const [take, setTake] = useState<Take | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const discardRef = useRef(false)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The recorder and the key listener outlive the render that created them, so
  // they call through these to reach the current state.
  const onTakeRef = useRef<(sign: QueueSign, blob: Blob) => void>(() => {})
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})

  const current: QueueSign | undefined = items[index]
  const backgroundOn = background !== null
  const backgroundPending =
    ready && backgroundOn && rendererActive && method !== "backdrop" && !backgroundReady
  const keying = method === "backdrop" || (method === "auto" && backdropDetected)
  const backdropMissing = ready && backgroundOn && rendererActive && method === "backdrop" && !backdropDetected
  const customBackground = backgroundOn && !BACKGROUND_PRESETS.some((p) => p.value === background)
  const canRecord = ready && !backgroundPending && !!current
  const savedCount = Object.values(statuses).filter((s) => s === "saved").length
  const uploadingCount = Object.values(statuses).filter((s) => s === "uploading").length
  const failedCount = Object.values(statuses).filter((s) => s === "failed").length
  const queueFinished = !queueLoading && !current && !hasMore

  // ── Queue loading ──────────────────────────────────────────────────────────

  const loadQueue = useCallback(async (after: string | null) => {
    const requestId = ++queueRequestRef.current
    setQueueLoading(true)
    setQueueError(false)
    try {
      const params = new URLSearchParams()
      if (category !== "all") params.set("category", category)
      if (level !== "all") params.set("level", level)
      if (after) params.set("after", after)
      const res = await fetch(`/api/admin/signs/record-queue?${params.toString()}`)
      if (!res.ok) throw new Error("Request failed")
      const data = await res.json() as QueueData
      // A newer request (the filters changed) has taken over.
      if (requestId !== queueRequestRef.current) return
      setItems((prev) => (after ? [...prev, ...data.signs] : data.signs))
      setHasMore(data.hasMore)
      setCategories(data.categories)
      if (!after) setRemaining(data.remaining)
    } catch {
      if (requestId !== queueRequestRef.current) return
      setQueueError(true)
      toast.error("Could not load the signs to record")
    } finally {
      if (requestId === queueRequestRef.current) setQueueLoading(false)
    }
  }, [category, level])

  useEffect(() => {
    void loadQueue(null)
  }, [loadQueue])

  // Fetch the next batch a few signs before the loaded ones run out.
  useEffect(() => {
    if (queueLoading || queueError || !hasMore || !items.length) return
    if (index >= items.length - 5) void loadQueue(items[items.length - 1].word)
  }, [index, items, hasMore, queueLoading, queueError, loadQueue])

  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: "nearest" })
  }, [index])

  function changeFilter(apply: () => void) {
    apply()
    setItems([])
    setIndex(0)
    setHasMore(false)
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this browser.")
      return
    }
    let cancelled = false
    navigator.mediaDevices
      // Video only — a sign has no sound, and this avoids the microphone prompt.
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setCameraError("Could not access the camera. Please allow camera permission and reload.")
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // Starts the canvas render loop once the camera is live. The canvas — not
  // the raw camera — is what gets recorded, so the logo and background colour
  // end up in the video file itself.
  useEffect(() => {
    if (!ready) return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !supportsLessonVideoCanvas()) return

    let renderer: LessonVideoCanvas
    try {
      renderer = createLessonVideoCanvas(video, canvas, {
        watermarkSrc: LOGO_MARK_SRC,
        onBackdropDetected: setBackdropDetected,
      })
    } catch (err) {
      console.error("[sign-recorder] canvas renderer failed", err)
      return
    }
    rendererRef.current = renderer
    setRendererActive(true)

    return () => {
      renderer.destroy()
      rendererRef.current = null
      setRendererActive(false)
      setBackgroundReady(false)
      setBackdropDetected(false)
    }
  }, [ready])

  // The first colour downloads the segmentation model; recording is held
  // until that resolves.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!rendererActive || !renderer) return
    let cancelled = false
    renderer.setBackground(background, method)
      .then(() => {
        if (!cancelled && background) setBackgroundReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("[sign-recorder] background colour failed", err)
        setBackgroundError("Couldn't load the background effect. Recording with your real background.")
        setBackground(null)
      })
    return () => { cancelled = true }
  }, [rendererActive, background, method])

  useEffect(() => {
    if (rendererActive) rendererRef.current?.setBackdropStrength(backdropStrength)
  }, [rendererActive, backdropStrength])

  function chooseMethod(next: BackgroundMethod) {
    setBackgroundError(null)
    // The model may still need downloading; the backdrop method never does.
    if (next !== "backdrop") setBackgroundReady(false)
    setMethod(next)
    writeMethodPreference(next)
  }

  function chooseBackground(color: string | null) {
    if (color && !supportsLessonVideoCanvas()) {
      setBackgroundError("Background colours aren't supported on this browser.")
      return
    }
    setBackgroundError(null)
    setBackground(color)
    writeBackgroundPreference(color)
  }

  function updatePrefs(next: StudioPrefs) {
    setPrefs(next)
    writeStudioPrefs(next)
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  function clearTimers() {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
    if (durationTimerRef.current) clearInterval(durationTimerRef.current)
    countdownTimerRef.current = null
    durationTimerRef.current = null
  }

  function startRecording(sign: QueueSign) {
    const camera = streamRef.current
    if (!camera) return

    const processed = rendererRef.current?.captureStream(30)
    // Signing is fast hand movement: have the encoder keep the frame rate up
    // rather than hold back frames to sharpen a still picture.
    processed?.getVideoTracks().forEach((track) => { track.contentHint = "motion" })
    // Cloned in the fallback so stopping this take doesn't stop the camera.
    const recordStream = processed ?? new MediaStream(camera.getVideoTracks().map((t) => t.clone()))

    const mimeType = RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(
        recordStream,
        { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: RECORDING_VIDEO_BITRATE }
      )
    } catch (err) {
      console.error("[sign-recorder] could not start recording", err)
      recordStream.getTracks().forEach((t) => t.stop())
      toast.error("Could not start recording in this browser")
      setPhase("idle")
      return
    }

    chunksRef.current = []
    discardRef.current = false
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      recordStream.getTracks().forEach((t) => t.stop())
      recorderRef.current = null
      if (discardRef.current) return
      const type = (recorder.mimeType || mimeType || "video/webm").split(";")[0]
      onTakeRef.current(sign, new Blob(chunksRef.current, { type }))
    }

    recorder.start(1000)
    setDuration(0)
    setPhase("recording")
    let elapsed = 0
    durationTimerRef.current = setInterval(() => {
      elapsed += 1
      setDuration(elapsed)
      if (elapsed >= MAX_TAKE_SECONDS) stopRecording()
    }, 1000)
  }

  function beginTake() {
    if (!canRecord || !current || phase !== "idle") return
    const sign = current
    if (prefs.countdown === 0) {
      startRecording(sign)
      return
    }
    let left = prefs.countdown
    setCountdown(left)
    setPhase("countdown")
    countdownTimerRef.current = setInterval(() => {
      left -= 1
      if (left > 0) {
        setCountdown(left)
        return
      }
      clearTimers()
      startRecording(sign)
    }, 1000)
  }

  function cancelCountdown() {
    clearTimers()
    setPhase("idle")
  }

  function stopRecording(discard = false) {
    clearTimers()
    discardRef.current = discard
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop()
    if (discard) setPhase("idle")
  }

  function saveTake(sign: QueueSign, blob: Blob) {
    setStatuses((prev) => ({ ...prev, [sign.id]: "uploading" }))
    persistTake(sign, blob)
      .then(() => {
        failedTakesRef.current.delete(sign.id)
        setStatuses((prev) => ({ ...prev, [sign.id]: "saved" }))
      })
      .catch((err) => {
        failedTakesRef.current.set(sign.id, blob)
        setStatuses((prev) => ({ ...prev, [sign.id]: "failed" }))
        toast.error(`"${sign.word}" was not saved: ${err instanceof Error ? err.message : "upload failed"}`)
      })
  }

  function retrySave(sign: QueueSign) {
    const blob = failedTakesRef.current.get(sign.id)
    if (blob) saveTake(sign, blob)
  }

  function handleTake(sign: QueueSign, blob: Blob) {
    if (blob.size === 0) {
      toast.error("Nothing was recorded — please try again")
      setPhase("idle")
      return
    }
    if (prefs.review) {
      setTake({ sign, blob, url: URL.createObjectURL(blob) })
      setPhase("review")
      return
    }
    saveTake(sign, blob)
    setPhase("idle")
    setIndex((i) => i + 1)
  }

  function acceptTake() {
    if (!take) return
    saveTake(take.sign, take.blob)
    URL.revokeObjectURL(take.url)
    setTake(null)
    setPhase("idle")
    setIndex((i) => i + 1)
  }

  function retake() {
    if (take) URL.revokeObjectURL(take.url)
    setTake(null)
    setPhase("idle")
  }

  function go(delta: number) {
    if (phase !== "idle") return
    setIndex((i) => Math.min(Math.max(i + delta, 0), items.length))
  }

  function handleKey(e: KeyboardEvent) {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target?.closest("input, textarea, select, [role=combobox], [role=listbox], [contenteditable=true]")) return
    const onButton = target?.closest("button, a")

    if (e.key === " ") {
      // Space always drives the recorder, even with a button focused from an
      // earlier click — blur it so its own click doesn't fire as well.
      e.preventDefault()
      if (onButton instanceof HTMLElement) onButton.blur()
      if (phase === "idle") beginTake()
      else if (phase === "countdown") cancelCountdown()
      else if (phase === "recording") stopRecording()
      return
    }
    if (onButton) return

    if (e.key === "Enter" && phase === "review") acceptTake()
    else if (e.key.toLowerCase() === "r" && phase === "review") retake()
    else if (e.key === "Escape") {
      if (phase === "countdown") cancelCountdown()
      else if (phase === "recording") stopRecording(true)
      else if (phase === "review") retake()
    }
    else if (e.key === "ArrowRight") go(1)
    else if (e.key === "ArrowLeft") go(-1)
  }

  useEffect(() => {
    onTakeRef.current = handleTake
    onKeyRef.current = handleKey
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  // Leaving mid-upload would lose the takes still on their way.
  useEffect(() => {
    if (!uploadingCount && !failedCount) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [uploadingCount, failedCount])

  useEffect(() => {
    return () => {
      clearTimers()
      discardRef.current = true
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop()
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  const waitingCount = Math.max(remaining - savedCount - uploadingCount, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/signs"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> BSL Dictionary
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-black tracking-tight">
            <Video className="size-6 text-primary" /> Record sign videos
          </h1>
          <p className="mt-1 text-muted-foreground">
            {savedCount} saved this session · {waitingCount} still without a video
            {uploadingCount > 0 && ` · ${uploadingCount} uploading`}
            {failedCount > 0 && ` · ${failedCount} failed`}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Select
            value={category}
            onValueChange={(v) => changeFilter(() => setCategory(v))}
            disabled={phase !== "idle"}
          >
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={level}
            onValueChange={(v) => changeFilter(() => setLevel(v))}
            disabled={phase !== "idle"}
          >
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {COURSE_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Stage */}
        <div className="flex flex-col gap-4">
          <div className="flex min-h-[4.5rem] flex-col justify-center">
            {current ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-4xl font-black tracking-tight">{current.word}</p>
                  <Badge variant="outline" className={`text-[10px] ${levelColor[current.level]}`}>{current.level}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{current.category}</Badge>
                  {statuses[current.id] === "saved" && (
                    <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                      <Check className="size-2.5" /> Saved — recording again replaces it
                    </Badge>
                  )}
                </div>
                {current.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{current.description}</p>
                )}
              </>
            ) : queueFinished ? (
              <>
                <p className="text-2xl font-black tracking-tight">
                  {items.length ? "That's all of them" : "No signs are waiting for a video"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {items.length
                    ? "Every sign in this list has been recorded or skipped. Skipped signs come back next time."
                    : "Add words from the dictionary page (Bulk add takes a whole list) and they will appear here."}
                </p>
              </>
            ) : (
              <Loader2 className="size-6 animate-spin text-primary" />
            )}
          </div>

          {cameraError ? (
            <div className="rounded-xl border-2 border-dashed border-destructive/30 bg-destructive/5 p-12 text-center">
              <Camera className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm text-destructive">{cameraError}</p>
            </div>
          ) : (
            <div
              className="relative overflow-hidden rounded-xl bg-black"
              style={{ aspectRatio: videoAspect ?? 16 / 9 }}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                onLoadedMetadata={(e) => {
                  const { videoWidth, videoHeight } = e.currentTarget
                  if (videoWidth && videoHeight) setVideoAspect(videoWidth / videoHeight)
                }}
                className="h-full w-full -scale-x-100 object-cover"
              />
              {/* Sits over the camera preview and is what gets recorded. The
                  <video> stays mounted underneath because the canvas is drawn
                  from it. */}
              <canvas
                ref={canvasRef}
                className={cn(
                  "absolute inset-0 h-full w-full -scale-x-100 object-cover",
                  !rendererActive && "opacity-0"
                )}
              />
              {/* The preview is mirrored, which would show the logo baked into
                  the canvas back to front. This readable copy sits exactly
                  over it — top-right here is top-left in the recorded video. */}
              {rendererActive && videoAspect && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute flex select-none items-center justify-center bg-white"
                  style={{
                    top: `${WATERMARK_MARGIN * 100}%`,
                    right: `${(WATERMARK_MARGIN / videoAspect) * 100}%`,
                    height: `${WATERMARK_HEIGHT * 100}%`,
                    width: `${((WATERMARK_HEIGHT * WATERMARK_TILE_ASPECT) / videoAspect) * 100}%`,
                    borderRadius: `${(WATERMARK_RADIUS / WATERMARK_TILE_ASPECT) * 100}% / ${WATERMARK_RADIUS * 100}%`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={LOGO_MARK_SRC} alt="" style={{ height: `${(1 - 2 * WATERMARK_PADDING) * 100}%` }} />
                </div>
              )}
              {(!ready || backgroundPending) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-white" />
                </div>
              )}
              {phase === "countdown" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="text-8xl font-black text-white drop-shadow-lg">{countdown}</span>
                </div>
              )}
              {phase === "recording" && (
                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1">
                  <span className="size-2 animate-pulse rounded-full bg-red-500" />
                  <span className="font-mono text-xs text-white">0:{duration.toString().padStart(2, "0")}</span>
                </div>
              )}
              {/* The take, the right way round — as students will see it. */}
              {phase === "review" && take && (
                <>
                  <video
                    key={take.url}
                    src={take.url}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="absolute inset-0 h-full w-full bg-black object-contain"
                  />
                  <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
                    Reviewing take
                  </div>
                </>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex min-h-10 flex-wrap items-center justify-center gap-3">
            {phase === "idle" && (
              <>
                <Button variant="outline" disabled={index === 0} onClick={() => go(-1)} className="gap-1.5">
                  <ChevronLeft className="size-4" /> Previous <Key>←</Key>
                </Button>
                <Button disabled={!canRecord} onClick={beginTake} className="gap-2">
                  <Circle className="size-4 fill-red-500 text-red-500" /> Record <Key>Space</Key>
                </Button>
                <Button variant="outline" disabled={!current} onClick={() => go(1)} className="gap-1.5">
                  Skip <Key>→</Key> <ChevronRight className="size-4" />
                </Button>
              </>
            )}
            {phase === "countdown" && (
              <Button variant="outline" onClick={cancelCountdown} className="gap-2">
                Cancel <Key>Esc</Key>
              </Button>
            )}
            {phase === "recording" && (
              <>
                <Button variant="outline" onClick={() => stopRecording(true)} className="gap-2">
                  Discard <Key>Esc</Key>
                </Button>
                <Button variant="destructive" onClick={() => stopRecording()} className="gap-2">
                  <Square className="size-4 fill-current" /> Stop <Key>Space</Key>
                </Button>
              </>
            )}
            {phase === "review" && (
              <>
                <Button variant="outline" onClick={retake} className="gap-2">
                  <RotateCcw className="size-4" /> Retake <Key>R</Key>
                </Button>
                <Button onClick={acceptTake} className="gap-2">
                  <Check className="size-4" /> Save & next <Key>Enter</Key>
                </Button>
              </>
            )}
          </div>

          {/* Background */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Background</span>
            <button
              type="button"
              disabled={phase !== "idle"}
              onClick={() => chooseBackground(null)}
              aria-pressed={!backgroundOn}
              className={cn(
                "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
                !backgroundOn ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
              )}
            >
              Original
            </button>
            {BACKGROUND_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                disabled={phase !== "idle"}
                onClick={() => chooseBackground(preset.value)}
                aria-label={`${preset.label} background`}
                aria-pressed={background === preset.value}
                title={preset.label}
                className={cn(
                  "size-7 rounded-full border transition-shadow disabled:opacity-50",
                  background === preset.value && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
                style={{ backgroundColor: preset.value }}
              />
            ))}
            <label
              title="Custom colour"
              className={cn(
                "relative size-7 overflow-hidden rounded-full border",
                customBackground && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                phase !== "idle" && "opacity-50"
              )}
              style={{
                background: customBackground
                  ? background
                  : "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
              }}
            >
              <input
                type="color"
                aria-label="Custom background colour"
                disabled={phase !== "idle"}
                value={background ?? "#ffffff"}
                onChange={(e) => chooseBackground(e.target.value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          </div>
          {backgroundOn && rendererActive && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Behind me</span>
              {([
                ["auto", "Auto"],
                ["model", "Any room"],
                ["backdrop", "Green / blue backdrop"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={phase !== "idle"}
                  onClick={() => chooseMethod(value)}
                  aria-pressed={method === value}
                  className={cn(
                    "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
                    method === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                  )}
                >
                  {label}
                </button>
              ))}
              {keying && (
                <>
                  <button
                    type="button"
                    disabled={phase !== "idle"}
                    onClick={() => rendererRef.current?.resampleBackdrop()}
                    className="h-7 rounded-full border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Re-detect
                  </button>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    Strength
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={backdropStrength}
                      onChange={(e) => setBackdropStrength(Number(e.target.value))}
                      // Keyboard shortcuts are off while an input has focus, so
                      // let go of it once the drag ends.
                      onPointerUp={(e) => e.currentTarget.blur()}
                      className="w-24 accent-primary"
                    />
                  </label>
                </>
              )}
            </div>
          )}
          {backgroundOn && rendererActive && keying && (
            <p className={cn("text-center text-xs", backdropMissing ? "text-destructive" : "text-muted-foreground")}>
              {backdropMissing
                ? "No backdrop found — recording your real background. Hang a plain green or blue cloth so it fills both top corners of the picture, light it evenly, then press Re-detect."
                : "Coloured backdrop found — replacing it directly for cleaner hands. Avoid wearing its colour, and raise Strength if shadows or creases show through."}
            </p>
          )}
          {backgroundError && <p className="text-center text-xs text-destructive">{backgroundError}</p>}

          {/* Options */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-medium">Countdown</span>
              {COUNTDOWN_OPTIONS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  disabled={phase !== "idle"}
                  onClick={() => updatePrefs({ ...prefs, countdown: seconds })}
                  aria-pressed={prefs.countdown === seconds}
                  className={cn(
                    "h-7 rounded-full border px-2.5 font-medium transition-colors disabled:opacity-50",
                    prefs.countdown === seconds ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                  )}
                >
                  {seconds === 0 ? "Off" : `${seconds}s`}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={prefs.review}
                disabled={phase !== "idle"}
                onChange={(e) => updatePrefs({ ...prefs, review: e.target.checked })}
                className="size-4 accent-primary"
              />
              <span className="font-medium">Review each take before saving</span>
            </label>
          </div>
          {rendererActive && (
            <p className="text-center text-xs text-muted-foreground">
              Keep this tab open and visible while recording — the picture pauses in a hidden tab.
            </p>
          )}
        </div>

        {/* Queue */}
        <Card className="h-fit shadow-sm">
          <CardContent className="p-2">
            <div className="flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto">
              {items.map((sign, i) => {
                const status = statuses[sign.id]
                return (
                  <div key={sign.id} className="flex items-center gap-1">
                    <button
                      ref={i === index ? currentRowRef : undefined}
                      type="button"
                      disabled={phase !== "idle"}
                      onClick={() => setIndex(i)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        i === index ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted",
                        i < index && !status && "text-muted-foreground"
                      )}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {status === "saved" && <CheckCircle2 className="size-4 text-emerald-500" />}
                        {status === "uploading" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                        {status === "failed" && <TriangleAlert className="size-4 text-destructive" />}
                      </span>
                      <span className="truncate">{sign.word}</span>
                    </button>
                    {status === "failed" && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => retrySave(sign)}>
                        Retry
                      </Button>
                    )}
                  </div>
                )
              })}
              {queueLoading && (
                <div className="flex justify-center py-3">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {queueError && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void loadQueue(items.length ? items[items.length - 1].word : null)}
                >
                  Could not load — try again
                </Button>
              )}
              {!queueLoading && !queueError && !items.length && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nothing to record here.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
