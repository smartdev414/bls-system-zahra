import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk"

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
  const ws = process.env.LIVEKIT_WS_URL ?? process.env.LIVEKIT_URL
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

function isAgentParticipant(identity: string): boolean {
  return identity.startsWith("agent-") || identity.includes("classroom-transcriber")
}

/** True when a transcriber worker is already connected in the room. */
async function transcriberActiveInRoom(roomName: string): Promise<boolean> {
  try {
    const participants = await roomServiceClient().listParticipants(roomName)
    return participants.some((p) => isAgentParticipant(p.identity))
  } catch {
    // Room not created yet — first join is in progress.
    return false
  }
}

/**
 * Ensure the caption agent is dispatched for `roomName`.
 *
 * - Always awaits dispatch (required on Vercel/serverless).
 * - Re-dispatches when listDispatch shows a stale entry but no agent is in the room
 *   (common cause of intermittent missing captions).
 */
export async function ensureClassroomTranscriber(roomName: string): Promise<void> {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    console.warn("[captions] LiveKit not configured — server captions disabled")
    return
  }
  if (!process.env.LIVEKIT_WS_URL && !process.env.LIVEKIT_URL) {
    console.warn("[captions] LIVEKIT_WS_URL missing — cannot dispatch transcriber")
    return
  }

  try {
    const client = agentDispatchClient()

    if (await transcriberActiveInRoom(roomName)) {
      console.info("[captions] transcriber already active in room", roomName)
      return
    }

    const existing = await client.listDispatch(roomName)
    const hasDispatch = existing.some((d) => d.agentName === CLASSROOM_TRANSCRIBER_AGENT)
    if (hasDispatch) {
      console.info("[captions] stale dispatch for room — re-dispatching transcriber", roomName)
    }

    await client.createDispatch(roomName, CLASSROOM_TRANSCRIBER_AGENT)
    console.info("[captions] dispatched classroom-transcriber to room", roomName)
  } catch (err) {
    console.error("[captions] transcriber dispatch failed for room", roomName, err)
    throw err
  }
}
