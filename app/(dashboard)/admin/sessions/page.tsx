"use client"

import { SessionsManager } from "@/components/sessions/sessions-manager"

export default function AdminSessionsPage() {
  return (
    <SessionsManager
      heading="Live Sessions"
      subheading="Schedule classes and choose the tutor who takes each one"
      scope={{
        // Admins run the timetable from their own login; the class itself is
        // taken by the tutor they assign, who also handles its teaching files.
        canTeach: false,
        // ...but they can look back at any class's recording.
        canWatchRecordings: true,
        canManageResources: false,
        basePath: "/admin",
        mustAssignTutor: true,
      }}
    />
  )
}
