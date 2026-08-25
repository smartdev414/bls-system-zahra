/**
 * The exact set of network destinations a browser needs in order to use the
 * platform, derived from the deployment's own configuration.
 *
 * This exists so the "send this to your IT team" page is never out of date and
 * never a guess. A student on an NHS or police network cannot usually get a
 * broad exception; they can often get *specific* hosts added to an allowlist,
 * but only if the request is precise. Hand-maintained documentation drifts the
 * first time someone changes region or bucket, and a wrong hostname costs that
 * student another fortnight of IT tickets.
 *
 * Server-only: it reads process.env. The IT page renders it server-side.
 */

export type Requirement = {
  /** Hostname or wildcard pattern to allowlist. */
  host: string
  /** Ports and protocols used. */
  ports: string
  /** What breaks without it, in plain English. */
  purpose: string
  /** Whether class is impossible without it. */
  essential: boolean
  /** Extra detail for a security reviewer. */
  notes?: string
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.replace(/^wss?:\/\//, (m) => (m === "wss://" ? "https://" : "http://"))).host
  } catch {
    return null
  }
}

/** The app's own public origin, as configured for emails and egress. */
export function appHost(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return hostOf(explicit)
  if (process.env.VERCEL_URL) return process.env.VERCEL_URL
  return null
}

/**
 * LiveKit Cloud serves signalling from the project host and media/TURN from
 * regional hosts under the same parent domain, so the wildcard is the honest
 * answer — pinning only the project host produces an allowlist that passes the
 * connection test and then fails in a real class.
 */
function livekitHosts(): { project: string | null; wildcard: string } {
  const project = hostOf(process.env.LIVEKIT_WS_URL ?? process.env.LIVEKIT_URL)
  const wildcard = project?.endsWith(".livekit.cloud") ? "*.livekit.cloud" : (project ?? "your LiveKit host")
  return { project, wildcard }
}

export function networkRequirements(): Requirement[] {
  const app = appHost()
  const { project, wildcard } = livekitHosts()
  const bucket = process.env.AWS_S3_BUCKET
  const region = process.env.AWS_REGION ?? "eu-west-2"
  const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER

  const reqs: Requirement[] = []

  if (app) {
    reqs.push({
      host: app,
      ports: "TCP 443 (HTTPS)",
      purpose: "The learning platform itself — signing in, courses, the classroom page.",
      essential: true,
    })
  }

  if (project) {
    reqs.push({
      host: wildcard,
      ports: "TCP 443 (HTTPS + WebSocket)",
      purpose: "Live classroom signalling: who is in the room, slide changes, the whiteboard, chat.",
      essential: true,
      notes:
        `Signalling is a WebSocket upgrade over TLS on 443. Some inspection proxies terminate ` +
        `idle WebSockets — a class runs for up to two hours, so the connection must be allowed to stay open. ` +
        `Project host: ${project}`,
    })
    reqs.push({
      host: wildcard,
      ports: "UDP 3478 and UDP 50000-60000 (preferred) — otherwise TCP/TLS 443",
      purpose: "The live audio and video itself.",
      essential: true,
      notes:
        "If outbound UDP cannot be opened, no exception is needed for it: the platform's " +
        "Restricted network mode relays all media over TLS on TCP 443 to the same hosts. " +
        "Media quality is slightly lower and latency slightly higher, but class works.",
    })
  }

  if (bucket) {
    reqs.push({
      host: `${bucket}.s3.${region}.amazonaws.com`,
      ports: "TCP 443 (HTTPS)",
      purpose: "Lesson materials, slides, handouts, chat attachments and session recordings.",
      essential: true,
      notes: "Downloads and uploads go browser-to-storage using short-lived signed URLs.",
    })
  }

  if (pusherCluster) {
    reqs.push({
      host: `ws-${pusherCluster}.pusher.com, sockjs-${pusherCluster}.pusher.com`,
      ports: "TCP 443 (HTTPS + WebSocket)",
      purpose: "Notifications and messages outside the classroom (new message badge, 'your class is starting').",
      essential: false,
      notes:
        "Not required to attend a class. Where WebSockets are blocked the client falls back " +
        "automatically to ordinary HTTPS requests against the same hosts.",
    })
  }

  reqs.push({
    host: "fonts.googleapis.com, fonts.gstatic.com",
    ports: "TCP 443 (HTTPS)",
    purpose: "Page fonts.",
    essential: false,
    notes: "Cosmetic only — the platform is fully usable if these are blocked.",
  })

  return reqs
}

/** Browser and device requirements, for the same audience. */
export const CLIENT_REQUIREMENTS = [
  {
    title: "Browser",
    detail:
      "Google Chrome, Microsoft Edge, Firefox or Safari, kept within about a year of current. " +
      "No plugin, extension or installed software is needed.",
  },
  {
    title: "Camera",
    detail:
      "Needed only if the student must be seen signing — required for assessed sessions, optional otherwise. " +
      "A student with no camera can still attend, watch, read live captions and use chat.",
  },
  {
    title: "Microphone",
    detail:
      "Optional. Student microphones stay muted unless the tutor turns one on.",
  },
  {
    title: "Screen sharing",
    detail: "Optional, browser-native. No software install.",
  },
  {
    title: "Data stored on the device",
    detail:
      "The platform keeps a sign-in cookie plus small preference values in browser storage. " +
      "Where site data is disabled by policy the platform still works; only convenience features " +
      "such as restoring a half-typed chat message after a reload are lost.",
  },
] as const
