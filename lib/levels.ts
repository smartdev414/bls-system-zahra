export type CourseLevel = "L1" | "L2" | "L3" | "L4" | "L5" | "L6"

export const COURSE_LEVELS: CourseLevel[] = ["L1", "L2", "L3", "L4", "L5", "L6"]

export const levelLabel: Record<CourseLevel, string> = {
  L1: "L1", L2: "L2", L3: "L3", L4: "L4", L5: "L5", L6: "L6",
}

export const levelColor: Record<CourseLevel, string> = {
  L1: "bg-emerald-100 text-emerald-700 border-emerald-200",
  L2: "bg-teal-100 text-teal-700 border-teal-200",
  L3: "bg-sky-100 text-sky-700 border-sky-200",
  L4: "bg-amber-100 text-amber-700 border-amber-200",
  L5: "bg-orange-100 text-orange-700 border-orange-200",
  L6: "bg-rose-100 text-rose-700 border-rose-200",
}

export const levelColorSolid: Record<CourseLevel, string> = {
  L1: "bg-emerald-50 text-emerald-700",
  L2: "bg-teal-50 text-teal-700",
  L3: "bg-sky-50 text-sky-700",
  L4: "bg-amber-50 text-amber-700",
  L5: "bg-orange-50 text-orange-700",
  L6: "bg-rose-50 text-rose-700",
}

export const levelDot: Record<CourseLevel, string> = {
  L1: "bg-emerald-500",
  L2: "bg-teal-500",
  L3: "bg-sky-500",
  L4: "bg-amber-500",
  L5: "bg-orange-500",
  L6: "bg-rose-500",
}
