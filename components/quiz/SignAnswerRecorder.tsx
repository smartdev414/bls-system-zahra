"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, Circle, Loader2, RotateCcw, Square, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { cn } from "@/lib/utils"

/** One sign takes seconds; recording stops by itself after this. */
const MAX_SECONDS = 30

/** What the browser can record, best first (Safari only does MP4). */
function recordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t))
}

/** Uploads a recording into the student's private folder for this test; resolves to its URL. */
async function uploadAnswerVideo(lessonId: string, file: Blob): Promise<string> {
  const res = await fetch(`/api/student/lessons/${lessonId}/quiz/recording`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type || "video/webm", fileSize: file.size }),
  })
  const data = await res.json().catch(() => ({})) as { presignedUrl?: string; fileUrl?: string; contentType?: string; message?: string }
  if (!res.ok || !data.presignedUrl || !data.fileUrl) throw new Error(data.message ?? "Could not upload your video")
  const put = await fetch(data.presignedUrl, { method: "PUT", headers: { "Content-Type": data.contentType! }, body: file })
  if (!put.ok) throw new Error("Could not upload your video")
  return data.fileUrl
}

/**
 * The student films themselves signing the answer: camera on, record, stop,
 * and it is uploaded. They can watch it back and record it again as often as
 * they like before submitting. Where the browser cannot record (older phones)
 * the phone's own camera is offered instead.
 */
export function SignAnswerRecorder({ lessonId, videoUrl, onChange }: {
  lessonId: string
  /** The recording already made for this question, if any. */
  videoUrl?: string
  onChange: (videoUrl: string | undefined) => void
}) {
  const liveRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const [state, setState] = useState<"idle" | "starting" | "ready" | "recording" | "uploading">("idle")
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [canRecord] = useState(() =>
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!recordingType())

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  // The camera goes off when the student moves to another question.
  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.onstop = null
    recorderRef.current?.stop()
    stopCamera()
  }, [])

  useEffect(() => {
    if (state !== "recording") return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [state])

  useEffect(() => {
    if (state === "recording" && seconds >= MAX_SECONDS) recorderRef.current?.stop()
  }, [state, seconds])

  async function startCamera() {
    setError(null)
    setState("starting")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setState("ready")
      // The video element is shown once ready; attach on the next frame.
      requestAnimationFrame(() => {
        if (liveRef.current) {
          liveRef.current.srcObject = stream
          void liveRef.current.play().catch(() => {})
        }
      })
    } catch {
      setState("idle")
      setError("Could not turn on your camera. Allow camera access in your browser and try again.")
    }
  }

  async function save(file: Blob) {
    setState("uploading")
    setError(null)
    try {
      onChange(await uploadAnswerVideo(lessonId, file))
      setState("idle")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload your video")
      setState(streamRef.current ? "ready" : "idle")
      return
    }
    stopCamera()
  }

  function record() {
    const stream = streamRef.current
    const type = recordingType()
    if (!stream || !type) return
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 })
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => void save(new Blob(chunks, { type: type.split(";")[0] }))
    recorderRef.current = recorder
    recorder.start()
    setSeconds(0)
    setState("recording")
  }

  // A recording made: watch it back, or record it again.
  if (videoUrl && state === "idle") {
    return (
      <div className="flex flex-col gap-2">
        <ProtectedVideo src={videoUrl} controls playsInline className="w-full max-h-72 rounded-xl border bg-black" />
        {canRecord ? (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={startCamera}>
            <RotateCcw className="size-4 mr-1.5" /> Record again
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="self-start" asChild>
            <label className="cursor-pointer"><RotateCcw className="size-4 mr-1.5" /> Record again<PhoneCameraInput onFile={save} /></label>
          </Button>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  if (!canRecord) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" className="self-start" asChild disabled={state === "uploading"}>
          <label className="cursor-pointer">
            {state === "uploading"
              ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Uploading…</>
              : <><Upload className="size-4 mr-1.5" /> Film yourself signing</>}
            <PhoneCameraInput onFile={save} />
          </label>
        </Button>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  if (state === "idle" || state === "starting") {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" className="self-start" onClick={startCamera} disabled={state === "starting"}>
          {state === "starting" ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Camera className="size-4 mr-1.5" />}
          Turn on camera
        </Button>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {/* Mirrored, like a mirror — the recording itself is not. */}
        <video ref={liveRef} muted playsInline className="w-full max-h-72 rounded-xl border bg-black -scale-x-100" />
        {state === "recording" && (
          <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">
            <Circle className="size-2 fill-current animate-pulse" /> {seconds}s
          </span>
        )}
        {state === "uploading" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 text-sm font-medium text-white">
            <Loader2 className="size-5 mr-2 animate-spin" /> Saving your video…
          </div>
        )}
      </div>
      <div className="flex gap-2">
        {state === "recording" ? (
          <Button type="button" variant="destructive" onClick={() => recorderRef.current?.stop()}>
            <Square className="size-4 mr-1.5 fill-current" /> Stop
          </Button>
        ) : (
          <Button type="button" onClick={record} disabled={state === "uploading"} className={cn(state === "uploading" && "opacity-50")}>
            <Circle className="size-4 mr-1.5 fill-rose-500 text-rose-500" /> Record
          </Button>
        )}
        {state === "ready" && (
          <Button type="button" variant="ghost" onClick={() => { stopCamera(); setState("idle") }}>Cancel</Button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** The phone's own camera, where the browser cannot record in the page. */
function PhoneCameraInput({ onFile }: { onFile: (file: File) => void }) {
  return (
    <input
      type="file"
      accept="video/*"
      capture="user"
      className="sr-only"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }}
    />
  )
}
