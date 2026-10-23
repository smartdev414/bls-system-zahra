"use client"

import { useState } from "react"
import { Camera, FolderOpen, Hand, Library, ListPlus, Loader2, RefreshCw, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { LibraryPicker } from "@/components/library/LibraryPicker"
import { FilmOverlay } from "./FilmOverlay"
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
  /** Vocabulary, word → sign: nothing is picked, so any number of signs will do. */
  signOnly?: boolean
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
/** A pasted list — one word per line, or separated by commas — without repeats. */
function wordsFromList(text: string): string[] {
  const seen = new Set<string>()
  return text.split(/[\n,;]+/).map((w) => w.replace(/\s+/g, " ").trim()).filter((w) => {
    const key = w.toLowerCase()
    if (!w || w.length > 100 || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function newSign(word: string, videoUrl?: string, uploading = !videoUrl): QuestionDraft {
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
    questionImageUploading: uploading,
  }
}

export function SignListBuilder({ kind, testId, signs, onChange, onAddFromDictionary, signOnly }: Props) {
  // The words handed to the recorder while it is open, in the order to film them.
  const [filming, setFilming] = useState<{ id: string; word: string }[] | null>(null)
  // "Bulk add words", as in the dictionary: the words go in first, without
  // videos, and are filmed afterwards. Open from the start on an empty test.
  const [listOpen, setListOpen] = useState(signs.length === 0)
  const [listText, setListText] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  // Signs ticked to film together, filmed or not — a whole test can be re-recorded in one go.
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Words typed in but not filmed yet — what the recorder works through.
  const unfilmed = signs.filter((s) => !s.imageUrl && !s.questionImageUploading && s.question.trim())

  /** Opens the recorder on the words still without a video, from `first` on. */
  function film(list: QuestionDraft[], first?: string) {
    const start = Math.max(list.findIndex((s) => s.uid === first), 0)
    const ordered = [...list.slice(start), ...list.slice(0, start)]
    if (ordered.length) setFilming(ordered.map((s) => ({ id: s.uid, word: s.question.trim() })))
  }

  /** Films the words still without a video, or — when there are none — one new sign, named after. */
  function record() {
    if (unfilmed.length) film(unfilmed)
    else setFilming([{ id: crypto.randomUUID(), word: "New sign" }])
  }

  // Only signs that can be filmed right now take part in the selection.
  const selectable = signs.filter((s) => !s.questionImageUploading && !s.isSaving)
  const chosen = selectable.filter((s) => selected.has(s.uid))
  const allChosen = selectable.length > 0 && chosen.length === selectable.length

  function toggle(uid: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(uid)
      else next.delete(uid)
      return next
    })
  }

  /** Films the ticked signs in list order; each new take replaces its video. */
  function recordSelected() {
    setFilming(chosen.map((s) => ({ id: s.uid, word: s.question.trim() || "New sign" })))
    setSelected(new Set())
  }

  const have = new Set(signs.map((s) => s.question.trim().toLowerCase()))
  const typedWords = wordsFromList(listText).filter((w) => !have.has(w.toLowerCase()))

  /** Adds the typed words (skipping ones already in the test), ready to film. */
  function addList() {
    onChange((current) => [...current, ...typedWords.map((w) => newSign(w, undefined, false))])
    setListText("")
    setListOpen(false)
  }

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
        {selectable.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {chosen.length > 0 && (
              <Button type="button" size="sm" onClick={recordSelected}>
                <Camera className="size-4 mr-1.5" /> Record {chosen.length} selected
              </Button>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
              <Checkbox
                checked={allChosen}
                onCheckedChange={(v) => setSelected(v === true ? new Set(selectable.map((s) => s.uid)) : new Set())}
              />
              Select all
            </label>
          </div>
        )}
      </div>

      {signs.map((sign, i) => (
        <div key={sign.uid} className={cn("flex flex-col gap-1.5 rounded-xl border bg-background p-2", sign.error && "border-destructive/50")}>
          <div className="flex items-center gap-3">
            <Checkbox
              className="size-5 shrink-0"
              aria-label={`Select sign ${i + 1} to record`}
              checked={selected.has(sign.uid)}
              disabled={sign.questionImageUploading || sign.isSaving}
              onCheckedChange={(v) => toggle(sign.uid, v === true)}
            />
            <div className="relative w-28 sm:w-36 aspect-video shrink-0 overflow-hidden rounded-lg border bg-muted flex items-center justify-center">
              {sign.imageUrl
                ? isVideoMedia(sign.imageUrl, sign.mediaType)
                  ? <ProtectedVideo src={sign.imageUrl} muted controls preload="metadata" className="w-full h-full object-cover" />
                  : <img src={sign.imageUrl} alt="" className="w-full h-full object-contain" />
                : !sign.questionImageUploading && (
                  sign.question.trim() ? (
                    <button
                      type="button"
                      onClick={() => film(unfilmed, sign.uid)}
                      className="flex size-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                    >
                      <Camera className="size-4" /> Record
                    </button>
                  ) : <span className="text-[10px] text-muted-foreground">No video</span>
                )}
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
            {/* Film this sign again with the camera; the new take replaces its video. */}
            <Button type="button" variant="ghost" size="icon"
              className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
              title="Film again" aria-label={`Film sign ${i + 1} again`}
              disabled={sign.questionImageUploading || sign.isSaving}
              onClick={() => setFilming([{ id: sign.uid, word: sign.question.trim() || "New sign" }])}>
              <Camera className="size-4" />
            </Button>
            <label
              title="Replace video with a file"
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

      {listOpen && (
        <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
          <label htmlFor="sign-word-list" className="text-sm font-medium">Bulk add words</label>
          <p className="text-xs text-muted-foreground">
            Type or paste the words you will {kind === "FINGERSPELLING" ? "fingerspell" : "sign"}, one per line. They are added
            to the list without a video, ready to record one after another.
          </p>
          <Textarea
            id="sign-word-list"
            autoFocus
            rows={5}
            value={listText}
            onChange={(e) => setListText(e.target.value)}
            placeholder={"Hello\nThank you\nPlease"}
          />
          <p className="text-xs text-muted-foreground">
            {typedWords.length} word{typedWords.length !== 1 ? "s" : ""} · words already in this test are left as they are
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={!typedWords.length} onClick={addList}>
              <ListPlus className="size-4 mr-1.5" /> Add {typedWords.length || ""} word{typedWords.length !== 1 ? "s" : ""}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setListOpen(false); setListText("") }}>Cancel</Button>
          </div>
        </div>
      )}

      <FilmOverlay
        items={filming}
        onRecorded={(uid, fileUrl) => onChange((current) =>
          current.some((s) => s.uid === uid)
            ? current.map((s) => (s.uid === uid ? { ...s, imageUrl: fileUrl, mediaType: "video", dirty: true, error: null } : s))
            // A new sign filmed without a word yet: it joins the list to be named.
            : [...current, { ...newSign("", fileUrl), uid }])}
        onClose={() => setFilming(null)}
      />

      <div className="rounded-xl border border-dashed p-4 flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium">{signs.length === 0 ? "Add the first sign" : "Add more signs"}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={record}>
            <Camera className="size-4 mr-1.5" />
            {unfilmed.length > 0 ? `Record ${unfilmed.length} word${unfilmed.length > 1 ? "s" : ""}` : "Record"}
          </Button>
          {!listOpen && (
            <Button type="button" variant="outline" onClick={() => setListOpen(true)}>
              <ListPlus className="size-4 mr-1.5" /> Bulk add words
            </Button>
          )}
          <Button asChild type="button" variant="outline">
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

      <p className={cn("text-xs text-muted-foreground", kind === "VOCABULARY" && !signOnly && signs.length > 0 && signs.length < 4 && "text-amber-700")}>
        {kind === "FINGERSPELLING"
          ? "Students watch each clip and type the word. Capitals and spaces do not matter."
          : signOnly
          ? "Students read each word and film themselves signing it. Then each clip plays next to their video, to mark it against."
          : signs.length < 4
            ? "Students pick each sign's word from the words of the other signs — add at least 4 so there is a real choice."
            : "Students pick each sign's word from the words of the other signs, so there are no wrong answers to type."}
      </p>
    </div>
  )
}
