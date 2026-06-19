import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk"

export const CLASSROOM_TRANSCRIBER_AGENT = "classroom-transcriber"

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

export function roomServiceClient() {
  const { apiKey, apiSecret } = livekitCredentials()
  return new RoomServiceClient(livekitHttpUrl(), apiKey, apiSecret)
}

/**
 * Force-clear any lingering session for `identity` in `roomName`.
 *
 * On a page refresh or tab close the browser kills the WebSocket without a clean
 * LiveKit "leave", so the server holds the participant in its reconnect-grace
 * window (~15s). Because everyone joins with a stable identity (`session.sub`),
 * an immediate rejoin collides with that ghost and the new token is rejected with
 * `invalid token: revoked`. Evicting the ghost up front frees the identity so the
 * fresh join succeeds. Removing the old session only revokes that session's token,
 * not the identity — a freshly-minted token joins cleanly. No-op if the
 * participant or room doesn't exist yet.
 */
export async function evictStaleParticipant(roomName: string, identity: string): Promise<void> {
  try {
    await roomServiceClient().removeParticipant(roomName, identity)
  } catch {
    // Participant or room not found — nothing to clear.
  }
}

/** Start the caption agent once per room (idempotent). */
export async function ensureClassroomTranscriber(roomName: string): Promise<void> {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.warn("[captions] DEEPGRAM_API_KEY missing — server captions disabled")
    return
  }

  const client = agentDispatchClient()
  const existing = await client.listDispatch(roomName)
  if (existing.some((d) => d.agentName === CLASSROOM_TRANSCRIBER_AGENT)) return

  await client.createDispatch(roomName, CLASSROOM_TRANSCRIBER_AGENT)
}
