import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { backgroundCleanConfigured, startBackgroundClean } from "@/lib/background-clean"
import { rawRecordingName } from "@/lib/background-clean-keys"
import { isBackgroundValue } from "@/lib/background-presets"
import { findVisibleFile } from "@/lib/library-access"
import { copyObject, objectExists, publicUrl } from "@/lib/s3"
import { sanitizeUploadFileName } from "@/lib/upload-filename"
import type { LibraryItem } from "@/lib/library"

/**
 * Give a video that is already stored — a clip a friend filmed, a lesson
 * video uploaded earlier — a new background, the same way a recording made in
 * the recorder gets one (see lib/background-clean.ts).
 *
 * The original is left as it is. A copy is made under a raw-recording name,
 * the worker is pointed at it, and a new library file is created for the
 * caller that plays the finished version once it exists. Until then the new
 * file shows as "replacing background" and students can't be shown it.
 */

const S3_HOST = /\.s3[.-]([a-z0-9-]+\.)?amazonaws\.com$/i

/** The stored key behind a file URL, if it is a video in our bucket. */
function videoKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!S3_HOST.test(parsed.hostname)) return null
    const key = decodeURIComponent(parsed.pathname.slice(1))
    if (key.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null
    return /^videos\/.+\.(mp4|webm|mov|m4v)$/i.test(key) ? key : null
  } catch {
    return null
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
    if (!backgroundCleanConfigured()) {
      return NextResponse.json({ message: "Background replacement is not set up on this server" }, { status: 503 })
    }

    const body = await req.json() as { fileUrl?: string; color?: string; title?: string }
    if (!isBackgroundValue(body.color)) {
      return NextResponse.json({ message: "color must be #rrggbb or a background image" }, { status: 400 })
    }
    if (typeof body.fileUrl !== "string") {
      return NextResponse.json({ message: "fileUrl is required" }, { status: 400 })
    }

    // Only a video this person can see in the library, and only one stored
    // by us: the worker is handed a signed link to our bucket, nothing else.
    const source = await findVisibleFile(session, { fileUrl: body.fileUrl })
    if (!source || source.assetType !== "VIDEO") {
      return NextResponse.json({ message: "That video isn't in your library" }, { status: 404 })
    }
    const sourceKey = videoKeyFromUrl(source.fileUrl)
    if (!sourceKey) {
      return NextResponse.json({ message: "Only videos uploaded here can have their background replaced" }, { status: 400 })
    }
    if (!(await objectExists(sourceKey))) {
      return NextResponse.json({ message: "The video file could not be found in storage" }, { status: 404 })
    }

    // A fresh copy for the worker, in the caller's own folder: the original
    // stays untouched for the lessons and classes already using it.
    const baseName = sanitizeUploadFileName(source.fileName || sourceKey.split("/").pop() || "video.mp4")
    const rawName = rawRecordingName(baseName)
    const rawKey = `videos/${session.sub}/${randomUUID()}/${rawName}`
    const contentType = source.mimeType?.startsWith("video/") ? source.mimeType : "video/mp4"
    await copyObject(sourceKey, rawKey, contentType)

    const job = await startBackgroundClean(rawKey, session.sub, body.color)

    const title = body.title?.trim() || `${source.title.replace(/\.[^.]+$/, "")} (new background)`
    const file = await prisma.libraryFile.create({
      data: {
        tutorId: session.sub,
        title,
        fileUrl: publicUrl(rawKey),
        fileName: rawName,
        fileSize: source.fileSize,
        // The gateway serves the finished MP4 under this address once it exists.
        mimeType: "video/mp4",
        assetType: "VIDEO",
        level: source.source === "library" ? source.level : null,
      },
    })

    const item: LibraryItem = {
      id: file.id,
      source: "library",
      shared: session.role === "ADMIN",
      canRemove: true,
      level: file.level,
      title: file.title,
      fileUrl: file.fileUrl,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      assetType: "VIDEO",
      presentationUrl: null,
      presentationMimeType: null,
      usedIn: null,
      createdAt: file.createdAt.toISOString(),
    }
    return NextResponse.json({ item, state: job.status === "FAILED" ? "failed" : "processing" }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/upload/clean-background/from-file]", err)
    return NextResponse.json({ message: "Could not start background replacement" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
