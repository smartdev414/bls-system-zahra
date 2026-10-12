"use client"

import { use, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { UploadedFile } from "@/components/ui/file-upload"
import { useCoursesBase } from "@/hooks/use-courses-base"
import type { LibraryItem } from "@/lib/library"
import { AddLessonScreen, type LessonType } from "../../AddLessonScreen"

export default function NewLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const coursesBase = useCoursesBase()
  const searchParams = useSearchParams()
  const sectionId = searchParams.get("sectionId") ?? ""
  // Set when the page is opened from the library's "Use" menu: the file to
  // start the lesson with, and whether it is a lesson or a test.
  const fileId = searchParams.get("file")
  const kindParam = searchParams.get("kind")
  const initialType: LessonType | undefined =
    kindParam === "QUIZ" || kindParam === "VIDEO" || kindParam === "TEXT" ? kindParam : undefined

  // Lessons are added by admins. In the tutor portal this page has nothing to
  // offer, so go back to the course instead of showing a form that can't save.
  const viewOnly = coursesBase === "/tutor/courses"
  useEffect(() => {
    if (viewOnly) router.replace(`${coursesBase}/${id}`)
  }, [viewOnly, router, coursesBase, id])

  // undefined while the chosen file is being fetched; [] when there is none
  // (or it could not be found — the lesson can still be built by hand).
  const [initialFiles, setInitialFiles] = useState<UploadedFile[] | undefined>(fileId ? undefined : [])
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    fetch(`/api/tutor/library/${encodeURIComponent(fileId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { file: LibraryItem }) => {
        if (cancelled) return
        const f = d.file
        setInitialFiles([{
          fileUrl: f.fileUrl,
          fileName: f.fileName,
          fileSize: f.fileSize ?? 0,
          mimeType: f.mimeType ?? "",
          assetType: f.assetType,
          presentationUrl: f.presentationUrl ?? undefined,
          presentationMimeType: f.presentationMimeType ?? undefined,
        }])
      })
      .catch(() => {
        if (cancelled) return
        toast.error("The chosen library file could not be found. Pick it again from the library.")
        setInitialFiles([])
      })
    return () => { cancelled = true }
  }, [fileId])

  if (viewOnly) return null

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href={`${coursesBase}/${id}`}>
          <ChevronLeft className="size-4 mr-1" /> Back to Course
        </Link>
      </Button>

      {initialFiles === undefined ? (
        <div className="flex items-center justify-center min-h-40">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <AddLessonScreen
          courseId={id}
          sectionId={sectionId}
          initialType={initialType}
          initialFiles={initialFiles}
          onClose={() => router.push(`${coursesBase}/${id}`)}
          onSuccess={() => router.push(`${coursesBase}/${id}`)}
        />
      )}
    </div>
  )
}
