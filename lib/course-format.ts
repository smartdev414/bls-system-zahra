/**
 * How a course is taught: in the online classroom, or face to face at a venue.
 * Its classes take the same format, so a student on a face-to-face course is
 * never shown a "Join" button for a room nobody will be in.
 */
export const COURSE_FORMATS = ["ONLINE", "IN_PERSON"] as const
export type CourseFormat = (typeof COURSE_FORMATS)[number]

export function isCourseFormat(value: unknown): value is CourseFormat {
  return value === "ONLINE" || value === "IN_PERSON"
}

export const courseFormatLabel: Record<CourseFormat, string> = {
  ONLINE: "Online classroom",
  IN_PERSON: "Face to face",
}

/** A venue as typed, or null when there is nothing in it. */
export function cleanVenue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null
}
