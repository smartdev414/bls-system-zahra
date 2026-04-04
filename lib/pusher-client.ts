import Pusher from "pusher-js"

let _client: Pusher | null = null

export function getPusherClient(): Pusher {
  if (!_client) {
    _client = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster:          process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      authEndpoint:     "/api/pusher/auth",
      authTransport:    "ajax",
      auth: {
        headers: { "Content-Type": "application/json" },
      },
    })
  }
  return _client
}
