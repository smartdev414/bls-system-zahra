export type CourseLevel = "Introduction" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6"

export const COURSE_LEVELS: CourseLevel[] = ["Introduction", "L1", "L2", "L3", "L4", "L5", "L6"]

export const levelLabel: Record<CourseLevel, string> = {
  Introduction: "Introduction", L1: "L1", L2: "L2", L3: "L3", L4: "L4", L5: "L5", L6: "L6",
}

export const levelColor: Record<CourseLevel, string> = {
  Introduction: "bg-violet-100 text-violet-700 border-violet-200",
  L1: "bg-emerald-100 text-emerald-700 border-emerald-200",
  L2: "bg-teal-100 text-teal-700 border-teal-200",
  L3: "bg-sky-100 text-sky-700 border-sky-200",
  L4: "bg-amber-100 text-amber-700 border-amber-200",
  L5: "bg-orange-100 text-orange-700 border-orange-200",
  L6: "bg-rose-100 text-rose-700 border-rose-200",
}

export const levelColorSolid: Record<CourseLevel, string> = {
  Introduction: "bg-violet-50 text-violet-700",
  L1: "bg-emerald-50 text-emerald-700",
  L2: "bg-teal-50 text-teal-700",
  L3: "bg-sky-50 text-sky-700",
  L4: "bg-amber-50 text-amber-700",
  L5: "bg-orange-50 text-orange-700",
  L6: "bg-rose-50 text-rose-700",
}

export const levelDot: Record<CourseLevel, string> = {
  Introduction: "bg-violet-500",
  L1: "bg-emerald-500",
  L2: "bg-teal-500",
  L3: "bg-sky-500",
  L4: "bg-amber-500",
  L5: "bg-orange-500",
  L6: "bg-rose-500",
}

/** Reads a level sent by a form: null when none was chosen, undefined when it is not a level. */
export function parseLevel(value: unknown): CourseLevel | null | undefined {
  if (value === null || value === "" || value === undefined) return null
  return COURSE_LEVELS.includes(value as CourseLevel) ? (value as CourseLevel) : undefined
}
