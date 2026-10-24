"use client"

import { useRef, useState } from "react"
import { BookOpen, Camera, Clapperboard, FolderOpen, Hand, Keyboard, ListChecks, Upload, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CameraRecorder } from "@/components/ui/camera-recorder"
import { LibraryPicker } from "@/components/library/LibraryPicker"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  ANSWER_MINUTES, ANSWER_SECONDS, TEST_KINDS, TEST_KIND_INFO, VOCABULARY_MODES, VOCABULARY_MODE_INFO, type TestKind, type VocabularyMode,
} from "@/lib/quiz"
import { cn } from "@/lib/utils"
import { MediaUploadButton, uploadMedia } from "./QuizBuilder"

const ICONS: Record<TestKind, LucideIcon> = {
  STANDARD: ListChecks,
  STORY: BookOpen,
  FINGERSPELLING: Keyboard,
  VOCABULARY: Hand,
  ASSESSMENT: Clapperboard,
}

/** Which kind of test to make. Chosen once, when the test is added. */
export function TestKindPicker({ value, onChange }: { value: TestKind; onChange: (kind: TestKind) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Kind of test</Label>
      <div role="radiogroup" aria-label="Kind of test" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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

/**
 * Vocabulary: which way round it is practised — from the sign to the word,
 * from the word to the sign (the student films themselves), or both.
 */
export function VocabularyModeField({ value, onChange }: { value: VocabularyMode; onChange: (mode: VocabularyMode) => void }) {
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-md">
      <Label>Students practise</Label>
      <div role="radiogroup" aria-label="Students practise" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
        {VOCABULARY_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value === mode}
            onClick={() => onChange(mode)}
            className={cn(
              "rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
              value === mode ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {VOCABULARY_MODE_INFO[mode].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{VOCABULARY_MODE_INFO[value].hint}</p>
    </div>
  )
}

/** Assessments: how long a student has to film their answers to each part. */
export function AnswerMinutesField({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-xs">
      <Label>Time to answer each part</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {ANSWER_MINUTES.map((m) => <SelectItem key={m} value={String(m)}>{m} minutes</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Students film their answers in this time. The recording stops by itself when it is up.</p>
    </div>
  )
}

/** Assessments: whether students mark themselves against the answer sheet, or a teacher marks. */
export function TutorMarksField({ value, onChange }: { value: boolean; onChange: (tutorMarks: boolean) => void }) {
  const choices = [
    { value: false, label: "Students mark themselves" },
    { value: true, label: "A teacher marks" },
  ]
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-md">
      <Label>Who marks the answers</Label>
      <div role="radiogroup" aria-label="Who marks the answers" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
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
        {value
          ? "The course's teachers are told when answers come in, and mark them in Results. Students see the answer sheet once marked."
          : "After sending their answers in, students see the answer sheet and mark their own videos. Teachers can change the marks in Results."}
      </p>
    </div>
  )
}

/** Story tests: the video the questions are about. Assessments: the synopsis, watched first. */
export function StoryVideoField({ value, onChange, label = "Story video", hint }: {
  value: string | null
  onChange: (url: string | null) => void
  label?: string
  hint?: string
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

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
      <Label>{label}</Label>
      <MediaUploadButton
        mediaUrl={value ?? undefined}
        mediaType="video"
        uploading={uploading}
        onUpload={upload}
        onRemove={() => onChange(null)}
        size="question"
        videoOnly
      />
      {/* The same three ways in as a video lesson: upload a file, film it here, or reuse one. */}
      {!value && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
            <Upload className="size-3.5 mr-1.5" /> Upload video file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = "" }}
          />
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
        {hint ?? "Students watch the story, then answer the questions below. They can watch it again while they answer."}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
