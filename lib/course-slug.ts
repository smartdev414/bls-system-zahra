import prisma from "@/lib/prisma"

/**
 * A URL slug for a new course, made from its title and numbered when the plain
 * one is taken ("bsl-level-1", "bsl-level-1-1", …) — which is the normal case
 * when a course is copied for another group.
 */
export async function uniqueCourseSlug(title: string): Promise<string> {
  const baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "course"
  let slug = baseSlug
  let attempt = 0
  while (await prisma.course.findFirst({ where: { slug }, select: { id: true } })) {
    attempt++
    slug = `${baseSlug}-${attempt}`
  }
  return slug
}
