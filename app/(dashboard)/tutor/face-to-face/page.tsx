"use client"

import { SessionsManager } from "@/components/sessions/sessions-manager"

export default function TutorFaceToFacePage() {
  return (
    <SessionsManager
      heading="Face to face"
      subheading="Your classes taught in person, at a venue"
      scope={{
        canTeach: true,
        canManageResources: true,
        basePath: "/tutor",
        mustAssignTutor: false,
        faceToFace: true,
      }}
    />
  )
}
