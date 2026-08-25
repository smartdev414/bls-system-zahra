import Pusher from "pusher-js"

let _client: Pusher | null = null

export function getPusherClient(): Pusher {
  if (!_client) {
    _client = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster:          process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      authEndpoint:     "/api/pusher/auth",
      authTransport:    "ajax",
      // Everything on 443. Corporate proxies routinely allow only 80/443, and a
      // cleartext attempt on another port is dropped without explanation.
      forceTLS: true,
      // Transport order matters on locked-down networks. WebSockets are tried
      // first because they are the right tool, but many inspection proxies
      // strip the Upgrade header — so the HTTP-based transports are listed
      // explicitly as fallbacks. Without them, a student on such a network
      // silently loses message badges and "your class is starting" alerts, with
      // no error anywhere to explain why.
      enabledTransports: ["ws", "wss", "xhr_streaming", "xhr_polling", "sockjs"],
      auth: {
        headers: { "Content-Type": "application/json" },
      },
    })
  }
  return _client
}
