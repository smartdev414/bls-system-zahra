/**
 * Client-safe helpers for LiveKit participant identities.
 *
 * Kept separate from `lib/livekit.ts` because that module imports
 * `livekit-server-sdk`, which must never reach the browser bundle.
 */

/**
 * Strip the per-connection suffix from a LiveKit participant identity.
 *
 * Join tokens use a unique identity of the form `<userId>__<random>` (see the
 * token route) so a rejoin never collides with a revoked identity on Cloud.
 * That means a participant's identity changes every time they reconnect — after
 * a dropped Wi-Fi connection the same person comes back as a different
 * identity. Anything that has to remember *who someone is* across reconnects
 * (breakout group membership, for one) must key on this base id instead.
 */
export function participantBaseId(identity: string): string {
  return identity.split("__")[0]
}

/** True when both identities belong to the same user, across reconnects. */
export function isSameUser(a: string, b: string): boolean {
  return participantBaseId(a) === participantBaseId(b)
}
