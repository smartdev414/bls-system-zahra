"use client"

import { useState } from "react"
import {
  Plus, Trash2, CheckCircle2, Circle, ArrowUp, ArrowDown,
  ChevronDown, ChevronUp, Loader2, Save, FlaskConical,
  ImageIcon, X, VideoIcon, Copy, Library, Camera, Sparkles, Undo2, ListPlus, PenLine, Play,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { DEFAULT_WRITTEN_MARKS, MAX_WRITTEN_MARKS, isAssessment, isPresentation, isSelfMarked, isSignTest, isVideoMedia, marksLabel, maxMarks } from "@/lib/quiz"
import { uploadFile } from "@/lib/upload-file"
import { DictionaryPicker, type DictionarySign } from "@/components/tests/DictionaryPicker"
import { FilmOverlay } from "./FilmOverlay"

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

/**
 * Multiple choice and true / false are marked by the server. A written answer
 * (0-3 marks) and a signed one (tick or cross) are marked by the student
 * against the model answer once they submit.
 */
export type QuestionKind = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "WRITTEN" | "SIGN"

export type QuestionDraft = {
  /** Identifies the draft in the list while it is edited; any unique string. */
  uid: string
  id?: string
  question: string
  imageUrl?: string   // image or video url
  mediaType?: "image" | "video"
  /** Students may pause and rewind this question's videos during the test. */
  videoControls?: boolean
  /** The question and answers appear only once the question's video has ended. */
  questionAfterVideo?: boolean
  type: QuestionKind
  /** WRITTEN: what a full-marks answer says — students compare theirs with it. */
  modelAnswer?: string
  /** WRITTEN: what it is worth; students see "(2 marks)" after the question. */
  maxMarks?: number
  /** SIGN: the video of the sign done right, shown next to the student's own. */
  answerVideoUrl?: string
  answerVideoUploading?: boolean
  /** An assessment's part: its questions, signed. */
  questionsVideoUrl?: string
  options: QuizOptionDraft[]
  isOpen: boolean
  isSaving: boolean
  error: string | null
  /** Changed since it was last saved (or never saved). */
  dirty?: boolean
  questionImageUploading?: boolean
}

type Props = {
  /** The saved test; null while it is being made, when everything is saved together. */
  testId: string | null
  questions: QuestionDraft[]
  /**
   * Takes the new list or, like a state setter, a function of the current one.
   * Uploads and saves finish some time after they start, and must be applied to
   * the list as it is then — not as it was when they began — or whatever the
   * admin typed or added in the meantime is thrown away.
   */
  onChange: (next: QuestionDraft[] | ((current: QuestionDraft[]) => QuestionDraft[])) => void
  /** Opens the dictionary to make questions from its signs. */
  onAddFromDictionary?: () => void
  /** Offer written answers, which students mark themselves. Tests only. */
  selfMarked?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function blankMultiple(): QuestionDraft {
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

/** A written or signed answer: no options — the model answer is what students compare against. */
function blankSelfMarked(type: "WRITTEN" | "SIGN"): QuestionDraft {
  return {
    uid: crypto.randomUUID(), question: "", type, options: [], isOpen: true, isSaving: false, error: null,
    ...(type === "WRITTEN" && { maxMarks: DEFAULT_WRITTEN_MARKS }),
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
  if (q.id || q.question.trim() || q.imageUrl || q.questionImageUploading || q.questionsVideoUrl) return false
  if (isSelfMarked(q.type)) return !q.modelAnswer?.trim() && !q.answerVideoUrl && !q.answerVideoUploading
  return q.type === "TRUE_FALSE" || q.options.every((o) => !o.text.trim() && !o.imageUrl && !o.uploading)
}

/** What still has to be done before a question can be saved, or null when it is ready. */
export function questionProblem(q: QuestionDraft, testKind?: string): string | null {
  // A presentation's task: written out, or signed on video.
  if (isPresentation(testKind)) {
    if (q.questionImageUploading) return "Wait for the upload to finish"
    return q.question.trim() || q.imageUrl ? null : "Type the task, or add a video of you signing it"
  }
  // A part of an assessment: its questions, the part, and the answer sheet.
  if (isAssessment(testKind)) {
    if (!q.questionsVideoUrl && !q.question.trim()) return "Add the video of the part's questions"
    if (!q.imageUrl) return "Add the video of the part"
    return q.modelAnswer?.trim() ? null : "Type the answer sheet"
  }
  // A sign in a fingerspelling or vocabulary test is a video and its word. The
  // word can be kept before it is filmed; students get it once it has its video.
  if (isSignTest(testKind)) {
    if (q.questionImageUploading) return "Wait for the upload to finish"
    return q.question.trim() ? null : "Type the word"
  }
  if (q.questionImageUploading || q.answerVideoUploading) return "Wait for the upload to finish"
  // A question signed on video needs no typed text.
  if (!q.question.trim() && !isVideoMedia(q.imageUrl, q.mediaType)) return "Type the question, or add a video of you signing it"
  if (q.type === "WRITTEN") return q.modelAnswer?.trim() ? null : "Type the model answer"
  if (q.type === "SIGN") return q.answerVideoUrl ? null : "Add the video of the sign done right"
  if (q.options.some((o) => !o.text.trim() && !o.imageUrl)) return "Each answer needs text, an image or a video"
  if (!q.options.some((o) => o.isCorrect)) return "Choose which answer is correct"
  if (q.options.every((o) => o.isCorrect)) return "At least one answer must be wrong"
  if (q.questionImageUploading || q.options.some((o) => o.uploading)) return "Wait for the upload to finish"
  return null
}

type SavedQuestion = { id: string; options: Array<{ id: string }> }

/** Creates the question on the test, or updates it when it was saved before. */
export async function saveQuestionDraft(testId: string, q: QuestionDraft): Promise<SavedQuestion> {
  const url = q.id
    ? `/api/tests/${testId}/questions/${q.id}`
    : `/api/tests/${testId}/questions`
  const res = await fetch(url, {
    method: q.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: q.question,
      imageUrl: q.imageUrl ?? null,
      mediaType: q.mediaType ?? null,
      videoControls: !!q.videoControls,
      questionAfterVideo: !!q.questionAfterVideo,
      type: q.type,
      modelAnswer: q.type === "WRITTEN" ? q.modelAnswer ?? null : null,
      maxMarks: q.type === "WRITTEN" ? maxMarks(q) : null,
      answerVideoUrl: q.type === "SIGN" ? q.answerVideoUrl ?? null : null,
      questionsVideoUrl: q.questionsVideoUrl ?? null,
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
export async function uploadMedia(file: File): Promise<{ url: string; mediaType: "image" | "video" }> {
  const { fileUrl } = await uploadFile(file)
  return { url: fileUrl, mediaType: file.type.startsWith("video/") ? "video" : "image" }
}

// ─── MediaUploadButton ────────────────────────────────────────────────────────

export function MediaUploadButton({
  mediaUrl,
  mediaType,
  uploading,
  onUpload,
  onRemove,
  size = "option",
  acceptVideo = false,
  videoOnly = false,
}: {
  mediaUrl?: string
  mediaType?: "image" | "video"
  uploading?: boolean
  onUpload: (file: File) => void
  onRemove: () => void
  size?: "option" | "question"
  acceptVideo?: boolean
  /** For a slot that only makes sense as a clip, such as a test's story. */
  videoOnly?: boolean
}) {
  const label = videoOnly ? "Add video" : acceptVideo ? "Add image or video" : "Add image"
  const accept = videoOnly
    ? "video/mp4,video/webm,video/quicktime"
    : acceptVideo
    ? "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
    : "image/jpeg,image/png,image/webp"

  const [playing, setPlaying] = useState(false)

  if (mediaUrl) {
    const isVideo = isVideoMedia(mediaUrl, mediaType)
    return (
      <div className={cn(
        "relative rounded-lg overflow-hidden border bg-muted group",
        size === "question" ? "w-full max-w-xs aspect-video" : "size-16 shrink-0"
      )}>
        {isVideo
          ? <ProtectedVideo src={mediaUrl} className="w-full h-full object-cover" muted controls={size === "question"} />
          : <img src={mediaUrl} alt="" className="w-full h-full object-cover" />}
        {/* An answer's thumbnail is too small for controls: tap it to watch the clip full size. */}
        {isVideo && size === "option" && (
          <>
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label="Play video"
              title="Play video"
              className="absolute inset-0 flex items-center justify-center bg-black/10 hover:bg-black/25 transition-colors"
            >
              <span className="size-7 rounded-full bg-black/60 text-white flex items-center justify-center">
                <Play className="size-3.5 fill-current ml-0.5" />
              </span>
            </button>
            <Dialog open={playing} onOpenChange={setPlaying}>
              <DialogContent className="sm:max-w-2xl p-3">
                <DialogTitle className="sr-only">Answer video</DialogTitle>
                {playing && <ProtectedVideo src={mediaUrl} className="w-full max-h-[75vh] rounded-lg bg-black" controls autoPlay playsInline />}
              </DialogContent>
            </Dialog>
          </>
        )}
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
    <label title={label} className={cn(
      "relative flex flex-col items-center justify-center rounded-lg border border-dashed cursor-pointer hover:bg-muted/50 transition-colors text-muted-foreground focus-within:ring-2 focus-within:ring-ring",
      size === "question" ? "w-full max-w-xs aspect-video gap-1.5" : "size-16 gap-1 shrink-0",
      uploading && "opacity-50 pointer-events-none"
    )}>
      {uploading
        ? <Loader2 className={cn("animate-spin", size === "question" ? "size-6" : "size-4")} />
        : acceptVideo || videoOnly
          ? <VideoIcon className={size === "question" ? "size-6" : "size-4"} />
          : <ImageIcon className={size === "question" ? "size-6" : "size-4"} />}
      {size === "question" && <span className="text-xs">{videoOnly ? "Add video" : acceptVideo ? "Add image / video" : "Add image"}</span>}
      <input
        type="file"
        accept={accept}
        aria-label={label}
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
  testId,
  onPatch,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onChooseSign,
}: {
  q: QuestionDraft
  index: number
  testId: string | null
  /** Change this question, starting from what it is at that moment. */
  onPatch: (change: (current: QuestionDraft) => QuestionDraft) => void
  onDelete: () => void
  onDuplicate: () => void
  /** Swap with the question above / below; undefined at the ends. */
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** Use a dictionary sign as the question's clip (no option), an answer's, or — "model" — a signed answer's model video. */
  onChooseSign?: (option?: number | "model") => void
}) {
  /** A change to what the question says — as opposed to opening it or a save in progress. */
  function edit(change: (current: QuestionDraft) => QuestionDraft) {
    onPatch((cur) => ({ ...change(cur), dirty: true, error: null }))
  }

  function setOption(i: number, patch: Partial<QuizOptionDraft>) {
    edit((cur) => ({ ...cur, options: cur.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) }))
  }

  // True / false has one right answer. In multiple choice each answer is
  // ticked on or off, so more than one can be correct.
  function toggleCorrect(i: number) {
    edit((cur) => ({
      ...cur,
      options: cur.options.map((o, idx) =>
        cur.type === "TRUE_FALSE" ? { ...o, isCorrect: idx === i } : idx === i ? { ...o, isCorrect: !o.isCorrect } : o
      ),
    }))
  }

  // ── Fix English ──
  const [fixing, setFixing] = useState(false)
  // What the question said before the last correction, for Undo.
  const [beforeFix, setBeforeFix] = useState<{ question: string; answers: string[] } | null>(null)
  // A written question's model answer is checked as its one answer.
  const answerTexts = (cur: QuestionDraft) => (cur.type === "WRITTEN" ? [cur.modelAnswer ?? ""] : cur.options.map((o) => o.text))
  const hasText = !!q.question.trim() || answerTexts(q).some((t) => t.trim())

  async function fixEnglish() {
    const sent = { question: q.question, answers: answerTexts(q) }
    setFixing(true)
    try {
      const res = await fetch("/api/tests/questions/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent),
      })
      const data = await res.json().catch(() => ({})) as {
        available?: boolean; failed?: boolean; message?: string
        corrected?: { question: string; answers: string[] } | null
      }
      if (!res.ok) throw new Error(data.message ?? "Could not check the English")
      if (data.available === false) return void toast.error("English checking is not set up")
      if (data.failed) return void toast.error("Could not check the English just now. Try again.")
      if (!data.corrected) return void toast.success("The English looks right")
      const fixed = data.corrected
      // Only lines still as they were sent are replaced — anything typed while
      // the check ran is kept.
      edit((cur) => ({
        ...cur,
        question: cur.question === sent.question ? fixed.question : cur.question,
        ...(cur.type === "WRITTEN"
          ? { modelAnswer: (cur.modelAnswer ?? "") === sent.answers[0] ? fixed.answers[0] ?? cur.modelAnswer : cur.modelAnswer }
          : { options: cur.options.map((o, i) => (o.text === sent.answers[i] ? { ...o, text: fixed.answers[i] ?? o.text } : o)) }),
      }))
      setBeforeFix(sent)
    } catch (e) {
      toast.error(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Could not check the English")
    } finally {
      setFixing(false)
    }
  }

  function undoFix() {
    const before = beforeFix
    if (!before) return
    edit((cur) => ({
      ...cur,
      question: before.question,
      ...(cur.type === "WRITTEN"
        ? { modelAnswer: before.answers[0] }
        : { options: cur.options.map((o, i) => (i < before.answers.length ? { ...o, text: before.answers[i] } : o)) }),
    }))
    setBeforeFix(null)
  }

  // ── Film with the camera ── which slot the clip is for: the question (undefined) or an answer.
  // The recorder shows what is being filmed, so it is named by its text where it has some.
  // A list of answers films them one after another in one sitting; it is fixed when the recorder opens.
  const [filming, setFilming] = useState<{ option?: number | "model" | number[] } | null>(null)
  const answerItem = (i: number) => ({ id: String(i), word: q.options[i]?.text.trim() || `Answer ${i + 1}` })
  const unfilmedAnswers = q.type === "TRUE_FALSE" || isSelfMarked(q.type)
    ? []
    : q.options.flatMap((o, i) => (o.imageUrl || o.uploading ? [] : [i]))
  const filmingItems = filming && (filming.option === undefined
    ? [{ id: "question", word: q.question.trim() || `Question ${index + 1}` }]
    : filming.option === "model"
    ? [{ id: "model", word: q.question.trim() || `Question ${index + 1}` }]
    : Array.isArray(filming.option)
    ? filming.option.map(answerItem)
    : [answerItem(filming.option)])

  function applyFilmed(id: string, fileUrl: string) {
    const media = { imageUrl: fileUrl, mediaType: "video" as const }
    if (id === "question") edit((cur) => ({ ...cur, ...media }))
    else if (id === "model") edit((cur) => ({ ...cur, answerVideoUrl: fileUrl }))
    else setOption(Number(id), media)
  }

  async function handleModelVideo(file: File) {
    onPatch((cur) => ({ ...cur, answerVideoUploading: true, error: null }))
    try {
      const { url } = await uploadMedia(file)
      onPatch((cur) => ({ ...cur, answerVideoUrl: url, answerVideoUploading: false, dirty: true }))
    } catch (e) {
      const error = e instanceof Error ? e.message : "Upload failed"
      onPatch((cur) => ({ ...cur, answerVideoUploading: false, error }))
    }
  }

  function addOption() {
    edit((cur) => ({ ...cur, options: [...cur.options, { text: "", isCorrect: false }] }))
  }

  /** A copy sits right below the original — same text and media, not ticked — ready to tweak. */
  function duplicateOption(i: number) {
    edit((cur) => {
      if (cur.options.length >= 6) return cur
      const { text, imageUrl, mediaType } = cur.options[i]
      const options = [...cur.options]
      options.splice(i + 1, 0, { text, imageUrl, mediaType, isCorrect: false })
      return { ...cur, options }
    })
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
    if (!testId) return
    const fail = (error: string) => onPatch((cur) => ({ ...cur, isSaving: false, error }))
    const problem = questionProblem(q)
    if (problem) return fail(problem)

    onPatch((cur) => ({ ...cur, isSaving: true, error: null }))
    try {
      const saved = await saveQuestionDraft(testId, q)
      onPatch((cur) => withSaved(cur, saved))
    } catch (e) {
      fail(e instanceof Error ? e.message : "Failed to save")
    }
  }

  async function deleteQuestion() {
    if (!testId || !q.id) {
      if (!isBlankQuestion(q) && !window.confirm("Delete this question?")) return
      onDelete()
      return
    }
    if (!window.confirm("Delete this question? Answers students have already given to it are removed too.")) return
    onPatch((cur) => ({ ...cur, isSaving: true, error: null }))
    try {
      const res = await fetch(`/api/tests/${testId}/questions/${q.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not delete this question")
      onDelete()
    } catch (e) {
      const error = e instanceof Error ? e.message : "Could not delete this question"
      onPatch((cur) => ({ ...cur, isSaving: false, isOpen: true, error }))
    }
  }

  const correctLabel = q.options
    .flatMap((o, i) => (o.isCorrect ? [o.text.trim() || `Answer ${i + 1}`] : []))
    .join(", ")
  const multipleCorrect = q.type === "MULTIPLE_CHOICE" && q.options.filter((o) => o.isCorrect).length > 1
  const questionVideo = isVideoMedia(q.imageUrl, q.mediaType)
  const hasVideo = questionVideo || q.options.some((o) => isVideoMedia(o.imageUrl, o.mediaType))
  // On a test that is not created yet everything is saved together, so there is no per-question state to show.
  const status = !testId ? null : q.id && !q.dirty ? "saved" : q.id ? "changed" : "new"

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
              {q.type === "WRITTEN"
                ? `Written answer · ${marksLabel(maxMarks(q))}${q.modelAnswer?.trim() ? ` · Model answer: ${q.modelAnswer.trim()}` : " · No model answer yet"}`
                : q.type === "SIGN"
                ? `Signed answer · tick or cross${q.answerVideoUrl ? "" : " · No video of the sign yet"}`
                : <>
                    {q.type === "TRUE_FALSE" ? "True / False" : `${q.options.length} answers`}
                    {correctLabel ? ` · Correct: ${correctLabel}` : " · No correct answer chosen"}
                  </>}
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
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs" htmlFor={`question-${q.uid}`}>Question</Label>
              <div className="flex items-center gap-1">
                {beforeFix && !fixing && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={undoFix}>
                    <Undo2 className="size-3.5 mr-1" /> Undo
                  </Button>
                )}
                <Button
                  type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary"
                  title="Correct the spelling and grammar of the question and its answers"
                  disabled={!hasText || fixing}
                  onClick={fixEnglish}
                >
                  {fixing ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Sparkles className="size-3.5 mr-1" />}
                  Fix English
                </Button>
              </div>
            </div>
            <Textarea
              id={`question-${q.uid}`}
              rows={2}
              className="min-h-10"
              placeholder={isVideoMedia(q.imageUrl, q.mediaType)
                ? "Optional — your video asks the question"
                : q.type === "SIGN"
                ? "e.g. Sign the word: bus"
                : q.type === "WRITTEN"
                ? "e.g. Describe how BSL uses facial expression"
                : "e.g. What does this BSL sign mean?"}
              value={q.question}
              // A question just added is ready to type into.
              autoFocus={!q.id && !q.question}
              onChange={(e) => { setBeforeFix(null); edit((cur) => ({ ...cur, question: e.target.value })) }}
            />
            {isVideoMedia(q.imageUrl, q.mediaType) && (
              <p className="text-xs text-muted-foreground">
                Students don&apos;t see this while they take the test — they watch your video. It shows in their results.
              </p>
            )}
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
            {!q.imageUrl && !q.questionImageUploading && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setFilming({})}>
                  <Camera className="size-3.5" /> Film with your camera
                </button>
                {onChooseSign && (
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => onChooseSign()}>
                    <Library className="size-3.5" /> Use a sign from the dictionary
                  </button>
                )}
              </div>
            )}
          </div>

          {q.type === "WRITTEN" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs" id={`marks-${q.uid}`}>Marks</Label>
              <div role="radiogroup" aria-labelledby={`marks-${q.uid}`} className="flex flex-wrap gap-1">
                {Array.from({ length: MAX_WRITTEN_MARKS }, (_, i) => i + 1).map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    role="radio"
                    aria-checked={maxMarks(q) === n}
                    variant={maxMarks(q) === n ? "default" : "outline"}
                    className="h-8 w-9 px-0"
                    onClick={() => edit((cur) => ({ ...cur, maxMarks: n }))}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Students see &ldquo;({marksLabel(maxMarks(q))})&rdquo; after the question.
              </p>
            </div>
          )}

          {q.type === "WRITTEN" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs" htmlFor={`model-${q.uid}`}>Model answer</Label>
              <Textarea
                id={`model-${q.uid}`}
                rows={3}
                placeholder="What a full-marks answer says"
                value={q.modelAnswer ?? ""}
                onChange={(e) => { setBeforeFix(null); edit((cur) => ({ ...cur, modelAnswer: e.target.value })) }}
              />
              <p className="text-xs text-muted-foreground">
                Students type their answer. After they submit, they see this and give themselves 0 to {maxMarks(q)} marks. You can change their marks in the results.
              </p>
            </div>
          )}

          {q.type === "SIGN" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">The sign done right</Label>
              <MediaUploadButton
                mediaUrl={q.answerVideoUrl}
                mediaType="video"
                uploading={q.answerVideoUploading}
                onUpload={handleModelVideo}
                onRemove={() => edit((cur) => ({ ...cur, answerVideoUrl: undefined }))}
                size="question"
                videoOnly
              />
              {!q.answerVideoUrl && !q.answerVideoUploading && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {onChooseSign && (
                    <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => onChooseSign("model")}>
                      <Library className="size-3.5" /> Use a sign from the dictionary
                    </button>
                  )}
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setFilming({ option: "model" })}>
                    <Camera className="size-3.5" /> Film with your camera
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Students film themselves signing. After they submit, this video plays next to theirs and they give themselves a tick or a cross. You can change it in the results. Their videos are deleted when the course is archived, or when a student leaves it.
              </p>
            </div>
          )}

          {/* Options */}
          {!isSelfMarked(q.type) && <div className="flex flex-col gap-2">
            <div>
              <Label className="text-xs">{q.type === "TRUE_FALSE" ? "Correct answer" : "Answers"}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {q.type === "TRUE_FALSE"
                  ? "Tick the one that is correct."
                  : "Give each answer text, an image or a video, then tick the correct one — or tick more than one if several are correct."}
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
                  aria-label={`Answer ${i + 1} is correct`}
                  title={opt.isCorrect ? "A correct answer — click to untick" : "Mark as correct"}
                  onClick={() => toggleCorrect(i)}
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
                {q.type !== "TRUE_FALSE" && onChooseSign && !opt.imageUrl && !opt.uploading && (
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground"
                    title="Use a sign from the dictionary" aria-label={`Use a sign from the dictionary for answer ${i + 1}`}
                    onClick={() => onChooseSign(i)}>
                    <Library className="size-3.5" />
                  </Button>
                )}
                {q.type !== "TRUE_FALSE" && !opt.imageUrl && !opt.uploading && (
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground"
                    title="Film with your camera" aria-label={`Film answer ${i + 1} with your camera`}
                    onClick={() => setFilming({ option: i })}>
                    <Camera className="size-3.5" />
                  </Button>
                )}

                {/* Text */}
                <Input
                  className="flex-1 min-w-0"
                  aria-label={`Answer ${i + 1}`}
                  placeholder={opt.imageUrl ? "Caption (optional)" : `Answer ${i + 1}`}
                  value={opt.text}
                  disabled={q.type === "TRUE_FALSE"}
                  onChange={(e) => { setBeforeFix(null); setOption(i, { text: e.target.value }) }}
                />

                {/* Duplicate option */}
                {q.type === "MULTIPLE_CHOICE" && q.options.length < 6 && !opt.uploading && (
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
                    title="Duplicate answer" aria-label={`Duplicate answer ${i + 1}`}
                    onClick={() => duplicateOption(i)}>
                    <Copy className="size-3.5 text-muted-foreground" />
                  </Button>
                )}

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

            {(unfilmedAnswers.length > 1 || (q.type === "MULTIPLE_CHOICE" && q.options.length < 6)) && (
              <div className="flex flex-wrap gap-2 mt-1">
                {q.type === "MULTIPLE_CHOICE" && q.options.length < 6 && (
                  <Button type="button" variant="outline" size="sm" onClick={addOption}>
                    <Plus className="size-3.5 mr-1" /> Add answer
                  </Button>
                )}
                {unfilmedAnswers.length > 1 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setFilming({ option: unfilmedAnswers })}
                    title="Film them one after another — each stops by itself when your hands come back to rest">
                    <Camera className="size-3.5 mr-1" /> Film all {unfilmedAnswers.length} answers
                  </Button>
                )}
              </div>
            )}
          </div>}

          {multipleCorrect && (
            <p className="text-xs text-muted-foreground">
              {q.options.filter((o) => o.isCorrect).length} answers are correct. Students tick all of them, and get the question right only if they tick exactly these.
            </p>
          )}

          {hasVideo && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={!!q.videoControls}
                onCheckedChange={(v) => edit((cur) => ({ ...cur, videoControls: v === true }))}
              />
              <span>
                Students can control the video
                <span className="block text-xs text-muted-foreground">
                  Pause, rewind and skip during the test. Untick to have it just play, over and over.
                </span>
              </span>
            </label>
          )}

          {questionVideo && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={!!q.questionAfterVideo}
                onCheckedChange={(v) => edit((cur) => ({ ...cur, questionAfterVideo: v === true }))}
              />
              <span>
                Show the question after the video
                <span className="block text-xs text-muted-foreground">
                  Students watch the video first; the question and answers appear when it ends.
                </span>
              </span>
            </label>
          )}

          {q.error && <p className="text-xs text-destructive">{q.error}</p>}

          {testId && (
            <Button type="button" size="sm" className="self-start" onClick={saveQuestion} disabled={q.isSaving}>
              {q.isSaving
                ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving…</>
                : <><Save className="size-3.5 mr-1.5" /> {q.id ? "Update" : "Save"} question</>}
            </Button>
          )}
        </div>
      )}

      <FilmOverlay items={filmingItems} onRecorded={applyFilmed} onClose={() => setFilming(null)} />
    </div>
  )
}

// ─── QuizBuilder ──────────────────────────────────────────────────────────────

export function QuizBuilder({ testId, questions, onChange, onAddFromDictionary, selfMarked }: Props) {
  const [orderError, setOrderError] = useState<string | null>(null)
  // Where a sign chosen in the dictionary goes: a question's clip, or one of its answers.
  const [signTarget, setSignTarget] = useState<{ uid: string; option?: number | "model" } | null>(null)
  // "Add questions": typed one per line, then filmed one after another.
  const [listOpen, setListOpen] = useState(false)
  const [listText, setListText] = useState("")
  const [filming, setFilming] = useState<{ id: string; word: string }[] | null>(null)
  const typedQuestions = listText.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)

  function addList() {
    const added = typedQuestions.map((text) => ({ ...blankMultiple(), question: text, dirty: true }))
    onChange((current) => [...current, ...added])
    setListText("")
    setListOpen(false)
    setFilming(added.map((q) => ({ id: q.uid, word: q.question })))
  }

  function applySign(sign: DictionarySign) {
    if (!signTarget) return
    const media = { imageUrl: (sign.videoUrl ?? sign.imageUrl)!, mediaType: (sign.videoUrl ? "video" : "image") as "video" | "image" }
    const { uid, option } = signTarget
    onChange((current) => current.map((q) => {
      if (q.uid !== uid) return q
      if (option === undefined) return { ...q, ...media, dirty: true, error: null }
      // A signed answer: the sign is the model, and names what to sign if nothing does yet.
      if (option === "model") {
        if (!sign.videoUrl) return { ...q, error: "This sign has no video yet" }
        return {
          ...q, answerVideoUrl: sign.videoUrl, dirty: true, error: null,
          question: q.question.trim() ? q.question : `Sign the word: ${sign.word}`,
        }
      }
      // The answer is named after the sign, unless it already has its own words.
      return {
        ...q, dirty: true, error: null,
        options: q.options.map((o, i) => (i === option ? { ...o, ...media, text: o.text.trim() ? o.text : sign.word } : o)),
      }
    }))
  }

  function add(type: QuestionKind) {
    const blank = type === "TRUE_FALSE" ? blankTrueFalse() : isSelfMarked(type) ? blankSelfMarked(type) : blankMultiple()
    onChange((current) => [...current, blank])
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
        isOpen: true, isSaving: false, error: null, dirty: true, questionImageUploading: false, answerVideoUploading: false,
      }
      // On a saved test a new question is stored after the others, so it is shown there.
      return testId ? [...current, copy] : [...current.slice(0, at + 1), copy, ...current.slice(at + 1)]
    })
  }

  // On a saved test a new question goes to the end when it is saved, so it can
  // only be moved once it has been.
  const movable = (a: number, b: number) => !testId || (!!questions[a].id && !!questions[b].id)

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
    if (!testId || orderedIds.length < 2) return
    try {
      const res = await fetch(`/api/tests/${testId}/questions`, {
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
          testId={testId}
          onPatch={(change) => onChange((current) => current.map((old) => (old.uid === q.uid ? change(old) : old)))}
          onDelete={() => onChange((current) => current.filter((old) => old.uid !== q.uid))}
          onDuplicate={() => duplicate(q.uid)}
          onMoveUp={i > 0 && movable(i, i - 1) ? () => move(i, i - 1) : undefined}
          onMoveDown={i < questions.length - 1 && movable(i, i + 1) ? () => move(i, i + 1) : undefined}
          onChooseSign={onAddFromDictionary ? (option) => setSignTarget({ uid: q.uid, option }) : undefined}
        />
      ))}

      <DictionaryPicker
        open={signTarget !== null}
        onOpenChange={(open) => { if (!open) setSignTarget(null) }}
        multiple={false}
        description={signTarget?.option === undefined
          ? "The sign's video is shown with the question."
          : signTarget.option === "model"
          ? "Students compare their own signing with this video."
          : "The sign's video becomes this answer."}
        onPick={([sign]) => { if (sign) applySign(sign) }}
      />

      {orderError && <p className="text-xs text-destructive">{orderError}</p>}

      {listOpen && (
        <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
          <label htmlFor="question-list" className="text-sm font-medium">Type the questions you will sign</label>
          <Textarea
            id="question-list"
            autoFocus
            rows={5}
            value={listText}
            onChange={(e) => setListText(e.target.value)}
            placeholder={"One question per line:\nWhat is this sign?\nWhich colour is this?"}
          />
          <p className="text-xs text-muted-foreground">
            Each question shows on screen while you film it. Recording stops by itself when your hands come back to rest, then the next one comes up. Add the answers afterwards.
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={!typedQuestions.length} onClick={addList}>
              <Camera className="size-4 mr-1.5" /> Start filming
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setListOpen(false); setListText("") }}>Cancel</Button>
          </div>
        </div>
      )}

      <FilmOverlay
        items={filming}
        onRecorded={(uid, fileUrl) => onChange((current) => current.map((q) => (
          q.uid === uid ? { ...q, imageUrl: fileUrl, mediaType: "video", dirty: true, error: null } : q
        )))}
        onClose={() => setFilming(null)}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Add a question:</span>
        <Button type="button" variant="outline" size="sm" onClick={() => add("MULTIPLE_CHOICE")}>
          <Plus className="size-3.5 mr-1.5" /> Multiple choice
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => add("TRUE_FALSE")}>
          <Plus className="size-3.5 mr-1.5" /> True / False
        </Button>
        {/* Signing a word is done in a vocabulary test now, word → sign. */}
        {selfMarked && (
          <Button type="button" variant="outline" size="sm" onClick={() => add("WRITTEN")}>
            <PenLine className="size-3.5 mr-1.5" /> Written answer
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => setListOpen(true)}>
          <ListPlus className="size-3.5 mr-1.5" /> Add and film several
        </Button>
        {onAddFromDictionary && (
          <Button type="button" variant="outline" size="sm" onClick={onAddFromDictionary}>
            <Library className="size-3.5 mr-1.5" /> From the dictionary
          </Button>
        )}
      </div>

      {!testId && questions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          The questions are saved with the test when you press Add Test.
        </p>
      )}
    </div>
  )
}
