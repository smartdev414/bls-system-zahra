"use client"

import { usePathname } from "next/navigation"

/**
 * The test bank pages are shared by the tutor and admin portals. This returns
 * the Tests root for whichever portal is showing them, so links stay inside it.
 */
export function useTestsBase(): "/admin/tests" | "/tutor/tests" {
  const pathname = usePathname()
  return pathname?.startsWith("/admin") ? "/admin/tests" : "/tutor/tests"
}
