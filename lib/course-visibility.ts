import type { Prisma } from "@/app/generated/prisma/client"

/**
 * Which courses a student can see: published, and either public or one they
 * are on. A private course is a real class — students only see it once staff
 * or a tutor enrol them (directly or through a group), so nobody browses other
 * levels' classes by mistake.
 */
export function studentVisibleCourses(studentId: string): Prisma.CourseWhereInput {
  return {
    status: "PUBLISHED",
    OR: [{ visibility: "PUBLIC" }, { enrollments: { some: { studentId } } }],
  }
}

export const COURSE_VISIBILITIES = ["PRIVATE", "PUBLIC"] as const
export type CourseVisibility = (typeof COURSE_VISIBILITIES)[number]

export function isCourseVisibility(value: unknown): value is CourseVisibility {
  return value === "PRIVATE" || value === "PUBLIC"
}
