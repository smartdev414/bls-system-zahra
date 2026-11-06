import { FileText, FlaskConical, Image as ImageIcon, Music, PlayCircle, type LucideIcon } from "lucide-react"

type LessonType = "VIDEO" | "TEXT" | "QUIZ"

export const LESSON_KINDS: Record<string, { label: string; Icon: LucideIcon }> = {
  VIDEO: { label: "Video", Icon: PlayCircle },
  TEXT: { label: "Text", Icon: FileText },
  QUIZ: { label: "Test", Icon: FlaskConical },
  PDF: { label: "PDF", Icon: FileText },
  DOCUMENT: { label: "Document", Icon: FileText },
  IMAGE: { label: "Image", Icon: ImageIcon },
  AUDIO: { label: "Audio", Icon: Music },
}

/**
 * What a lesson is called on screen. A "Video" lesson can hold any file, so the
 * label follows what was actually attached: a video if there is one, otherwise
 * the first file. With no files yet it falls back to the lesson's own type.
 */
export function lessonKind(type: LessonType, assets: ReadonlyArray<{ type: string }>) {
  return LESSON_KINDS[lessonKindKey(type, assets)]
}

/**
 * The same, as a key into LESSON_KINDS ("VIDEO", "PDF", …), for APIs to send
 * so student lists show a PDF lesson as a PDF rather than a video.
 */
export function lessonKindKey(type: LessonType, assets: ReadonlyArray<{ type: string }>): string {
  if (type === "QUIZ") return "QUIZ"
  const files = assets.filter((a) => a.type in LESSON_KINDS)
  const main = files.find((a) => a.type === "VIDEO") ?? files[0]
  return main?.type ?? type
}
