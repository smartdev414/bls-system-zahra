"use client"

import { use } from "react"
import { StudentActivityView } from "@/components/students/student-activity-view"

export default function SupportStudentActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <StudentActivityView studentId={id} />
}
