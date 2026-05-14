// Minimal root layout for the egress template route — bypasses the dashboard
// chrome so LiveKit's headless Chrome captures just the composite video grid
// with the brand watermark on top. Public; no auth.
export default function EgressLayout({ children }: { children: React.ReactNode }) {
  return children
}
