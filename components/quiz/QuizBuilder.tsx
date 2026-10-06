"use client"

import { useState } from "react"
import {
  Plus, Trash2, CheckCircle2, Circle, ArrowUp, ArrowDown,
  ChevronDown, ChevronUp, Loader2, Save, FlaskConical,
  ImageIcon, X, VideoIcon, Copy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { cn } from "@/lib/utils"
import { isVideoMedia } from "@/lib/quiz"
import { uploadFile } from "@/lib/upload-file"

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuizOptionDraft = {
  /** Set once saved, so an edit updates the option students already answered. */
  id?: string
  text: string
  imageUrl?: string   // image or video url
  mediaType?: "image" | "video"
  isCorrect: boolean
  uploading?: boolean
  /** Marks which upload the option is waiting on. */
  uploadId?: string
}

export type QuestionDraft = {
  /** Identifies the draft in the list while it is edited; any unique string. */
  uid: string
  id?: string
  question: string
  imageUrl?: string   // image or video url
  mediaType?: "image" | "video"
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE"
  options: QuizOptionDraft[]
  isOpen: boolean
  isSaving: boolean
  error: string | null
  /** Changed since it was last saved (or never saved). */
  dirty?: boolean
  questionImageUploading?: boolean
}

type Props = {
  lessonId: string | null
  questions: QuestionDraft[]
  /**
   * Takes the new list or, like a state setter, a function of the current one.
   * Uploads and saves finish some time after they start, and must be applied to
   * the list as it is then — not as it was when they began — or whatever the
   * admin typed or added in the meantime is thrown away.
   */
  onChange: (next: QuestionDraft[] | ((current: QuestionDraft[]) => QuestionDraft[])) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blankMultiple(): QuestionDraft {
  return {
    uid: crypto.randomUUID(),
    question: "",
    type: "MULTIPLE_CHOICE",
    options: [
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
    ],
    isOpen: true,
    isSaving: false,
    error: null,
  }
}

function blankTrueFalse(): QuestionDraft {
  return {
    uid: crypto.randomUUID(),
    question: "",
    type: "TRUE_FALSE",
    options: [
      { text: "True", isCorrect: true },
      { text: "False", isCorrect: false },
    ],
    isOpen: true,
    isSaving: false,
    error: null,
  }
}

/** A question nobody has typed anything into — left out rather than reported as unfinished. */
export function isBlankQuestion(q: QuestionDraft): boolean {
  if (q.id || q.question.trim() || q.imageUrl || q.questionImageUploading) return false
  return q.type === "TRUE_FALSE" || q.options.every((o) => !o.text.trim() && !o.imageUrl && !o.uploading)
}

/** What still has to be done before a question can be saved, or null when it is ready. */
export function questionProblem(q: QuestionDraft): string | null {
  if (!q.question.trim()) return "Type the question"
  if (q.options.some((o) => !o.text.trim() && !o.imageUrl)) return "Each answer needs text, an image or a video"
  if (!q.options.some((o) => o.isCorrect)) return "Choose which answer is correct"
  if (q.questionImageUploading || q.options.some((o) => o.uploading)) return "Wait for the upload to finish"
  return null
}

type SavedQuestion = { id: string; options: Array<{ id: string }> }

/** Creates the question on the test, or updates it when it was saved before. */
export async function saveQuestionDraft(lessonId: string, q: QuestionDraft): Promise<SavedQuestion> {
  const url = q.id
    ? `/api/tutor/lessons/${lessonId}/questions/${q.id}`
    : `/api/tutor/lessons/${lessonId}/questions`
  const res = await fetch(url, {
    method: q.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: q.question,
      imageUrl: q.imageUrl ?? null,
      mediaType: q.mediaType ?? null,
      type: q.type,
      options: q.options.map((o) => ({
        id: o.id, text: o.text, imageUrl: o.imageUrl ?? null, mediaType: o.mediaType ?? null, isCorrect: o.isCorrect,
      })),
    }),
  })
  const data = await res.json().catch(() => ({})) as { question?: SavedQuestion; message?: string }
  if (!res.ok || !data.question) throw new Error(data.message ?? "Could not save this question")
  return data.question
}

/** The draft once saved. Options come back in the order they were sent — their ids are kept for the next edit. */
export function withSaved(draft: QuestionDraft, saved: SavedQuestion): QuestionDraft {
  return {
    ...draft,
    id: saved.id,
    options: draft.options.map((o, i) => ({ ...o, id: saved.options[i]?.id ?? o.id })),
    isSaving: false, isOpen: false, dirty: false, error: null,
  }
}

// Images are converted to WebP by the server; a video goes straight to storage
// like a lesson video does, so a signed clip can be the question or an answer.
async function uploadMedia(file: File): Promise<{ url: string; mediaType: "image" | "video" }> {
  const { fileUrl } = await uploadFile(file)
  return { url: fileUrl, mediaType: file.type.startsWith("video/") ? "video" : "image" }
}

// ─── MediaUploadButton ────────────────────────────────────────────────────────

function MediaUploadButton({
  mediaUrl,
  mediaType,
  uploading,
  onUpload,
  onRemove,
  size = "option",
  acceptVideo = false,
}: {
  mediaUrl?: string
  mediaType?: "image" | "video"
  uploading?: boolean
  onUpload: (file: File) => void
  onRemove: () => void
  size?: "option" | "question"
  acceptVideo?: boolean
}) {
  const accept = acceptVideo
    ? "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
    : "image/jpeg,image/png,image/webp"

  if (mediaUrl) {
    return (
      <div className={cn(
        "relative rounded-lg overflow-hidden border bg-muted group",
        size === "question" ? "w-full max-w-xs aspect-video" : "size-16 shrink-0"
      )}>
        {isVideoMedia(mediaUrl, mediaType)
          ? <ProtectedVideo src={mediaUrl} className="w-full h-full object-cover" muted controls={size === "question"} />
          : <img src={mediaUrl} alt="" className="w-full h-full object-cover" />}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove image or video"
          title="Remove"
          // Always shown where there is no hover (phones, tablets).
          className="absolute top-1 right-1 size-6 rounded-full bg-black/60 text-white flex items-center justify-center transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <label title={acceptVideo ? "Add image or video" : "Add image"} className={cn(
      "relative flex flex-col items-center justify-center rounded-lg border border-dashed cursor-pointer hover:bg-muted/50 transition-colors text-muted-foreground focus-within:ring-2 focus-within:ring-ring",
      size === "question" ? "w-full max-w-xs aspect-video gap-1.5" : "size-16 gap-1 shrink-0",
      uploading && "opacity-50 pointer-events-none"
    )}>
      {uploading
        ? <Loader2 className={cn("animate-spin", size === "question" ? "size-6" : "size-4")} />
        : acceptVideo
          ? <VideoIcon className={size === "question" ? "size-6" : "size-4"} />
          : <ImageIcon className={size === "question" ? "size-6" : "size-4"} />}
      {size === "question" && <span className="text-xs">{acceptVideo ? "Add image / video" : "Add image"}</span>}
      <input
        type="file"
        accept={accept}
        aria-label={acceptVideo ? "Add image or video" : "Add image"}
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = "" }}
      />
    </label>
  )
}

// ─── QuestionCard ─────────────────────────────────────────────────────────────

function QuestionCard({
  q,
  index,
  lessonId,
  onPatch,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: {
  q: QuestionDraft
  index: number
  lessonId: string | null
  /** Change this question, starting from what it is at that moment. */
  onPatch: (change: (current: QuestionDraft) => QuestionDraft) => void
  onDelete: () => void
  onDuplicate: () => void
  /** Swap with the question above / below; undefined at the ends. */
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  /** A change to what the question says — as opposed to opening it or a save in progress. */
  function edit(change: (current: QuestionDraft) => QuestionDraft) {
    onPatch((cur) => ({ ...change(cur), dirty: true, error: null }))
  }

  function setOption(i: number, patch: Partial<QuizOptionDraft>) {
    edit((cur) => ({ ...cur, options: cur.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) }))
  }

  function setCorrect(i: number) {
    edit((cur) => ({ ...cur, options: cur.options.map((o, idx) => ({ ...o, isCorrect: idx === i })) }))
  }

  function addOption() {
    edit((cur) => ({ ...cur, options: [...cur.options, { text: "", isCorrect: false }] }))
  }

  function removeOption(i: number) {
    edit((cur) => (cur.options.length <= 2 ? cur : { ...cur, options: cur.options.filter((_, idx) => idx !== i) }))
  }

  async function handleQuestionMedia(file: File) {
    onPatch((cur) => ({ ...cur, questionImageUploading: true, error: null }))
    try {
      const { url, mediaType } = await uploadMedia(file)
      onPatch((cur) => ({ ...cur, imageUrl: url, mediaType, questionImageUploading: false, dirty: true }))
    } catch (e) {
      const error = e instanceof Error ? e.message : "Upload failed"
      onPatch((cur) => ({ ...cur, questionImageUploading: false, error }))
    }
  }

  async function handleOptionMedia(i: number, file: File) {
    // The option is tagged so it can be found again when the upload ends, even
    // if another option was removed while it ran.
    const uploadId = crypto.randomUUID()
    const finish = (patch: Partial<QuizOptionDraft>, error?: string) =>
      onPatch((cur) => ({
        ...cur,
        options: cur.options.map((o) =>
          o.uploadId === uploadId ? { ...o, ...patch, uploading: false, uploadId: undefined } : o
        ),
        ...(error ? { error } : { dirty: true }),
      }))

    onPatch((cur) => ({
      ...cur,
      error: null,
      options: cur.options.map((o, idx) => (idx === i ? { ...o, uploading: true, uploadId } : o)),
    }))
    try {
      const { url, mediaType } = await uploadMedia(file)
      finish({ imageUrl: url, mediaType })
    } catch (e) {
      finish({}, e instanceof Error ? e.message : "Upload failed")
    }
  }

  async function saveQuestion() {
    if (!lessonId) return
    const fail = (error: string) => onPatch((cur) => ({ ...cur, isSaving: false, error }))
    const problem = questionProblem(q)
    if (problem) return fail(problem)

    onPatch((cur) => ({ ...cur, isSaving: true, error: null }))
    try {
      const saved = await saveQuestionDraft(lessonId, q)
      onPatch((cur) => withSaved(cur, saved))
    } catch (e) {
      fail(e instanceof Error ? e.message : "Failed to save")
    }
  }

  async function deleteQuestion() {
    if (!lessonId || !q.id) {
      if (!isBlankQuestion(q) && !window.confirm("Delete this question?")) return
      onDelete()
      return
    }
    if (!window.confirm("Delete this question? Answers students have already given to it are removed too.")) return
    onPatch((cur) => ({ ...cur, isSaving: true, error: null }))
    try {
      const res = await fetch(`/api/tutor/lessons/${lessonId}/questions/${q.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not delete this question")
      onDelete()
    } catch (e) {
      const error = e instanceof Error ? e.message : "Could not delete this question"
      onPatch((cur) => ({ ...cur, isSaving: false, isOpen: true, error }))
    }
  }

  const correct = q.options.find((o) => o.isCorrect)
  const correctLabel = correct && (correct.text.trim() || `Answer ${q.options.indexOf(correct) + 1}`)
  // On a test that is not created yet everything is saved together, so there is no per-question state to show.
  const status = !lessonId ? null : q.id && !q.dirty ? "saved" : q.id ? "changed" : "new"

  return (
    <div className={cn(
      "rounded-xl border bg-background",
      q.isOpen ? "shadow-sm ring-1 ring-primary/20" : "shadow-none",
      q.error && "border-destructive/50"
    )}>
      {/* Card header */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
        <div className="flex flex-col shrink-0">
          <button type="button" title="Move up" aria-label={`Move question ${index + 1} up`} disabled={!onMoveUp} onClick={onMoveUp}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none">
            <ArrowUp className="size-4" />
          </button>
          <button type="button" title="Move down" aria-label={`Move question ${index + 1} down`} disabled={!onMoveDown} onClick={onMoveDown}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none">
            <ArrowDown className="size-4" />
          </button>
        </div>
        {/* The whole title area opens and closes the question. */}
        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          aria-expanded={q.isOpen}
          onClick={() => onPatch((cur) => ({ ...cur, isOpen: !cur.isOpen }))}
        >
          <p className={cn("text-sm font-medium truncate", !q.question.trim() && "text-muted-foreground")}>
            {index + 1}. {q.question.trim() || "New question"}
          </p>
          {!q.isOpen && (
            <p className="text-xs text-muted-foreground truncate">
              {q.type === "TRUE_FALSE" ? "True / False" : `${q.options.length} answers`}
              {correctLabel ? ` · Correct: ${correctLabel}` : " · No correct answer chosen"}
            </p>
          )}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {status === "saved" && (
            <Badge variant="outline" className="hidden sm:inline-flex text-[10px] text-emerald-700 border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="size-3 mr-1" /> Saved
            </Badge>
          )}
          {status && status !== "saved" && (
            <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200 bg-amber-50">
              {status === "new" ? "Not saved" : "Unsaved changes"}
            </Badge>
          )}
          <Button type="button" variant="ghost" size="icon" className="size-8"
            title="Duplicate question" aria-label={`Duplicate question ${index + 1}`}
            onClick={onDuplicate}>
            <Copy className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon"
            className="size-8 text-destructive hover:text-destructive"
            title="Delete question" aria-label={`Delete question ${index + 1}`}
            onClick={deleteQuestion} disabled={q.isSaving}>
            <Trash2 className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8"
            aria-label={q.isOpen ? "Close question" : "Open question"}
            onClick={() => onPatch((cur) => ({ ...cur, isOpen: !cur.isOpen }))}>
            {q.isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>
      </div>

      {!q.isOpen && q.error && <p className="px-4 pb-3 text-xs text-destructive">{q.error}</p>}

      {q.isOpen && (
        <div className="px-4 pb-4 flex flex-col gap-4 border-t pt-4">
          {/* Question text */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" htmlFor={`question-${q.uid}`}>Question</Label>
            <Textarea
              id={`question-${q.uid}`}
              rows={2}
              className="min-h-10"
              placeholder="e.g. What does this BSL sign mean?"
              value={q.question}
              // A question just added is ready to type into.
              autoFocus={!q.id && !q.question}
              onChange={(e) => edit((cur) => ({ ...cur, question: e.target.value }))}
            />
          </div>

          {/* Optional question image or video */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              Question image or video <span className="font-normal">(optional — e.g. a BSL sign to identify)</span>
            </Label>
            <MediaUploadButton
              mediaUrl={q.imageUrl}
              mediaType={q.mediaType}
              uploading={q.questionImageUploading}
              onUpload={handleQuestionMedia}
              onRemove={() => edit((cur) => ({ ...cur, imageUrl: undefined, mediaType: undefined }))}
              size="question"
              acceptVideo
            />
          </div>

          {/* Options */}
          <div className="flex flex-col gap-2">
            <div>
              <Label className="text-xs">{q.type === "TRUE_FALSE" ? "Correct answer" : "Answers"}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {q.type === "TRUE_FALSE"
                  ? "Tick the one that is correct."
                  : "Give each answer text, an image or a video, then tick the one that is correct."}
              </p>
            </div>

            {q.options.map((opt, i) => (
              <div key={i} className={cn(
                "flex items-center gap-2 rounded-xl border p-2",
                opt.isCorrect ? "border-emerald-300 bg-emerald-50/50" : "border-border bg-background"
              )}>
                {/* Correct marker */}
                <button
                  type="button"
                  aria-pressed={opt.isCorrect}
                  aria-label={`Answer ${i + 1} is the correct answer`}
                  title={opt.isCorrect ? "The correct answer" : "Mark as the correct answer"}
                  onClick={() => setCorrect(i)}
                  className="shrink-0 p-1.5 -m-1 rounded-full"
                >
                  {opt.isCorrect
                    ? <CheckCircle2 className="size-6 text-emerald-500" />
                    : <Circle className="size-6 text-muted-foreground" />}
                </button>

                {/* Media slot for option (image or video) */}
                {q.type !== "TRUE_FALSE" && (
                  <MediaUploadButton
                    mediaUrl={opt.imageUrl}
                    mediaType={opt.mediaType}
                    uploading={opt.uploading}
                    onUpload={(f) => handleOptionMedia(i, f)}
                    onRemove={() => setOption(i, { imageUrl: undefined, mediaType: undefined })}
                    size="option"
                    acceptVideo
                  />
                )}

                {/* Text */}
                <Input
                  className="flex-1 min-w-0"
                  aria-label={`Answer ${i + 1}`}
                  placeholder={opt.imageUrl ? "Caption (optional)" : `Answer ${i + 1}`}
                  value={opt.text}
                  disabled={q.type === "TRUE_FALSE"}
                  onChange={(e) => setOption(i, { text: e.target.value })}
                />

                {/* Remove option */}
                {q.type === "MULTIPLE_CHOICE" && q.options.length > 2 && (
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
                    title="Remove answer" aria-label={`Remove answer ${i + 1}`}
                    onClick={() => removeOption(i)}>
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}

            {q.type === "MULTIPLE_CHOICE" && q.options.length < 6 && (
              <Button type="button" variant="outline" size="sm" className="self-start mt-1" onClick={addOption}>
                <Plus className="size-3.5 mr-1" /> Add answer
              </Button>
            )}
          </div>

          {q.error && <p className="text-xs text-destructive">{q.error}</p>}

          {lessonId && (
            <Button type="button" size="sm" className="self-start" onClick={saveQuestion} disabled={q.isSaving}>
              {q.isSaving
                ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving…</>
                : <><Save className="size-3.5 mr-1.5" /> {q.id ? "Update" : "Save"} question</>}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── QuizBuilder ──────────────────────────────────────────────────────────────

export function QuizBuilder({ lessonId, questions, onChange }: Props) {
  const [orderError, setOrderError] = useState<string | null>(null)

  function add(type: "MULTIPLE_CHOICE" | "TRUE_FALSE") {
    onChange((current) => [...current, type === "TRUE_FALSE" ? blankTrueFalse() : blankMultiple()])
  }

  // A copy to change, for questions that only differ by a sign or a word. It is
  // a new question: no ids, so saving it never touches the original.
  function duplicate(uid: string) {
    onChange((current) => {
      const at = current.findIndex((q) => q.uid === uid)
      if (at < 0) return current
      const source = current[at]
      const copy: QuestionDraft = {
        ...source,
        uid: crypto.randomUUID(),
        id: undefined,
        options: source.options.map((o) => ({ ...o, id: undefined, uploading: false, uploadId: undefined })),
        isOpen: true, isSaving: false, error: null, dirty: true, questionImageUploading: false,
      }
      // On a saved test a new question is stored after the others, so it is shown there.
      return lessonId ? [...current, copy] : [...current.slice(0, at + 1), copy, ...current.slice(at + 1)]
    })
  }

  // On a saved test a new question goes to the end when it is saved, so it can
  // only be moved once it has been.
  const movable = (a: number, b: number) => !lessonId || (!!questions[a].id && !!questions[b].id)

  const swap = (a: string, b: string) => onChange((current) => {
    const from = current.findIndex((q) => q.uid === a)
    const to = current.findIndex((q) => q.uid === b)
    if (from < 0 || to < 0) return current
    const next = [...current]
    ;[next[from], next[to]] = [next[to], next[from]]
    return next
  })

  // Swap two questions. On a saved test the new order is stored straight away.
  async function move(from: number, to: number) {
    const a = questions[from].uid
    const b = questions[to].uid
    swap(a, b)
    setOrderError(null)

    const next = [...questions]
    ;[next[from], next[to]] = [next[to], next[from]]
    const orderedIds = next.flatMap((q) => (q.id ? [q.id] : []))
    if (!lessonId || orderedIds.length < 2) return
    try {
      const res = await fetch(`/api/tutor/lessons/${lessonId}/questions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      })
      if (!res.ok) throw new Error()
    } catch {
      swap(a, b)
      setOrderError("Could not save the new order. Please try again.")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-primary" />
        <h3 className="font-semibold text-sm">Test Questions</h3>
        <Badge variant="outline" className="text-[10px]">
          {questions.length} question{questions.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {questions.length === 0 && (
        <div className="rounded-xl border border-dashed py-10 flex flex-col items-center gap-2 text-center">
          <FlaskConical className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No questions yet. Add the first one below.</p>
        </div>
      )}

      {questions.map((q, i) => (
        <QuestionCard
          key={q.uid}
          q={q}
          index={i}
          lessonId={lessonId}
          onPatch={(change) => onChange((current) => current.map((old) => (old.uid === q.uid ? change(old) : old)))}
          onDelete={() => onChange((current) => current.filter((old) => old.uid !== q.uid))}
          onDuplicate={() => duplicate(q.uid)}
          onMoveUp={i > 0 && movable(i, i - 1) ? () => move(i, i - 1) : undefined}
          onMoveDown={i < questions.length - 1 && movable(i, i + 1) ? () => move(i, i + 1) : undefined}
        />
      ))}

      {orderError && <p className="text-xs text-destructive">{orderError}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Add a question:</span>
        <Button type="button" variant="outline" size="sm" onClick={() => add("MULTIPLE_CHOICE")}>
          <Plus className="size-3.5 mr-1.5" /> Multiple choice
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => add("TRUE_FALSE")}>
          <Plus className="size-3.5 mr-1.5" /> True / False
        </Button>
      </div>

      {!lessonId && questions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          The questions are saved with the test when you press Add Test.
        </p>
      )}
    </div>
  )
}
