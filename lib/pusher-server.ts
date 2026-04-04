import Pusher from "pusher"

// Singleton — reused across serverless invocations in the same container
let _pusher: Pusher | null = null

export function getPusher(): Pusher {
  if (!_pusher) {
    _pusher = new Pusher({
      appId:   process.env.PUSHER_APP_ID!,
      key:     process.env.NEXT_PUBLIC_PUSHER_KEY!,
      secret:  process.env.PUSHER_SECRET!,
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      useTLS:  true,
    })
  }
  return _pusher
}

/** Trigger a new-message event on the conversation's private channel */
export async function triggerNewMessage(
  conversationId: string,
  payload: unknown,
) {
  await getPusher().trigger(
    `private-conversation-${conversationId}`,
    "new-message",
    payload,
  )
}

/** Notify a user's personal channel (e.g. sidebar badge update) */
export async function triggerUserEvent(
  userId: string,
  event: string,
  payload: unknown,
) {
  await getPusher().trigger(`private-user-${userId}`, event, payload)
}
