"use client"

import { useState } from "react"
import { Camera, FolderOpen, Hand, Library, Loader2, RefreshCw, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { CameraRecorder } from "@/components/ui/camera-recorder"
import { LibraryPicker } from "@/components/library/LibraryPicker"
import { cn } from "@/lib/utils"
import { isVideoMedia } from "@/lib/quiz"
import { uploadMedia, type QuestionDraft } from "./QuizBuilder"

type Props = {
  kind: "FINGERSPELLING" | "VOCABULARY"
  /** The saved test; null while it is being made, when everything is saved together. */
  testId: string | null
  signs: QuestionDraft[]
  /** Takes the new list or a function of the current one — uploads finish some time after they start. */
  onChange: (next: QuestionDraft[] | ((current: QuestionDraft[]) => QuestionDraft[])) => void
  /** Opens the dictionary to take signs from it. */
  onAddFromDictionary?: () => void
}

/** "good-morning.mp4" → "good morning": a clip named after its word needs no typing. */
function wordFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

/**
 * The signs of a fingerspelling or vocabulary test: each one a video and its
 * word. Several clips can be added at once. In a vocabulary test the words a
 * student picks from are taken from the other signs, so none are typed here.
 */
function newSign(word: string, videoUrl?: string): QuestionDraft {
  return {
    uid: crypto.randomUUID(),
    question: word,
    imageUrl: videoUrl,
    mediaType: videoUrl ? "video" : undefined,
    type: "MULTIPLE_CHOICE",
    options: [],
    isOpen: false,
    isSaving: false,
    error: null,
    dirty: true,
    questionImageUploading: !videoUrl,
  }
}

export function SignListBuilder({ kind, testId, signs, onChange, onAddFromDictionary }: Props) {
  // The camera stays open between clips, so a run of signs can be filmed one
  // after another; the count gives each clip a fresh recorder.
  const [recording, setRecording] = useState(false)
  const [recorded, setRecorded] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)

  const patch = (uid: string, change: (current: QuestionDraft) => QuestionDraft) =>
    onChange((current) => current.map((s) => (s.uid === uid ? change(s) : s)))

  function upload(uid: string, file: File) {
    patch(uid, (s) => ({ ...s, questionImageUploading: true, error: null }))
    uploadMedia(file)
      .then(({ url }) => patch(uid, (s) => ({ ...s, imageUrl: url, mediaType: "video", questionImageUploading: false, dirty: true })))
      .catch((e) => patch(uid, (s) => ({
        ...s, questionImageUploading: false, error: e instanceof Error ? e.message : "Upload failed",
      })))
  }

  function addVideos(files: File[]) {
    const added = files.map((file) => ({ file, draft: newSign(wordFromFileName(file.name)) }))
    onChange((current) => [...current, ...added.map((a) => a.draft)])
    for (const { file, draft } of added) upload(draft.uid, file)
  }

  async function remove(sign: QuestionDraft) {
    if (!testId || !sign.id) {
      onChange((current) => current.filter((s) => s.uid !== sign.uid))
      return
    }
    if (!window.confirm("Delete this sign? Answers students have already given to it are removed too.")) return
    patch(sign.uid, (s) => ({ ...s, isSaving: true, error: null }))
    try {
      const res = await fetch(`/api/tests/${testId}/questions/${sign.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      onChange((current) => current.filter((s) => s.uid !== sign.uid))
    } catch {
      patch(sign.uid, (s) => ({ ...s, isSaving: false, error: "Could not delete this sign" }))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Hand className="size-4 text-primary" />
        <h3 className="font-semibold text-sm">{kind === "FINGERSPELLING" ? "Words to fingerspell" : "Signs"}</h3>
        <Badge variant="outline" className="text-[10px]">{signs.length}</Badge>
      </div>

      {signs.map((sign, i) => (
        <div key={sign.uid} className={cn("flex flex-col gap-1.5 rounded-xl border bg-background p-2", sign.error && "border-destructive/50")}>
          <div className="flex items-center gap-3">
            <div className="relative w-28 sm:w-36 aspect-video shrink-0 overflow-hidden rounded-lg border bg-muted flex items-center justify-center">
              {sign.imageUrl
                ? isVideoMedia(sign.imageUrl, sign.mediaType)
                  ? <ProtectedVideo src={sign.imageUrl} muted controls preload="metadata" className="w-full h-full object-cover" />
                  : <img src={sign.imageUrl} alt="" className="w-full h-full object-contain" />
                : !sign.questionImageUploading && <span className="text-[10px] text-muted-foreground">No video</span>}
              {sign.questionImageUploading && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted/90 text-[10px] text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" /> Uploading…
                </span>
              )}
            </div>
            <Input
              className="flex-1 min-w-0 h-11 text-base"
              aria-label={`Word for sign ${i + 1}`}
              placeholder="Type the word"
              value={sign.question}
              maxLength={100}
              // A clip that came without a word (filmed here) is ready to be named.
              autoFocus={!sign.id && !sign.question}
              onChange={(e) => patch(sign.uid, (s) => ({ ...s, question: e.target.value, dirty: true, error: null }))}
            />
            <label
              title="Replace video"
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-md cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground focus-within:ring-2 focus-within:ring-ring",
                (sign.questionImageUploading || sign.isSaving) && "pointer-events-none opacity-50"
              )}
            >
              <RefreshCw className="size-4" />
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                aria-label={`Replace the video of sign ${i + 1}`}
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(sign.uid, f); e.target.value = "" }}
              />
            </label>
            <Button type="button" variant="ghost" size="icon"
              className="size-9 shrink-0 text-destructive hover:text-destructive"
              title="Delete sign" aria-label={`Delete sign ${i + 1}`}
              disabled={sign.isSaving}
              onClick={() => remove(sign)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
          {sign.error && <p className="text-xs text-destructive px-1">{sign.error}</p>}
        </div>
      ))}

      {recording && (
        <CameraRecorder
          key={recorded}
          uploaded={null}
          silent
          onUploaded={(file) => {
            onChange((current) => [...current, newSign("", file.fileUrl)])
            setRecorded((n) => n + 1)
          }}
        />
      )}

      <div className="rounded-xl border border-dashed p-4 flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium">{signs.length === 0 ? "Add the first sign" : "Add more signs"}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild type="button">
            <label className="cursor-pointer focus-within:ring-2 focus-within:ring-ring">
              <Upload className="size-4 mr-1.5" /> Upload videos
              <input
                type="file"
                multiple
                accept="video/mp4,video/webm,video/quicktime"
                aria-label="Upload videos"
                className="sr-only"
                onChange={(e) => { const files = [...(e.target.files ?? [])]; if (files.length) addVideos(files); e.target.value = "" }}
              />
            </label>
          </Button>
          <Button type="button" variant={recording ? "default" : "outline"} aria-pressed={recording} onClick={() => setRecording((on) => !on)}>
            <Camera className="size-4 mr-1.5" /> {recording ? "Close camera" : "Record"}
          </Button>
          {onAddFromDictionary && (
            <Button type="button" variant="outline" onClick={onAddFromDictionary}>
              <Library className="size-4 mr-1.5" /> From the dictionary
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
            <FolderOpen className="size-4 mr-1.5" /> Choose from library
          </Button>
        </div>
        <p className="text-xs text-muted-foreground max-w-md">
          You can upload several clips at once. Name each file after its word (blue.mp4) and the word is filled in for you.
        </p>
      </div>

      <LibraryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allowedTypes={["VIDEO"]}
        attachedUrls={signs.flatMap((s) => (s.imageUrl ? [s.imageUrl] : []))}
        onPick={(picked) => onChange((current) => [
          ...current,
          ...picked.map((f) => newSign(wordFromFileName(f.fileName), f.fileUrl)),
        ])}
      />

      <p className={cn("text-xs text-muted-foreground", kind === "VOCABULARY" && signs.length > 0 && signs.length < 4 && "text-amber-700")}>
        {kind === "FINGERSPELLING"
          ? "Students watch each clip and type the word. Capitals and spaces do not matter."
          : signs.length < 4
            ? "Students pick each sign's word from the words of the other signs — add at least 4 so there is a real choice."
            : "Students pick each sign's word from the words of the other signs, so there are no wrong answers to type."}
      </p>
    </div>
  )
}
