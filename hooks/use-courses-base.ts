"use client"

import { usePathname } from "next/navigation"

/**
 * The course builder pages are shared by the tutor and admin portals. This
 * returns the courses root for whichever portal is rendering them, so links
 * and redirects stay inside that portal.
 */
export function useCoursesBase(): "/admin/courses" | "/tutor/courses" {
  const pathname = usePathname()
  return pathname?.startsWith("/admin") ? "/admin/courses" : "/tutor/courses"
}
