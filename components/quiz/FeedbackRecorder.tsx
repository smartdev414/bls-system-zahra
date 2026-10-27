"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Circle, Loader2, MonitorPlay, RotateCcw, Square, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ProtectedVideo } from "@/components/ui/protected-video"

// A teacher's feedback on a filmed answer (a presentation, an assessment's
// part). "Record feedback" opens a full-screen studio: the student's video
// big, the teacher's camera in the corner. Recording shares the screen — this
// tab is offered first — so what is recorded is exactly that: the student's
// video, played, paused and rewound as the teacher talks or signs over it,
// with the teacher next to it. The recording goes to the student.

/** Recording stops by itself after this. */
const MAX_SECONDS = 30 * 60

/** What the browser can record, best first (Safari only does MP4). */
function recordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t))
}

function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && !!recordingType()
}

/** 75 → "1:15". */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

async function uploadFeedback(lessonId: string, answerId: string, file: Blob): Promise<string> {
  const base = `/api/tutor/lessons/${lessonId}/results/answers/${answerId}`
  const res = await fetch(`${base}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type || "video/webm", fileSize: file.size }),
  })
  const data = await res.json().catch(() => ({})) as { presignedUrl?: string; fileUrl?: string; contentType?: string; message?: string }
  if (!res.ok || !data.presignedUrl || !data.fileUrl) throw new Error(data.message ?? "Could not upload your feedback")
  const put = await fetch(data.presignedUrl, { method: "PUT", headers: { "Content-Type": data.contentType! }, body: file })
  if (!put.ok) throw new Error("Could not upload your feedback")
  await saveFeedback(lessonId, answerId, data.fileUrl)
  return data.fileUrl
}

async function saveFeedback(lessonId: string, answerId: string, feedbackVideoUrl: string | null) {
  const res = await fetch(`/api/tutor/lessons/${lessonId}/results/answers/${answerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedbackVideoUrl }),
  })
  const data = await res.json().catch(() => ({})) as { message?: string }
  if (!res.ok) throw new Error(data.message ?? "Could not save your feedback")
}

export function FeedbackRecorder({ lessonId, answerId, studentVideoUrl, feedbackVideoUrl, studentName, onChanged }: {
  lessonId: string
  answerId: string
  /** The student's filmed answer, shown big in the studio. */
  studentVideoUrl: string
  feedbackVideoUrl?: string | null
  studentName?: string
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function remove() {
    if (!window.confirm("Delete your feedback video? The student will no longer see it.")) return
    setRemoving(true)
    try {
      await saveFeedback(lessonId, answerId, null)
      toast.success("Feedback deleted")
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the feedback")
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Your feedback</span>
      {feedbackVideoUrl ? (
        <>
          <ProtectedVideo src={feedbackVideoUrl} controls playsInline className="w-full max-w-xl aspect-video rounded-md border border-primary/40 bg-black" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)} disabled={!canShareScreen()}>
              <RotateCcw className="size-3.5 mr-1" /> Record again
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => void remove()} disabled={removing}>
              {removing ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Trash2 className="size-3.5 mr-1" />} Delete
            </Button>
          </div>
        </>
      ) : canShareScreen() ? (
        <Button type="button" size="sm" variant="outline" className="self-start h-8 text-xs" onClick={() => setOpen(true)}>
          <MonitorPlay className="size-4 mr-1.5" /> Record feedback
        </Button>
      ) : (
        <p className="text-muted-foreground">Recording feedback needs a computer, in Chrome, Edge, Firefox or Safari.</p>
      )}
      {open && (
        <FeedbackStudio
          lessonId={lessonId}
          answerId={answerId}
          studentVideoUrl={studentVideoUrl}
          studentName={studentName}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); toast.success("Feedback saved — the student can watch it now"); onChanged() }}
        />
      )}
    </div>
  )
}

function FeedbackStudio({ lessonId, answerId, studentVideoUrl, studentName, onClose, onSaved }: {
  lessonId: string
  answerId: string
  studentVideoUrl: string
  studentName?: string
  onClose: () => void
  onSaved: () => void
}) {
  const cameraRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const [state, setState] = useState<"starting" | "ready" | "recording" | "saving">("starting")
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  function stopAll() {
    for (const stream of [cameraStreamRef.current, screenStreamRef.current]) stream?.getTracks().forEach((t) => t.stop())
    cameraStreamRef.current = null
    screenStreamRef.current = null
  }

  // The camera (and microphone, if allowed) comes on with the studio.
  useEffect(() => {
    let cancelled = false
    async function start() {
      const video = { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true })
        .catch(() => navigator.mediaDevices.getUserMedia({ video, audio: false }))
        .catch(() => null)
      if (cancelled) { stream?.getTracks().forEach((t) => t.stop()); return }
      if (!stream) setError("Your camera could not be turned on — your feedback will be recorded without you in the corner.")
      cameraStreamRef.current = stream
      if (stream && cameraRef.current) {
        cameraRef.current.srcObject = stream
        void cameraRef.current.play().catch(() => {})
      }
      setState("ready")
    }
    void start()
    return () => {
      cancelled = true
      if (recorderRef.current?.state === "recording") recorderRef.current.onstop = null
      recorderRef.current?.stop()
      stopAll()
    }
  }, [])

  useEffect(() => {
    if (state !== "recording") return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [state])

  useEffect(() => {
    if (state === "recording" && seconds >= MAX_SECONDS) recorderRef.current?.stop()
  }, [state, seconds])

  async function record() {
    const type = recordingType()
    if (!type) return
    setError(null)
    let screen: MediaStream
    try {
      // This tab first: it is showing the student's video and the teacher.
      screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      } as DisplayMediaStreamOptions)
    } catch {
      setError("Screen sharing was not allowed. Press Start recording and choose this tab to share.")
      return
    }
    screenStreamRef.current = screen
    const mic = cameraStreamRef.current?.getAudioTracks() ?? []
    const stream = new MediaStream([...screen.getVideoTracks(), ...mic])
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_000_000 })
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      screen.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
      void save(new Blob(chunks, { type: type.split(";")[0] }))
    }
    // The browser's own "Stop sharing" stops the recording too.
    screen.getVideoTracks()[0]?.addEventListener("ended", () => { if (recorder.state === "recording") recorder.stop() })
    recorderRef.current = recorder
    recorder.start(1000)
    setSeconds(0)
    setState("recording")
  }

  async function save(file: Blob) {
    setState("saving")
    try {
      await uploadFeedback(lessonId, answerId, file)
      stopAll()
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your feedback")
      setState("ready")
    }
  }

  function close() {
    if (state === "recording" && !window.confirm("Stop and throw away this recording?")) return
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null
      recorderRef.current.stop()
    }
    stopAll()
    onClose()
  }

  // On the body, so nothing on the results page can clip or cover it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Record feedback">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-sm font-semibold">Feedback{studentName ? ` for ${studentName}` : ""}</p>
        <div className="flex items-center gap-2">
          {state === "recording" && (
            <span className="flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">
              <Circle className="size-2 fill-current animate-pulse" /> {clock(seconds)}
            </span>
          )}
          {state === "recording" ? (
            <Button size="sm" variant="destructive" onClick={() => recorderRef.current?.stop()}>
              <Square className="size-3.5 mr-1.5 fill-current" /> Stop and save
            </Button>
          ) : (
            <Button size="sm" onClick={() => void record()} disabled={state !== "ready"}>
              {state === "saving"
                ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving…</>
                : <><Circle className="size-3.5 mr-1.5 fill-rose-500 text-rose-500" /> Start recording</>}
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-8" onClick={close} disabled={state === "saving"} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {state !== "recording" && (
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          {state === "saving"
            ? "Uploading your feedback — keep this open until it is done."
            : "Press Start recording and share this tab. Then play the student's video, pause it where you want to comment, and sign or talk next to it. Press Stop and save when you are done."}
        </p>
      )}
      {error && <p role="alert" className="mx-4 mt-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      <div className="relative flex-1 min-h-0 p-4">
        <ProtectedVideo src={studentVideoUrl} controls playsInline className="h-full w-full rounded-lg bg-black object-contain" />
        {/* Not mirrored, so the student sees the signing the right way round. */}
        <video
          ref={cameraRef}
          muted
          playsInline
          className="absolute bottom-20 right-8 w-[26%] min-w-40 max-w-sm aspect-[4/3] rounded-xl border-2 border-white bg-black object-cover shadow-xl"
        />
      </div>
    </div>,
    document.body,
  )
}
