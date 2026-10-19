"use client"

import { useState } from "react"
import { BookOpen, Camera, FolderOpen, Hand, Keyboard, ListChecks, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CameraRecorder } from "@/components/ui/camera-recorder"
import { LibraryPicker } from "@/components/library/LibraryPicker"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ANSWER_SECONDS, TEST_KINDS, TEST_KIND_INFO, type TestKind } from "@/lib/quiz"
import { cn } from "@/lib/utils"
import { MediaUploadButton, uploadMedia } from "./QuizBuilder"

const ICONS: Record<TestKind, LucideIcon> = {
  STANDARD: ListChecks,
  STORY: BookOpen,
  FINGERSPELLING: Keyboard,
  VOCABULARY: Hand,
}

/** Which kind of test to make. Chosen once, when the test is added. */
export function TestKindPicker({ value, onChange }: { value: TestKind; onChange: (kind: TestKind) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Kind of test</Label>
      <div role="radiogroup" aria-label="Kind of test" className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {TEST_KINDS.map((kind) => {
          const Icon = ICONS[kind]
          const selected = kind === value
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(kind)}
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors",
                selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
              )}
            >
              <Icon className={cn("size-5", selected ? "text-primary" : "text-muted-foreground")} />
              <span className="text-sm font-semibold">{TEST_KIND_INFO[kind].label}</span>
              <span className="text-xs text-muted-foreground">{TEST_KIND_INFO[kind].hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Fingerspelling and vocabulary: how long a student has for each sign. */
export function AnswerSecondsField({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-xs">
      <Label>Time for each sign</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {ANSWER_SECONDS.map((s) => <SelectItem key={s} value={String(s)}>{s} seconds</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">The time starts when the sign finishes playing. When it is up the next sign comes up by itself.</p>
    </div>
  )
}

/**
 * Fingerspelling and vocabulary: how many times each sign plays. Once or twice
 * makes the test a real challenge — the student has to catch it — while
 * "repeat" keeps it looping until the time is up.
 */
export function SignPlaysField({ value, onChange }: { value: number | null; onChange: (plays: number | null) => void }) {
  const choices: Array<{ value: number | null; label: string }> = [
    { value: null, label: "Repeat" },
    { value: 2, label: "Twice" },
    { value: 1, label: "Once only" },
  ]
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-xs">
      <Label>Each sign plays</Label>
      <div role="radiogroup" aria-label="Each sign plays" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
        {choices.map((c) => (
          <button
            key={c.label}
            type="button"
            role="radio"
            aria-checked={value === c.value}
            onClick={() => onChange(c.value)}
            className={cn(
              "rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
              value === c.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {value === null
          ? "The video repeats until the time is up."
          : `Students see each sign ${value === 1 ? "once" : "twice"} — a harder challenge.`}
      </p>
    </div>
  )
}

/** Story tests: the video the questions are about. */
export function StoryVideoField({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  async function upload(file: File) {
    setUploading(true)
    setError(null)
    try {
      onChange((await uploadMedia(file)).url)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Story video</Label>
      <MediaUploadButton
        mediaUrl={value ?? undefined}
        mediaType="video"
        uploading={uploading}
        onUpload={upload}
        onRemove={() => onChange(null)}
        size="question"
        videoOnly
      />
      {/* The same three ways in as a video lesson: upload (above), film it here, or reuse one. */}
      {!value && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={recording ? "default" : "outline"} aria-pressed={recording} onClick={() => setRecording((on) => !on)}>
            <Camera className="size-3.5 mr-1.5" /> {recording ? "Close camera" : "Record"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <FolderOpen className="size-3.5 mr-1.5" /> Choose from library
          </Button>
        </div>
      )}
      {recording && !value && (
        <CameraRecorder uploaded={null} onUploaded={(file) => { onChange(file.fileUrl); setRecording(false) }} />
      )}
      <LibraryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allowedTypes={["VIDEO"]}
        onPick={(picked) => { if (picked[0]) onChange(picked[0].fileUrl) }}
      />
      <p className="text-xs text-muted-foreground">
        Students watch the story, then answer the questions below. They can watch it again while they answer.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
