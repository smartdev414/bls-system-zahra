// The class recorder's page without a pass — what a recording started before
// passes existed opens. It films the same people (tutors, plus a student the tutor shows), just without the stage.
// See recorder-view.tsx.
import { RecorderView } from "./recorder-view"

export const dynamic = "force-dynamic"

export default function EgressTemplatePage() {
  return <RecorderView pass={null} />
}
