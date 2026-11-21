/**
 * What an admin lets one teacher change.
 *
 * The school keeps its material under admin control: a teacher sees tests,
 * classes, the library, groups and students but only changes the parts an
 * admin has switched on for them (Users → Access). Downloads are separate —
 * off, a teacher can watch videos but not save a copy.
 *
 * This only narrows what the TUTOR role can already do (lib/permissions.ts);
 * staff are never limited by it.
 */
export type TutorArea = "lessons" | "tests" | "calendar" | "library" | "groups" | "students" | "download"

export type TutorAccess = Record<TutorArea, boolean>

export const TUTOR_AREAS: Array<{ area: TutorArea; label: string; hint: string }> = [
  { area: "lessons", label: "Lessons", hint: "Add and change lessons and lesson files (PDFs, videos) on the courses they teach" },
  { area: "tests", label: "Tests", hint: "Make and change tests and leagues, and put them in courses" },
  { area: "calendar", label: "Calendar", hint: "Schedule, change and cancel classes, and invite people to them" },
  { area: "library", label: "Library", hint: "Use the school's library files in classes and tests" },
  { area: "groups", label: "Groups", hint: "Make groups and add or remove students" },
  { area: "students", label: "Students", hint: "Invite students and enrol them on courses" },
  { area: "download", label: "Download videos", hint: "Save a copy of videos and class recordings" },
]

export const FULL_ACCESS: TutorAccess = {
  lessons: true, tests: true, calendar: true, library: true, groups: true, students: true, download: true,
}

export const VIEW_ONLY_MESSAGE: Record<TutorArea, string> = {
  lessons: "Lessons are view only for you. Ask an admin if you need to change them.",
  tests: "Tests are view only for you. Ask an admin if you need to change them.",
  calendar: "Your calendar is view only. Ask an admin if you need to change a class.",
  library: "The school library is view only for you. Ask an admin to use its files.",
  groups: "Groups are view only for you. Ask an admin if you need to change one.",
  students: "Students are view only for you. Ask an admin to invite or enrol someone.",
  download: "Downloads are turned off for you. Ask an admin if you need a copy.",
}
