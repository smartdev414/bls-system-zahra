"use client"

import { SessionsManager } from "@/components/sessions/sessions-manager"

export default function SupportFaceToFacePage() {
  return (
    <SessionsManager
      heading="Face to face"
      subheading="Classes taught in person, at a venue — not in the online classroom"
      scope={{
        canTeach: false,
        canManageResources: false,
        basePath: "/support",
        mustAssignTutor: true,
        faceToFace: true,
      }}
    />
  )
}
