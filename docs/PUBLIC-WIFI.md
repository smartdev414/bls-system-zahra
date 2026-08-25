# Cafés, hotels, trains and other public Wi-Fi

**Short answer: yes — and the freezing you hit was real, was ours, and is
fixed.** This document explains what was actually going wrong, what the platform
now does about it, and what to tell a student who is struggling in a coffee
shop.

This is a different problem from [SECURE-NETWORKS.md](./SECURE-NETWORKS.md),
which covers NHS, police, school and corporate networks. Those networks *block*
things, consistently and deliberately, and the answer is a route around the
block. Public Wi-Fi blocks almost nothing. It works, then it doesn't, then it
does — and the platform's job is to survive that without the student ever being
in doubt about what is happening.

---

## 1. Why it froze

Four causes, in rough order of how often they bit.

### No request ever timed out

`fetch()` in a browser has **no timeout**. If a network accepts a connection and
then delivers nothing — the signature behaviour of a congested café access point
— the promise simply never settles. Chrome's own limit is minutes.

Nothing in the app crashed. It just stopped: spinners kept turning, buttons
stayed disabled, panels stayed empty. That is the freeze. And it could not
self-correct, because the retry that would have fixed it was waiting on the
request that never finished.

Every request the app makes now has a deadline (`lib/net-fetch.ts`). A stalled
request fails in seconds with a message, instead of hanging forever with a
spinner.

### Polls piled up behind each other

The classroom polled every 8 seconds. The notification bell every 30. Sessions
every 5 while a recording processed. None of them checked whether the previous
request had come back.

On a stalled link that means eight requests in flight after a minute — and
browsers allow only six connections per host. So the polls nobody was looking at
filled the queue, and the request the student *was* waiting for sat behind them.
One dead poll froze the whole page.

Polling now runs one-at-a-time, pauses while the tab is hidden or the link is
down, and catches up immediately when either clears (`hooks/use-poll.ts`).

### Captive portals were invisible

A café portal doesn't refuse requests. It answers them — confidently, with
`200 OK` and a login page — in our place. Every reachability check passes. The
app then tries to read JSON, gets HTML, and throws a parse error somewhere
completely unrelated to Wi-Fi.

The student sees nonsense and blames the platform. The actual fix takes ten
seconds and happens in a different tab.

Portals are now detected explicitly and named: *"This Wi-Fi needs you to sign in
first."*

### A wobble was treated as a blocked network

This one was our own good idea misfiring. The student classroom escalates
through network modes on a connection error — standard → restricted → minimal —
because on a hospital network a failed connection is evidence about the
firewall.

On café Wi-Fi it is evidence of nothing except that the link blinked. The
student was walked through all three modes in a few seconds, none of which could
work while the link was down, and landed on **"this network is blocking the
classroom"** — which was false, unhelpful and, for someone already stressed
about missing a lesson, demoralising.

Worse: if a retry then happened to land while in Minimal, that mode was *saved
to the device*. One bad afternoon in a café meant every future lesson ran at
320×180 through a relay.

The first dropped connection attempt of a visit now gets one retry on the path
already chosen before any escalation, and there is no escalation at all while the
link is provably down. That retry is budgeted per visit, not per mode — so a
genuinely blocked NHS or police network reaches its verdict exactly one attempt
later than before, rather than one per rung.

---

## 2. What the platform now does

### It tells you the truth, at the top of the screen

`components/connection/ConnectionStatusBanner.tsx`, mounted in the dashboard
layout so it sits above everything including the classroom.

| State | What the student sees |
|---|---|
| One failed request | *Nothing.* A single drop happens several times an hour on a shared line and recovers before anyone notices. A banner that flickers is a banner people stop reading. |
| Link down | "You're offline. We're trying to reconnect. Nothing you've typed is lost — please don't reload." |
| Captive portal | "This Wi-Fi needs you to sign in. Open a new tab, load any website, finish the Wi-Fi login, then come back." |

It clears itself. `lib/network-health.ts` runs a recovery probe on a backoff —
1.5s, 3s, 6s, 12s, 20s, 30s — plus an immediate recheck when the browser fires
`online` or when the student returns to the tab. Nobody has to press anything.

### It doesn't end the class over a dropped link

Previously, when LiveKit exhausted its own reconnect budget, the student went to
"Connection lost" and the tutor was **navigated straight out of their own
lesson**. A forty-second outage in a café ended the class for everyone in it.

Now, if the link is what failed:

- **Students** get "Waiting for your internet" — the visit is held open, and
  they are put back into the room automatically when the connection returns.
  Up to three automatic recoveries, so a flapping link doesn't loop them in and
  out forever.
- **Tutors** get the same, with the point made explicitly: *your class is still
  running and your students are still in it.* The page holds; it does not
  navigate away.

Chat history, the raised hand and breakout membership all re-hydrate on
reconnect, which is why both screens say plainly: **don't reload.** A reload is
the one action that actually loses something.

### It explains a frozen picture

`components/classroom/room/ConnectionBanner.tsx`.

LiveKit reconnects well, but silently. Between the drop and the recovery the
room stays mounted and the last video frame stays on screen. In a spoken class
you'd hear the silence. **In a BSL class the frozen hand is the content**, so
there is no way at all to tell a dropped link from a tutor who paused.

So the classroom now says "Reconnecting…", counts the seconds, and says not to
reload. The count is there because "Reconnecting…" alone gives no sense of
whether to wait or to give up; watching it climb past thirty is what tells
someone to switch to their phone's hotspot.

### It reduces quality by itself before the picture breaks up

When the local connection quality stays Poor or Lost for 12 continuous seconds,
the classroom caps the student's **outgoing** video at the lowest simulcast
layer and tells them it has done so.

Twelve seconds, not two: a lift, a microwave or someone starting a download on
the same café line all cause shorter dips, and a lesson that oscillates between
soft and sharp is worse than one that settles.

It caps the *upstream* because the downstream was already handled —
`adaptiveStream` and `dynacast` only pull the resolution each tile actually
displays. Upstream is where a shared café line is thinnest.

It uses `setPublishingQuality` rather than restarting the capture, so the
picture softens instead of dropping out for a second or two mid-sentence. And it
is one-way: it does not step back up on its own, because flapping quality is
what it exists to prevent.

### The connection check measures steadiness, not just reachability

`/student/connection-check` and `/tutor/connection-check` gained a **Connection
steadiness** row.

Every other check there answers a yes/no question — can we reach the signal
server, does UDP get out, is the storage host allowed. A café connection passes
all of them and still fails a lesson, because what it actually does is work,
then not work, then work again. That is invisible to a single request and
obvious over ten seconds of them.

Six small uncached requests, timed. Three numbers come out: how many never
arrived, how long a round trip takes, and how much that varies. **The third is
the one that matters.** A steady 300ms link carries a class fine; a link
swinging between 40ms and 900ms freezes, because the jitter buffer must choose
between adding delay and dropping frames — and dropped frames are what destroy
fingerspelling.

New verdicts:

- **"Sign in to this Wi-Fi first"** — a portal is answering in our place, so
  every other result on the page is a measurement of the portal, not the
  network. This verdict outranks all others.
- **"This connection is too unsteady for a live class"** — everything is
  reachable and it will still fail.
- **"Ready for class — but keep an eye on the connection"** — it will work, with
  soft patches.

Thresholds are deliberately forgiving: this measures an HTTPS round trip through
whatever proxy is in the way, not raw latency, so a healthy home line commonly
reads 150–300ms. The aim is to separate "unremarkable" from "this will visibly
break", not to grade connections.

---

## 3. What we deliberately did not do

- **No new network mode for cafés.** Restricted and Minimal both force
  `iceTransportPolicy: "relay"`, which is right for a firewall and *wrong* for a
  café: public Wi-Fi rarely blocks UDP, so relaying only adds a hop and latency
  to a link that is already short of both. The café answer is adaptive quality
  at runtime, not a mode the student has to know to pick.
- **No audio-only fallback.** Unchanged and non-negotiable. This is a BSL
  classroom; video is the lesson. Savings come from resolution, never from
  dropping the picture.
- **No retry on writes.** Reads retry once — they're safe to replay. Mutations
  never do: a POST whose response was merely slow has very often already been
  applied, and replaying it enrols a student twice or triple-posts a chat
  message.
- **No banner for a single failed request.** See above — it would fire several
  times an hour on any café line and be ignored by the time it mattered.

---

## 4. Supporting a student in a café

1. **Is there a banner?** If it says *sign in to this Wi-Fi*, that's the whole
   problem: new tab, load any website, complete the login, come back. No reload
   needed.
2. **Did they reload during an outage?** That's the one thing that loses work.
   The recovery is automatic; the screen says so. Worth saying again.
3. **Run `/student/connection-check` on the café Wi-Fi, in the café.** Testing
   at home measures the wrong network. Read the **Connection steadiness** row —
   it's the one that predicts whether a lesson will hold.
4. **If steadiness fails: a phone hotspot is very often better than café
   Wi-Fi.** Counter-intuitive but reliably true. A 4G/5G link is not shared with
   thirty other people and does not go through a portal. This is the single most
   useful thing to tell a student in a coffee shop.
5. **If they must stay on it:** sit nearer the router, close other tabs and
   devices on the same connection, and expect the classroom to reduce their
   video quality by itself — it will say when it does.

### Reading the symptoms

| What they report | What it is |
|---|---|
| "Nothing loads, no error" | Was an untimed request. Should now show the offline banner instead. |
| "It logged me out" / "pages look wrong" | Captive portal. Now named explicitly. |
| "Video froze but the chat worked" | Media path degraded while the data channel held. The reconnect banner now says so. |
| "It threw me out of class" | Link dropped. Now held open and recovered automatically. |
| "It said my network was blocking the classroom" | The old escalation ladder misreading a wobble. Fixed — it retries the same path first now. |
| "It's been in Minimal ever since" | A mode saved from an escalation that shouldn't have happened. Reset it on `/student/connection-check`. |

---

## 5. Where this lives

| File | What it does |
|---|---|
| `lib/net-fetch.ts` | Every request, with a deadline and a diagnosis. |
| `lib/network-health.ts` | One status for the link; recovery probe; captive-portal detection. |
| `hooks/use-poll.ts` | Polling that doesn't stack up, sleeps when hidden, catches up on return. |
| `hooks/use-network-health.ts` | React binding for the status. |
| `components/connection/ConnectionStatusBanner.tsx` | The global bar. |
| `components/classroom/room/ConnectionBanner.tsx` | In-class reconnect notice and quality downshift. |
| `lib/connectivity-check.ts` | The steadiness check and the new verdicts. |
