/**
 * Who can be invited into a class as a co-teacher: tutors, and support staff
 * (who come in as the class's interpreter). Each opens the classroom from their
 * own dashboard, so invite links depend on the role.
 */
export const CO_TEACHER_ROLES = ["TUTOR", "SUPPORT"] as const

export function coTeacherHome(role: string): "/tutor" | "/support" {
  return role === "SUPPORT" ? "/support" : "/tutor"
}

/** Splits invitees by dashboard so each notification links to the right place. */
export function byCoTeacherHome(people: { id: string; role: string }[]): Map<"/tutor" | "/support", string[]> {
  const out = new Map<"/tutor" | "/support", string[]>()
  for (const p of people) {
    const home = coTeacherHome(p.role)
    out.set(home, [...(out.get(home) ?? []), p.id])
  }
  return out
}
