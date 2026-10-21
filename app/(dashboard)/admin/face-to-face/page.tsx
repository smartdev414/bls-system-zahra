"use client"

import { SessionsManager } from "@/components/sessions/sessions-manager"

export default function AdminFaceToFacePage() {
  return (
    <SessionsManager
      heading="Face to face"
      subheading="Classes taught in person, at a venue — not in the online classroom"
      scope={{
        canTeach: false,
        canWatchRecordings: true,
        canManageResources: false,
        basePath: "/admin",
        mustAssignTutor: true,
        faceToFace: true,
      }}
    />
  )
}
