"use client"

import { SessionsManager } from "@/components/sessions/sessions-manager"

export default function SupportTimetablePage() {
  return (
    <SessionsManager
      heading="Timetable"
      subheading="Schedule classes and put students in them"
      scope={{
        // Office staff build the timetable but don't run the room, and lesson
        // material stays with the tutors.
        canTeach: false,
        canManageResources: false,
        basePath: "/support",
        mustAssignTutor: true,
      }}
    />
  )
}
