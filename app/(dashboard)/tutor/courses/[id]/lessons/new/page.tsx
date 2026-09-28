"use client"

import { use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCoursesBase } from "@/hooks/use-courses-base"
import { AddLessonScreen } from "../../AddLessonScreen"

export default function NewLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const coursesBase = useCoursesBase()
  const searchParams = useSearchParams()
  const sectionId = searchParams.get("sectionId") ?? ""

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href={`${coursesBase}/${id}`}>
          <ChevronLeft className="size-4 mr-1" /> Back to Course
        </Link>
      </Button>

      <AddLessonScreen
        courseId={id}
        sectionId={sectionId}
        onClose={() => router.push(`${coursesBase}/${id}`)}
        onSuccess={() => router.push(`${coursesBase}/${id}`)}
      />
    </div>
  )
}
