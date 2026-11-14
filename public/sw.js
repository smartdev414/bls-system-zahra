/*
 * DeafSign service worker.
 *
 * Deliberately tiny. It exists so the site can be installed to a phone's home
 * screen and receive web push. It does NOT cache pages, assets or API
 * responses: this is a live classroom and a stale page would break it. The
 * only thing it adds to navigation is a small "you're offline" page when the
 * network is down, built in memory — nothing is stored.
 *
 * Push payloads are JSON sent by lib/push.ts: { title, body, url, tag }.
 */

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · DeafSign</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;background:#f7f5fc;color:#1f1633;text-align:center;padding:16px}
  button{margin-top:16px;padding:10px 20px;border:0;border-radius:10px;background:#6e41db;color:#fff;font-size:15px}
  @media (prefers-color-scheme:dark){body{background:#151020;color:#eee}}
</style></head>
<body><div><h1 style="font-size:20px;margin:0 0 6px">You're offline</h1>
<p style="margin:0;opacity:.75">Check your connection, then try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`

self.addEventListener("fetch", (event) => {
  // Only page loads, and only to catch a network failure. Everything else goes
  // straight to the network untouched.
  if (event.request.mode !== "navigate") return
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }),
    ),
  )
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : "" }
  }
  const title = data.title || "DeafSign"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href

  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      // Already open on that page → just bring it forward
      const exact = tabs.find((c) => c.url === target)
      if (exact) return exact.focus()
      // Any open tab of ours → reuse it rather than stacking windows — but never
      // pull someone out of a live class; open a new window for that instead.
      const ours = tabs.find((c) => {
        const u = new URL(c.url)
        return u.origin === self.location.origin && !u.pathname.includes("/classroom")
      })
      if (ours) {
        await ours.focus()
        return ours.navigate(target).catch(() => self.clients.openWindow(target))
      }
      return self.clients.openWindow(target)
    })(),
  )
})
