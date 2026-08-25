import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { AccessToken } from "livekit-server-sdk"
import { getSession } from "@/lib/auth"

/**
 * Mints a short-lived LiveKit token for the connection diagnostics.
 *
 * The diagnostics have to make a *real* connection to the *real* media servers
 * to be worth anything — a synthetic reachability ping cannot tell you whether
 * this hospital's proxy will pass a WebSocket upgrade, or whether the firewall
 * drops the UDP media path once the handshake succeeds. Both are extremely
 * common and both look fine to a naive test.
 *
 * The token is scoped to a private, per-user scratch room so a diagnostic run
 * can never touch a live class, and expires in five minutes. Publishing is
 * granted because the camera/microphone check publishes a track for a few
 * seconds to measure the upstream path.
 */
export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const wsUrl = process.env.LIVEKIT_WS_URL

  if (!apiKey || !apiSecret || !wsUrl) {
    return NextResponse.json(
      { message: "Live classroom is not configured on this server." },
      { status: 503 },
    )
  }

  // Fresh room name per run. Reusing one risks colliding with the previous
  // run's connection, which LiveKit would reject as a duplicate identity —
  // the diagnostics would then report a network fault that does not exist.
  const roomName = `netcheck-${session.sub}-${randomUUID().slice(0, 8)}`

  const at = new AccessToken(apiKey, apiSecret, {
    identity: `netcheck-${session.sub}-${randomUUID().slice(0, 8)}`,
    name: session.name,
    ttl: 5 * 60,
    metadata: "netcheck",
  })
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  })

  return NextResponse.json({ token: await at.toJwt(), wsUrl, roomName })
}
