// The class recorder's page: /egress/<recorder pass>. See ../recorder-view.tsx
// and lib/recorder-pass.ts.
import { RecorderView } from "../recorder-view"

export const dynamic = "force-dynamic"

export default async function EgressRecorderPage({ params }: { params: Promise<{ pass: string }> }) {
  const { pass } = await params
  return <RecorderView pass={decodeURIComponent(pass)} />
}
