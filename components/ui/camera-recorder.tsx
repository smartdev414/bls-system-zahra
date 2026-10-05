"use client"

import { useRef, useState, useEffect } from "react"
import { Camera, Square, Circle, Loader2, CheckCircle2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { UploadedFile } from "@/components/ui/file-upload"
import { createSolidBackground, supportsSolidBackground, type SolidBackground } from "@/lib/solid-background"

const BACKGROUND_PREF_KEY = "recorder:background"

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
  const backgroundRef = useRef<SolidBackground | null>(null)

  const [ready, setReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  // null = record the camera as-is. Otherwise the picture is redrawn on a
  // canvas with everything behind the tutor replaced by this colour, and the
  // canvas (not the raw camera) is what gets recorded.
  const [background, setBackground] = useState<string | null>(() => readBackgroundPreference())
  const [backgroundActive, setBackgroundActive] = useState(false)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  const backgroundOn = background !== null
  // Latest colour for the setup effect, which must not restart on a colour change.
  const backgroundColorRef = useRef(background)
  useEffect(() => {
    backgroundColorRef.current = background
    if (background) backgroundRef.current?.setColor(background)
  }, [background])

  useEffect(() => {
    if (uploaded) return

    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this browser.")
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
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

  // Loads the segmentation model and starts the canvas render loop whenever a
  // background colour is switched on; colour changes go through setColor above.
  useEffect(() => {
    if (!ready || !backgroundOn || uploaded) return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    let cancelled = false
    let instance: SolidBackground | null = null

    createSolidBackground(video, canvas, backgroundColorRef.current ?? "#000000")
      .then((created) => {
        if (cancelled) {
          created.destroy()
          return
        }
        instance = created
        if (backgroundColorRef.current) created.setColor(backgroundColorRef.current)
        backgroundRef.current = created
        setBackgroundActive(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("[recorder] background colour failed", err)
        setBackgroundError("Couldn't load the background effect. Recording with your real background.")
        setBackground(null)
      })

    return () => {
      cancelled = true
      instance?.destroy()
      if (backgroundRef.current === instance) backgroundRef.current = null
      setBackgroundActive(false)
    }
  }, [ready, backgroundOn, uploaded])

  function chooseBackground(color: string | null) {
    if (color && !supportsSolidBackground()) {
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

    // With a background colour on, record the processed canvas picture
    // alongside the microphone instead of the raw camera.
    const processed = backgroundOn ? backgroundRef.current?.captureStream(30) : null
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
      mimeType ? { mimeType } : undefined
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
    const fileName = `recording-${Date.now()}.webm`

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

      const { presignedUrl, fileUrl, assetType } = await presignRes.json() as {
        presignedUrl: string
        fileUrl: string
        assetType: string
      }

      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": "video/webm" },
        body: blob,
      })

      if (!uploadRes.ok) throw new Error("Upload to S3 failed")

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
  // the processed picture is actually there.
  const backgroundPending = ready && backgroundOn && !backgroundActive
  const customBackground = backgroundOn && !BACKGROUND_PRESETS.some((p) => p.value === background)

  return (
    <div className="flex flex-col gap-3">
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full h-full object-cover -scale-x-100"
        />
        {/* Sits over the camera preview. The <video> stays mounted underneath
            because the canvas is drawn from it. */}
        {backgroundOn && (
          <canvas
            ref={canvasRef}
            className={cn(
              "absolute inset-0 w-full h-full object-cover -scale-x-100",
              !backgroundActive && "opacity-0"
            )}
          />
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

      {backgroundOn && !backgroundError && (
        <p className="text-xs text-muted-foreground text-center">
          Keep this tab open and visible while recording — the background effect pauses in a hidden tab.
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
