"use client"

import { useRef, useState, useEffect } from "react"
import { Camera, Square, Circle, Loader2, CheckCircle2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { UploadedFile } from "@/components/ui/file-upload"
import { LOGO_MARK_SRC, MARK_W, MARK_H } from "@/components/layout/logo"
import {
  createLessonVideoCanvas, supportsLessonVideoCanvas, watermarkTileAspect,
  type BackgroundMethod, type LessonVideoCanvas,
  WATERMARK_HEIGHT, WATERMARK_MARGIN, WATERMARK_PADDING, WATERMARK_RADIUS,
} from "@/lib/lesson-video-canvas"
import { rawRecordingName } from "@/lib/background-clean-keys"
import { setVideoCleanState, useVideoCleanState } from "@/hooks/use-video-clean"
import { VideoCleanBadge } from "@/components/ui/video-clean-badge"

const BACKGROUND_PREF_KEY = "recorder:background"
const BACKGROUND_METHOD_PREF_KEY = "recorder:background-method"
const WATERMARK_TILE_ASPECT = watermarkTileAspect(MARK_W / MARK_H)
// About 30 MB a minute, so the 500 MB upload cap is reached at roughly 16 minutes.
const RECORDING_VIDEO_BITRATE = 4_000_000

const BACKGROUND_PRESETS = [
  { label: "White", value: "#ffffff" },
  { label: "Light grey", value: "#d1d5db" },
  { label: "Dark grey", value: "#374151" },
  { label: "Black", value: "#000000" },
  { label: "Blue", value: "#1e40af" },
  { label: "Green", value: "#166534" },
]

/** The tutor's last background colour, or null for the camera's real background. */
function readBackgroundPreference(): string | null {
  if (typeof window === "undefined") return null
  try {
    const value = window.localStorage.getItem(BACKGROUND_PREF_KEY)
    return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null
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
}

export function CameraRecorder({ onUploaded, onRemove, uploaded, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LessonVideoCanvas | null>(null)

  const [ready, setReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [uploading, setUploading] = useState(false)
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

  useEffect(() => {
    if (uploaded) return

    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this browser.")
      return
    }

    navigator.mediaDevices
      // Ask for 720p at 30 fps: left to itself the browser opens the camera at
      // 640×480, which is too soft to read fingers. These are preferences, so
      // a camera that can't do it still opens at whatever it has.
      .getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: true,
      })
      .then((stream) => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        setReady(true)
      })
      .catch(() => {
        setCameraError("Could not access camera. Please allow camera and microphone permissions.")
      })

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [uploaded])

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

    const recorder = new MediaRecorder(
      recordStream,
      // The browser's default (about 2.5 Mbps) smears moving hands at 720p.
      { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: RECORDING_VIDEO_BITRATE }
    )
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" })
      void handleUpload(blob)
    }

    recorder.start(1000)
    setRecording(true)
    setDuration(0)
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)
  }

  function stopRecording() {
    recorderRef.current?.stop()
    setRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recordStreamRef.current?.getTracks().forEach((t) => t.stop())
    recordStreamRef.current = null
  }

  async function handleUpload(blob: Blob) {
    setError(null)
    setUploading(true)
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

      onUploaded({
        fileUrl,
        fileName,
        fileSize: blob.size,
        mimeType: "video/webm",
        assetType,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
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

  if (uploading) {
    return (
      <div className="rounded-xl border p-8 flex flex-col items-center gap-3 bg-muted/30">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-semibold">Uploading recording…</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  // A colour is chosen but the model is still loading — hold recording until
  // the processed picture is actually there. Not when the server does the
  // background: the camera is recorded untouched, so there is nothing to wait for.
  const backgroundPending =
    ready && backgroundOn && rendererActive && !cleanLater && method !== "backdrop" && !backgroundReady
  const keying = method === "backdrop" || (method === "auto" && backdropDetected)
  const backdropMissing = ready && backgroundOn && rendererActive && method === "backdrop" && !backdropDetected
  const customBackground = backgroundOn && !BACKGROUND_PRESETS.some((p) => p.value === background)

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative rounded-xl overflow-hidden bg-black"
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
        {/* The preview is mirrored like a mirror, which would show the logo
            baked into the canvas back to front. This readable copy sits exactly
            over it — top-right here is top-left in the recorded video. */}
        {rendererActive && videoAspect && (
          <div
            aria-hidden
            className="absolute flex items-center justify-center bg-white pointer-events-none select-none"
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
        {recording && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 rounded-full px-2.5 py-1">
            <span className="size-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-mono text-white">{formatDuration(duration)}</span>
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
            value={background ?? "#ffffff"}
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
          Your background is replaced automatically in the background after you stop recording. It takes a few
          minutes — the preview here is only a rough guide.
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
          <Button
            type="button"
            variant="destructive"
            onClick={stopRecording}
            className="gap-2"
          >
            <Square className="size-4 fill-current" />
            Stop & Save
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive text-center">{error}</p>}
    </div>
  )
}
