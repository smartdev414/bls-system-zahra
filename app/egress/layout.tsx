// Minimal layout for the class recorder's page — no dashboard chrome, so
// LiveKit's headless Chrome captures only the recording (see recorder-view.tsx).
// Public; no auth.
export default function EgressLayout({ children }: { children: React.ReactNode }) {
  return children
}
