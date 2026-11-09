import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { isSessionHost, studentMayJoinSession } from "@/lib/session-access"

/**
 * Shared gate for classroom chat attachment uploads.
 *
 * Both the single-PUT presign route and the multipart route have to answer the
 * same question — may this caller put a file into this session's chat? — so the
 * check lives here rather than being copied and drifting between the two.
 */

export const ALLOWED_CHAT_UPLOAD_TYPES: Record<string, true> = {
  // Images
  "image/jpeg": true,
  "image/png": true,
  "image/webp": true,
  "image/gif": true,
  // Video
  "video/mp4": true,
  "video/webm": true,
  "video/quicktime": true,
  // Documents
  "application/pdf": true,
  // PowerPoint
  "application/vnd.ms-powerpoint": true,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
  // Word
  "application/msword": true,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
  // Excel
  "application/vnd.ms-excel": true,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
  // Plain text
  "text/plain": true,
}

export const UNSUPPORTED_TYPE_MESSAGE =
  "is not supported. Use images, video, PDF, Word, PowerPoint, Excel, or text files."

/** Every chat attachment for a session lives under this prefix, namespaced by uploader. */
export function chatUploadPrefix(sessionId: string, userId: string): string {
  return `classroom-chat/${sessionId}/${userId}`
}

/**
 * True when `key` is inside the caller's own folder for this session.
 *
 * The multipart flow round-trips the key through the browser (to sign parts and
 * to complete the upload), so every follow-up call has to re-prove the key is
 * one this caller is allowed to write — otherwise a crafted key could finalize
 * an upload anywhere in the bucket.
 */
export function isOwnChatUploadKey(key: string, sessionId: string, userId: string): boolean {
  return (
    typeof key === "string" &&
    !key.includes("..") &&
    key.startsWith(`${chatUploadPrefix(sessionId, userId)}/`)
  )
}

type AccessResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

/**
 * Resolve the caller and confirm they may attach files to this session's chat.
 * Mirrors the room token route: the owning tutor, any co-tutor, and any student
 * who can be in the room.
 */
export async function authorizeChatUpload(sessionId: string): Promise<AccessResult> {
  const auth = await getSession()
  if (!auth) {
    return { ok: false, response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  }

  const liveSession = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      tutorId: true,
      courseId: true,
      status: true,
      visibility: true,
      coTutors: { select: { tutorId: true } },
    },
  })

  if (!liveSession) {
    return { ok: false, response: NextResponse.json({ message: "Session not found" }, { status: 404 }) }
  }

  if (liveSession.status === "CANCELLED" || liveSession.status === "COMPLETED") {
    return {
      ok: false,
      response: NextResponse.json({ message: "Session is no longer active" }, { status: 410 }),
    }
  }

  // Every tutor who can be in the room may attach files: the owning tutor and
  // any co-tutor they invited to this session. The token route grants both the
  // same tutor rights, so the upload gate has to match it — otherwise a
  // co-teacher sees the paperclip but gets a 403 on send.
  const isTutor =
    auth.role === "TUTOR" &&
    (auth.sub === liveSession.tutorId ||
      liveSession.coTutors.some((c) => c.tutorId === auth.sub) ||
      (await isSessionHost(auth, liveSession.id)))
  const isStudent = auth.role === "STUDENT"

  if (!isTutor && !isStudent) {
    return { ok: false, response: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }

  if (isStudent && !(await studentMayJoinSession(liveSession, auth.sub))) {
    return { ok: false, response: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }

  return { ok: true, userId: auth.sub }
}
