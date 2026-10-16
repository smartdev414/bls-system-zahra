// The class recorder's page without a pass — what a recording started before
// passes existed opens. It still films the tutor only, just without the stage.
// See recorder-view.tsx.
import { RecorderView } from "./recorder-view"

export const dynamic = "force-dynamic"

export default function EgressTemplatePage() {
  return <RecorderView pass={null} />
}
