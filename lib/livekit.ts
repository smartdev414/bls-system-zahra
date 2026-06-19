import { AgentDispatchClient } from "livekit-server-sdk"

export const CLASSROOM_TRANSCRIBER_AGENT = "classroom-transcriber"

/**
 * Strip the per-connection suffix from a LiveKit participant identity.
 *
 * Join tokens use a unique identity of the form `<userId>__<random>` (see the
 * token route) so a rejoin never collides with a revoked identity on Cloud. This
 * recovers the underlying user id for the rare server-side check that needs it.
 */
export function participantBaseId(identity: string): string {
  return identity.split("__")[0]
}

/** LiveKit HTTP API base (Egress / AgentDispatch / RoomService). */
export function livekitHttpUrl(): string {
  const ws = process.env.LIVEKIT_WS_URL
  if (!ws) throw new Error("LIVEKIT_WS_URL is not configured")
  return ws.replace(/^wss?:\/\//, "https://")
}

export function livekitCredentials() {
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  if (!apiKey || !apiSecret) {
    throw new Error("LiveKit API credentials are not configured")
  }
  return { apiKey, apiSecret }
}

export function agentDispatchClient() {
  const { apiKey, apiSecret } = livekitCredentials()
  return new AgentDispatchClient(livekitHttpUrl(), apiKey, apiSecret)
}

/** Start the caption agent once per room (idempotent). STT uses LiveKit Inference. */
export async function ensureClassroomTranscriber(roomName: string): Promise<void> {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    console.warn("[captions] LiveKit not configured — server captions disabled")
    return
  }

  const client = agentDispatchClient()
  const existing = await client.listDispatch(roomName)
  if (existing.some((d) => d.agentName === CLASSROOM_TRANSCRIBER_AGENT)) return

  await client.createDispatch(roomName, CLASSROOM_TRANSCRIBER_AGENT)
}
