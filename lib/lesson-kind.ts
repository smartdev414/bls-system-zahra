import { FileText, FlaskConical, Image as ImageIcon, Music, PlayCircle, type LucideIcon } from "lucide-react"

type LessonType = "VIDEO" | "TEXT" | "QUIZ"

const KINDS: Record<string, { label: string; Icon: LucideIcon }> = {
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
  if (type === "QUIZ") return KINDS.QUIZ
  const files = assets.filter((a) => a.type in KINDS)
  const main = files.find((a) => a.type === "VIDEO") ?? files[0]
  return KINDS[main?.type ?? type]
}
