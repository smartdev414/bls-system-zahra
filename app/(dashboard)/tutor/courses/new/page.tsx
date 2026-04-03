"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ChevronLeft, BookOpen } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { usePostCallback } from "@/hooks/use-fetch"

type CourseBody = {
  title: string
  description: string
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
}

export default function NewCoursePage() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [level, setLevel] = useState<"BEGINNER" | "INTERMEDIATE" | "ADVANCED">("BEGINNER")

  const { execute: createCourse, loading } = usePostCallback<{ course: { id: string } }, CourseBody>(
    "/api/tutor/courses",
    {
      successMessage: "Course created!",
      errorMessage: "Could not create course",
      onSuccess: (data) => router.push(`/tutor/courses/${data.course.id}`),
    }
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createCourse({ title, description, level })
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href="/tutor/courses">
          <ChevronLeft className="size-4 mr-1" /> My Courses
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-black tracking-tight">Create New Course</h1>
        <p className="text-muted-foreground mt-1">Set up your BSL course details.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="size-4 text-primary" /> Course Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">Course Title <span className="text-destructive">*</span></Label>
              <Input
                id="title"
                placeholder="e.g. BSL Beginner Basics"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
              <Textarea
                id="description"
                placeholder="Describe what students will learn in this course..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="level">Level <span className="text-destructive">*</span></Label>
              <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
                <SelectTrigger id="level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BEGINNER">Beginner</SelectItem>
                  <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
                  <SelectItem value="ADVANCED">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={loading || !title.trim() || !description.trim()}>
                {loading ? "Creating..." : "Create Course"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/tutor/courses">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
