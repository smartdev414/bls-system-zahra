# Students on secure / locked-down networks

Some students attend class from an NHS trust, a police force, a school, a
council office or a corporate VPN. Those networks are managed by someone else
and routinely do things that break video calling:

| What the network does | What it breaks | What we do about it |
|---|---|---|
| Blocks all outbound UDP | WebRTC media never connects | **Restricted network mode** relays media over TLS on TCP 443 |
| Allows only ports 80/443 | Media on high UDP ports | Same — TURN listens on 443 |
| TLS-inspecting proxy strips `Upgrade` | Joining a class at all | Diagnosed explicitly by the connection check; needs an IT exception |
| Proxy kills idle-looking sockets | Students dropped mid-lesson | Documented for IT; LiveKit's own reconnect handles brief drops |
| Blocks WebSockets for notifications | Message badges, "class starting" alerts | Pusher falls back to HTTP polling automatically |
| Caps or shares bandwidth | Stuttering video | **Minimal data** mode |
| Camera disabled by policy | Being seen signing | Student can still attend, watch, read captions and chat |
| Site data / storage disabled | Restoring a draft after reload | Everything degrades gracefully; server copies still arrive |

**Short answer for a prospective student: yes, it will work — and if it doesn't,
the platform tells them precisely what to ask IT for.**

> **Café, hotel, train and airport Wi-Fi is a different problem** — those
> networks block almost nothing, they simply stop working and start again.
> See [PUBLIC-WIFI.md](./PUBLIC-WIFI.md). Note in particular that the network
> modes below are the *wrong* tool there: both restricted modes force a relay,
> which on public Wi-Fi only adds a hop to a link that is already short of
> latency.

---

## 1. Network modes

Defined in `lib/network-mode.ts`. Stored **per device**, in `localStorage`, not
on the user record — the restriction belongs to the hospital PC, not the person.
The same student at home gets full quality automatically.

| Mode | ICE policy | Video | Use when |
|---|---|---|---|
| `standard` | default (direct if possible) | full | normal networks |
| `restricted` | `relay` only — TURN over TLS/443 | 640×360 @24 | UDP blocked, or only 443 open |
| `minimal` | `relay` only | 320×180 @15, single layer | capped, shared or metered lines |

Two deliberate choices:

- **No audio-only mode.** This is a British Sign Language classroom. Video *is*
  the lesson. Savings come from resolution, never from dropping the picture.
- **`degradationPreference: "maintain-framerate"`.** When bandwidth runs short
  WebRTC must give up sharpness or smoothness. Fingerspelling survives a soft
  picture far better than it survives dropped frames.

Also raised in the restricted modes: `peerConnectionTimeout` and
`websocketTimeout` go from 15s to 30s, and `maxRetries` to 3. An inspecting
proxy adds a round trip to every step; failing at 15s on a network that would
have connected at 22s is the most common "it just doesn't work here" report.

### Setting a mode

- The student picks one in the classroom lobby, or on the connection-check page.
- Support can send a pre-set link: `…/student/classroom/<id>?network=restricted`.
  The mode is applied *and* persisted, so the link only has to be clicked once.
- The student classroom **escalates automatically** on a connection error:
  standard → restricted → minimal, with a fresh token each time, and only
  persists a mode once it has actually carried a connection. When every mode
  fails it shows a "this network is blocking the classroom" screen that points
  at the diagnostics — never "check your internet connection", which is both
  wrong and demoralising in this situation.
- The tutor classroom honours a stored mode but does **not** auto-escalate: that
  page navigates away on disconnect, and silently rebuilding the room under a
  host who is mid-lesson would be more disruptive than helpful.

---

## 2. The connection check

`/student/connection-check` (and `/tutor/connection-check`) —
`components/connection/ConnectionCheckPanel.tsx`, engine in
`lib/connectivity-check.ts`.

It makes **real connections to the real media servers**, using a throwaway room
minted by `POST /api/connectivity/token`. That matters: a TLS-inspecting proxy
will happily answer an HTTPS ping and then refuse the WebSocket upgrade, and a
firewall will pass the WebSocket and then silently drop the UDP media. Both look
fine to a synthetic reachability test.

Checks run in order:

1. **Browser support** — WebRTC, WebSockets, secure context, site storage.
2. **Platform reachable** — `/api/health`.
3. **Classroom connection** — LiveKit signalling (the WebSocket upgrade).
4. **Live video path** — a full WebRTC connection on the default path. ICE
   candidate logs are scanned for a public UDP candidate; a definite "no UDP"
   is what recommends Restricted mode even when the default path did connect.
5. **Secure-network fallback** — a relay-only connection, i.e. exactly what
   Restricted mode does.
6. **Staying connected** — reconnect after a simulated drop.
7. **Camera and microphone** — presence and permission. A missing or
   policy-blocked camera is a *warning*, never a failure: a student can attend,
   watch, read live captions and use chat without one.
8. **Lesson materials** — the S3 host.
9. **Messages and alerts** — Pusher. A warning, not a failure — class works
   without it.

Plus **Connection steadiness**, which runs immediately after the platform check:
a burst of small timed requests measuring loss, round-trip time and — the number
that decides whether live video holds — how much that round trip varies. It is
what catches a connection that is perfectly reachable and still unusable. See
[PUBLIC-WIFI.md](./PUBLIC-WIFI.md).

The verdict is one of: ready for class · use Restricted mode · use Minimal data ·
network is blocking us. Where a mode would fix it, the page offers a button that
applies it.

**Cost note:** each LiveKit check opens a short real connection to a scratch
room (`netcheck-<userId>-<random>`, 5-minute token, unique identity per run).
That is a handful of connection-seconds per run, billed like any other room.

---

## 3. The IT requirements page

`/it-requirements` — **public, no login**. This is deliberate and load-bearing:
the person who approves a firewall exception has no account here and never will.
Requiring a login is the difference between an exception being granted and a
student quietly dropping out.

Generated from `lib/network-requirements.ts`, which reads this deployment's own
env, so it cannot drift when the region, bucket or LiveKit project changes. It
covers required and optional destinations, the "if you can't open UDP" answer,
workstation requirements, and a short data-handling section — the questions an
NHS or police information-governance reviewer actually asks.

It is linked from the site footer, from the connection check, and from the
blocked-classroom screen.

---

## 4. Supporting a student who can't get in

1. Ask them to open `/student/connection-check` **on the computer they'll use
   for class** — not their phone, not at home. The whole point is the network
   they're sitting on.
2. Read the verdict. If it recommends a mode, have them press the button.
3. If it says the network is blocking us, have them press **Copy test report**
   and send it with the `/it-requirements` link to their service desk.
4. The single most useful thing to tell IT: *we do not need UDP opened.* Most
   refusals are about opening UDP ranges. Restricted network mode removes that
   from the conversation entirely — it is TLS on 443 to hosts they can allowlist.

Common outcomes:

- **Signalling fails, everything else passes** → a web filter is stripping the
  WebSocket upgrade. IT must allow WebSocket upgrades to the LiveKit host.
- **Signalling passes, both video paths fail** → the TURN hosts are blocked.
  IT must allowlist `*.livekit.cloud` on TCP 443.
- **Everything passes but students drop out every few minutes** → a proxy is
  timing out long-lived connections. Classes run up to two hours.
- **Everything passes but the steadiness row warns or fails** → not a firewall
  at all. That is a congested or shared link; see [PUBLIC-WIFI.md](./PUBLIC-WIFI.md).
- **Materials fail, class works** → the S3 host is blocked; allowlist it.
- **Camera warning only** → nothing to fix at the network level. Confirm with
  the tutor whether that session requires the student to be seen.
