"use client"

import { useRef, useState, useEffect, type SyntheticEvent } from "react"
import { Camera, Square, Circle, Loader2, CheckCircle2, X, Pause, Play, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { UploadedFile } from "@/components/ui/file-upload"
import { LOGO_MARK_SRC } from "@/components/layout/logo"
import {
  createLessonVideoCanvas, supportsLessonVideoCanvas,
  type BackgroundMethod, type LessonVideoCanvas,
  WATERMARK_CENTER_Y, WATERMARK_HEIGHT, WATERMARK_OPACITY,
} from "@/lib/lesson-video-canvas"
import { rawRecordingName } from "@/lib/background-clean-keys"
import { setVideoCleanState, useVideoCleanState } from "@/hooks/use-video-clean"
import { VideoCleanBadge } from "@/components/ui/video-clean-badge"
import { RecordingTrimmer } from "@/components/ui/recording-trimmer"
import { KEYFRAME_INTERVAL_MS, trimRecording, type TrimRange } from "@/lib/video-trim"
import { BACKGROUND_IMAGES, BACKGROUND_PRESETS, backgroundImage, isBackgroundValue } from "@/lib/background-presets"

const BACKGROUND_PREF_KEY = "recorder:background"
const BACKGROUND_METHOD_PREF_KEY = "recorder:background-method"
// About 30 MB a minute, so the 500 MB upload cap is reached at roughly 16 minutes.
const RECORDING_VIDEO_BITRATE = 4_000_000
// Dictionary signs are watched full screen and last seconds, so they can
// afford 1080p at twice the bitrate (see the highDefinition prop).
const HD_RECORDING_VIDEO_BITRATE = 8_000_000


/** The tutor's last background (colour or picture), or null for the camera's real background. */
function readBackgroundPreference(): string | null {
  if (typeof window === "undefined") return null
  try {
    const value = window.localStorage.getItem(BACKGROUND_PREF_KEY)
    return isBackgroundValue(value) ? value : null
  } catch {
    return null
  }
}

function writeBackgroundPreference(color: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (color) window.localStorage.setItem(BACKGROUND_PREF_KEY, color)
    else window.localStorage.removeItem(BACKGROUND_PREF_KEY)
  } catch {
    // Private mode / quota — ignore. The preference simply won't persist.
  }
}

/** Whether the tutor last recorded against a coloured backdrop. */
function readMethodPreference(): BackgroundMethod {
  if (typeof window === "undefined") return "auto"
  try {
    const value = window.localStorage.getItem(BACKGROUND_METHOD_PREF_KEY)
    return value === "model" || value === "backdrop" ? value : "auto"
  } catch {
    return "auto"
  }
}

function writeMethodPreference(method: BackgroundMethod): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(BACKGROUND_METHOD_PREF_KEY, method)
  } catch {
    // Private mode / quota — ignore. The preference simply won't persist.
  }
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0")
  const s = (seconds % 60).toString().padStart(2, "0")
  return `${m}:${s}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type Props = {
  onUploaded: (file: UploadedFile) => void
  onRemove?: () => void
  uploaded?: UploadedFile | null
  disabled?: boolean
  /** Film at 1080p instead of 720p. For short clips only: the file is twice the size. */
  highDefinition?: boolean
  /** Film without sound, with no way to turn it on — the microphone is never opened. For signs. */
  silent?: boolean
}

export function CameraRecorder({ onUploaded, onRemove, uploaded, disabled, highDefinition = false, silent = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LessonVideoCanvas | null>(null)

  // Signing needs no sound, and a microphone mostly picks up the room — so
  // recordings are silent unless the tutor turns sound on for this one.
  const [soundOn, setSoundOn] = useState(false)
  const withSound = !silent && soundOn

  const [ready, setReady] = useState(false)
  const [recording, setRecording] = useState(false)
  // Recording can be paused for a breather or to check notes; the paused
  // stretch is left out of the file, so nothing has to be cut out later.
  const [paused, setPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  // A finished recording waiting to be trimmed and saved. Nothing is uploaded
  // until the tutor has looked at it. `raw` is the camera as it was, for the
  // server to replace the background of.
  const [take, setTake] = useState<{ blob: Blob; url: string; raw: boolean } | null>(null)
  const takeUrlRef = useRef<string | null>(null)
  // What is being done to the take while it is saved, for the button to show.
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  // The camera is redrawn on a canvas, and the canvas — not the raw camera —
  // is what gets recorded, so the logo (and the background colour, if one is
  // chosen) end up in the video file itself. `rendererActive` is false on a
  // browser that can't do this; the raw camera is recorded there instead.
  const [rendererActive, setRendererActive] = useState(false)
  // null = keep the camera's real background.
  const [background, setBackground] = useState<string | null>(() => readBackgroundPreference())
  // The segmentation model is fetched on the first colour; false until it's in.
  const [backgroundReady, setBackgroundReady] = useState(false)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  const backgroundOn = background !== null
  // How the tutor is cut out: by the model (works anywhere), or by replacing
  // the colour of a plain cloth hung behind them (much cleaner hands). "auto"
  // does the second whenever it can see such a cloth.
  const [method, setMethod] = useState<BackgroundMethod>(() => readMethodPreference())
  const [backdropDetected, setBackdropDetected] = useState(false)
  const [backdropStrength, setBackdropStrength] = useState(0.5)
  // Whether the server can replace the background after upload (see
  // lib/background-clean.ts). When it can, a recording with a colour chosen is
  // uploaded as the camera saw it and redone there — the live cut-out can't
  // follow fast hands — and `cleanStatus` follows that job. The live picture
  // is then only a preview, so the tutor isn't asked how to cut it out.
  const [cleanAvailable, setCleanAvailable] = useState(false)
  const liveMethod: BackgroundMethod = cleanAvailable ? "auto" : method
  const cleanLater = cleanAvailable && backgroundOn
  const cleanColorRef = useRef<string | null>(null)
  const { state: cleanStatus } = useVideoCleanState(uploaded?.fileUrl)
  // Camera picture shape (width ÷ height), so the preview shows the whole
  // frame that is being recorded rather than a cropped one.
  const [videoAspect, setVideoAspect] = useState<number | null>(null)
  const syncVideoAspect = (e: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = e.currentTarget
    if (videoWidth && videoHeight) setVideoAspect(videoWidth / videoHeight)
  }

  const reviewing = take !== null
  useEffect(() => {
    // The camera is only on while there is something to film.
    if (uploaded || reviewing) return

    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this browser.")
      return
    }

    let cancelled = false
    navigator.mediaDevices
      // Ask for 720p at 30 fps: left to itself the browser opens the camera at
      // 640×480, which is too soft to read fingers. These are preferences, so
      // a camera that can't do it still opens at whatever it has.
      .getUserMedia({
        video: {
          width: { ideal: highDefinition ? 1920 : 1280 },
          height: { ideal: highDefinition ? 1080 : 720 },
          frameRate: { ideal: 30 },
        },
        audio: withSound,
      })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setCameraError(!withSound
          ? "Could not access camera. Please allow camera permission."
          : "Could not access camera. Please allow camera and microphone permissions.")
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setReady(false)
    }
  }, [uploaded, reviewing, highDefinition, withSound])

  useEffect(() => () => {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/upload/clean-background")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { available?: boolean } | null) => {
        if (!cancelled && data?.available) setCleanAvailable(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Starts the canvas render loop once the camera is live.
  useEffect(() => {
    if (!ready || uploaded) return
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
      console.error("[recorder] canvas renderer failed", err)
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
  }, [ready, uploaded])

  // Pushes the chosen colour to the renderer. The first colour downloads the
  // segmentation model, so recording is held until that resolves.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!rendererActive || !renderer) return
    let cancelled = false
    renderer.setBackground(background, liveMethod)
      .then(() => {
        if (!cancelled && background) setBackgroundReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("[recorder] background colour failed", err)
        // Only the preview is lost; the server still replaces the background.
        if (cleanAvailable) return
        setBackgroundError("Couldn't load the background effect. Recording with your real background.")
        setBackground(null)
      })
    return () => { cancelled = true }
  }, [rendererActive, background, liveMethod, cleanAvailable])

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

  function startRecording() {
    if (!streamRef.current) return
    chunksRef.current = []

    // With a colour chosen, the server redoes the cut-out after upload: record
    // the camera untouched for it to work from.
    cleanColorRef.current = cleanLater ? background : null

    // Otherwise record the canvas picture (logo and background colour baked
    // in) alongside the microphone. Falls back to the raw camera where the
    // canvas renderer isn't available.
    const processed = cleanLater ? undefined : rendererRef.current?.captureStream(30)
    // Signing is fast hand movement: have the encoder keep the frame rate up
    // rather than hold back frames to sharpen a still picture.
    processed?.getVideoTracks().forEach((track) => { track.contentHint = "motion" })
    const recordStream = processed
      ? new MediaStream([...processed.getVideoTracks(), ...streamRef.current.getAudioTracks()])
      : streamRef.current
    recordStreamRef.current = recordStream

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : ""

    const options: MediaRecorderOptions & { videoKeyFrameIntervalDuration?: number } = {
      ...(mimeType ? { mimeType } : {}),
      // The browser's default (about 2.5 Mbps) smears moving hands at 720p.
      videoBitsPerSecond: highDefinition ? HD_RECORDING_VIDEO_BITRATE : RECORDING_VIDEO_BITRATE,
      // Trimming can only start a video on a key frame, and left alone the
      // browser makes one every five seconds or so.
      videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS,
    }
    const recorder = new MediaRecorder(recordStream, options)
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" })
      chunksRef.current = []
      const url = URL.createObjectURL(blob)
      takeUrlRef.current = url
      setTake({ blob, url, raw: cleanColorRef.current !== null })
    }

    recorder.start(1000)
    setRecording(true)
    setPaused(false)
    setDuration(0)
    startTimer()
  }

  function startTimer() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)
  }

  function pauseRecording() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== "recording") return
    recorder.pause()
    setPaused(true)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function resumeRecording() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== "paused") return
    recorder.resume()
    setPaused(false)
    startTimer()
  }

  function stopRecording() {
    recorderRef.current?.stop()
    setRecording(false)
    setPaused(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recordStreamRef.current?.getTracks().forEach((t) => t.stop())
    recordStreamRef.current = null
  }

  function clearTake() {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current)
    takeUrlRef.current = null
    setTake(null)
  }

  function discardTake() {
    if (!window.confirm("Delete this recording and record again?")) return
    setError(null)
    clearTake()
  }

  async function saveTake(range: TrimRange | null) {
    if (!take) return
    setError(null)
    let blob = take.blob
    if (range) {
      setSaving("Trimming…")
      try {
        blob = await trimRecording(take.blob, range)
      } catch (err) {
        console.error("[recorder] trim failed", err)
        setError("Couldn't trim the recording. Try again, or press Reset to save it whole.")
        setSaving(null)
        return
      }
    }
    await handleUpload(blob)
  }

  async function handleUpload(blob: Blob) {
    setError(null)
    setSaving("Uploading…")
    const cleanColor = cleanColorRef.current
    const fileName = cleanColor ? rawRecordingName(`recording-${Date.now()}.webm`) : `recording-${Date.now()}.webm`

    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName,
          contentType: "video/webm",
          fileSize: blob.size,
        }),
      })

      if (!presignRes.ok) {
        const err = await presignRes.json() as { message?: string }
        throw new Error(err.message ?? "Could not get upload URL")
      }

      const { presignedUrl, fileUrl, key, assetType } = await presignRes.json() as {
        presignedUrl: string
        fileUrl: string
        key: string
        assetType: string
      }

      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": "video/webm" },
        body: blob,
      })

      if (!uploadRes.ok) throw new Error("Upload to S3 failed")

      if (cleanColor) {
        // The recording is safely uploaded either way; if this can't start it
        // shows as failed, with a retry.
        const cleanRes = await fetch("/api/upload/clean-background", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, color: cleanColor }),
        }).catch(() => null)
        const { state } = cleanRes?.ok ? await cleanRes.json() as { state?: "processing" | "failed" } : {}
        setVideoCleanState(fileUrl, state ?? "failed")
      }

      clearTake()
      onUploaded({
        fileUrl,
        fileName,
        fileSize: blob.size,
        mimeType: "video/webm",
        assetType,
      })
    } catch (e) {
      // The take is still here, so Save can simply be pressed again.
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setSaving(null)
    }
  }

  if (uploaded) {
    return (
      <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3 overflow-hidden">
        <div className="rounded-lg bg-primary/10 p-2 shrink-0">
          <Camera className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="text-sm font-semibold truncate" title={uploaded.fileName}>
            {uploaded.fileName}
          </p>
          <p className="text-xs text-muted-foreground">{formatBytes(uploaded.fileSize)}</p>
        </div>
        <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
        {onRemove && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={onRemove}
            disabled={disabled}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      <VideoCleanBadge url={uploaded.fileUrl} />
      {cleanStatus === "processing" && (
        <p className="text-xs text-muted-foreground">
          This takes a few minutes. You can carry on and save — students see the video once it is ready, and you
          will get a notification.
        </p>
      )}
      {cleanStatus === "done" && (
        <p className="text-xs text-muted-foreground">Background replaced — the video is ready.</p>
      )}
      </div>
    )
  }

  if (cameraError) {
    return (
      <div className="rounded-xl border-2 border-dashed border-destructive/30 bg-destructive/5 p-8 text-center">
        <Camera className="size-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-destructive">{cameraError}</p>
      </div>
    )
  }

  if (take) {
    return (
      <RecordingTrimmer
        url={take.url}
        blob={take.blob}
        note={take.raw
          ? "This is the camera as it was. Your background colour and the logo are added after you save."
          : undefined}
        busy={saving}
        error={error}
        onSave={(range) => void saveTake(range)}
        onDiscard={discardTake}
      />
    )
  }

  // A colour is chosen but the model is still loading — hold recording until
  // the processed picture is actually there. Not when the server does the
  // background: the camera is recorded untouched, so there is nothing to wait for.
  const backgroundPending =
    ready && backgroundOn && rendererActive && !cleanLater && method !== "backdrop" && !backgroundReady
  const keying = method === "backdrop" || (method === "auto" && backdropDetected)
  const backdropMissing = ready && backgroundOn && rendererActive && method === "backdrop" && !backdropDetected
  const customBackground =
    backgroundOn && !backgroundImage(background) && !BACKGROUND_PRESETS.some((p) => p.value === background)

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative mx-auto rounded-xl overflow-hidden bg-black"
        // Narrowed, never squashed, when full width would make it taller than
        // the screen (a phone on its side) — the whole frame stays in view.
        style={{
          aspectRatio: videoAspect ?? 16 / 9,
          width: `min(100%, calc(85svh * ${videoAspect ?? 16 / 9}))`,
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          onLoadedMetadata={syncVideoAspect}
          // A phone turned on its side swaps the camera's width and height
          // mid-stream. Without this the box keeps its old shape and the
          // new picture is cropped to fill it — a close-up of the face.
          onResize={syncVideoAspect}
          className="w-full h-full object-cover -scale-x-100"
        />
        {/* Sits over the camera preview and is what gets recorded. The <video>
            stays mounted underneath because the canvas is drawn from it. */}
        <canvas
          ref={canvasRef}
          className={cn(
            "absolute inset-0 w-full h-full object-cover -scale-x-100",
            !rendererActive && "opacity-0"
          )}
        />
        {/* The logo is stamped on the recorded picture, not on this (mirrored)
            canvas. This copy shows where it lands: the signer's lower chest. */}
        {rendererActive && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={LOGO_MARK_SRC}
            alt=""
            aria-hidden
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 select-none"
            style={{ top: `${WATERMARK_CENTER_Y * 100}%`, height: `${WATERMARK_HEIGHT * 100}%`, opacity: WATERMARK_OPACITY }}
          />
        )}
        {(!ready || backgroundPending) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        )}
        {!silent && (
          <button
            type="button"
            disabled={recording || disabled}
            onClick={() => setSoundOn((on) => !on)}
            aria-pressed={soundOn}
            title={soundOn ? "Sound is recorded — tap to film without sound" : "No sound is recorded — tap to record sound too"}
            className={cn(
              "absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-60",
              soundOn ? "bg-primary/90 hover:bg-primary" : "bg-black/60 hover:bg-black/75"
            )}
          >
            {soundOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            {soundOn ? "Sound on" : "No sound"}
          </button>
        )}
        {recording && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 rounded-full px-2.5 py-1">
            <span className={cn("size-2 rounded-full", paused ? "bg-amber-400" : "bg-red-500 animate-pulse")} />
            <span className="text-xs font-mono text-white">{formatDuration(duration)}</span>
            {paused && <span className="text-xs font-medium text-amber-300">Paused</span>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Background</span>
        <button
          type="button"
          disabled={recording || disabled}
          onClick={() => chooseBackground(null)}
          aria-pressed={!backgroundOn}
          className={cn(
            "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
            !backgroundOn ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
          )}
        >
          Original
        </button>
        {BACKGROUND_IMAGES.map((preset) => (
          <button
            key={preset.value}
            type="button"
            disabled={recording || disabled}
            onClick={() => chooseBackground(preset.value)}
            aria-label={`${preset.label} background`}
            aria-pressed={background === preset.value}
            title={preset.label}
            className={cn(
              "size-7 rounded-full border bg-cover bg-center transition-shadow disabled:opacity-50",
              background === preset.value && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
            style={{ backgroundImage: `url("${preset.value}")` }}
          />
        ))}
        {BACKGROUND_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            disabled={recording || disabled}
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
            (recording || disabled) && "opacity-50"
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
            disabled={recording || disabled}
            value={backgroundImage(background)?.average ?? background ?? "#ffffff"}
            onChange={(e) => chooseBackground(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>

      {backgroundOn && rendererActive && !cleanAvailable && (
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
              disabled={recording || disabled}
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
                disabled={recording || disabled}
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
                  className="w-24 accent-primary"
                />
              </label>
            </>
          )}
        </div>
      )}
      {backgroundOn && rendererActive && !cleanAvailable && keying && (
        <p className={cn("text-xs text-center", backdropMissing ? "text-destructive" : "text-muted-foreground")}>
          {backdropMissing
            ? "No backdrop found, so this is the Any room result. Hang a plain green or blue cloth behind you so it shows on both sides of your head, then press Re-detect."
            : "Coloured backdrop found — replacing it directly for cleaner hands. Avoid wearing its colour, and raise Strength if shadows or creases show through."}
        </p>
      )}

      {cleanLater && (
        <p className="text-xs text-muted-foreground text-center">
          Your background is replaced automatically in the background after you save the recording. It takes a
          few minutes — the preview here is only a rough guide.
        </p>
      )}
      {rendererActive && !backgroundError && (
        <p className="text-xs text-muted-foreground text-center">
          Keep this tab open and visible while recording — the picture pauses in a hidden tab.
        </p>
      )}
      {backgroundError && <p className="text-xs text-destructive text-center">{backgroundError}</p>}

      <div className="flex justify-center">
        {!recording ? (
          <Button
            type="button"
            disabled={!ready || disabled || backgroundPending}
            onClick={startRecording}
            className="gap-2"
          >
            <Circle className="size-4 fill-red-500 text-red-500" />
            Start Recording
          </Button>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={paused ? resumeRecording : pauseRecording}
              className="gap-2"
            >
              {paused ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={stopRecording}
              className="gap-2"
            >
              <Square className="size-4 fill-current" />
              Stop
            </Button>
          </div>
        )}
      </div>
      {recording && (
        <p className="text-xs text-muted-foreground text-center">
          {paused
            ? "Paused — nothing is being recorded. Press Resume to carry on from here; the pause is left out of the video."
            : "Pause whenever you need a moment. After Stop you can watch the take and cut the start and end before saving."}
        </p>
      )}

      {error && <p className="text-xs text-destructive text-center">{error}</p>}
    </div>
  )
}
