// Resolves the public origin (https://yourapp.com) the LiveKit egress worker
// should navigate to when loading our custom recording template.
//
// Resolution order:
//   1. NEXT_PUBLIC_APP_URL  — set this in Vercel for production / preview to
//      a stable URL (e.g. https://deafsigns.app). Highest priority because it
//      survives custom domains and preview-vs-prod parity.
//   2. VERCEL_URL           — auto-set by Vercel on every deploy, no scheme.
//      We prepend https://. Useful as a zero-config fallback.
//   3. Local dev fallback   — http://localhost:3000. LiveKit Cloud cannot
//      reach localhost; this path only exists to keep dev runs from crashing.
export function publicAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return "http://localhost:3000"
}

/** Full URL for the LiveKit egress custom template. */
export function egressTemplateUrl(): string {
  return `${publicAppUrl()}/egress`
}
