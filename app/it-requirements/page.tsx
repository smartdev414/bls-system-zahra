import Link from "next/link"
import { ShieldCheck, Lock, Printer, ArrowLeft } from "lucide-react"
import { appHost, networkRequirements, CLIENT_REQUIREMENTS } from "@/lib/network-requirements"

/**
 * The page a student sends to their employer's IT or information-security team.
 *
 * Public on purpose: the person who has to approve the exception has no account
 * here and never will. Requiring a login is the difference between an exception
 * that gets granted and a student who quietly drops out of the course.
 *
 * The content is generated from this deployment's own configuration, so it
 * cannot drift out of date when the region, bucket or LiveKit project changes.
 */

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Network requirements for IT teams · BSL Learning Platform",
  description:
    "Hosts, ports and protocols required for the BSL Learning Platform's live classroom, for network and security teams.",
}

export default function ItRequirementsPage() {
  const host = appHost()
  const reqs = networkRequirements()
  const essential = reqs.filter((r) => r.essential)
  const optional = reqs.filter((r) => !r.essential)

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10 print:py-0">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Back to the platform
        </Link>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Printer className="size-3.5" /> Use your browser&apos;s print or &ldquo;Save as PDF&rdquo; to attach this to a ticket.
        </p>
      </div>

      <header className="mt-6">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
          <ShieldCheck className="size-3.5" /> For network &amp; information-security teams
        </p>
        <h1 className="mt-3 text-3xl font-black leading-tight">Network requirements</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          BSL Learning Platform — live British Sign Language classes delivered in the browser.
          {host && <> Platform address: <span className="font-mono font-medium text-foreground">{host}</span>.</>}
        </p>
      </header>

      {/* ── The short version ── */}
      <section className="mt-8 rounded-2xl border bg-muted/30 p-5">
        <h2 className="text-sm font-black">The short version</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">Nothing is installed.</span> The platform runs
            entirely in a standard browser. No plugin, extension, agent or admin rights.
          </li>
          <li>
            <span className="font-semibold text-foreground">No inbound connections.</span> Every connection is
            outbound from the user&apos;s browser. Nothing listens on the workstation and no port forwarding
            or NAT change is required.
          </li>
          <li>
            <span className="font-semibold text-foreground">Port 443 is enough.</span> Live video prefers UDP for
            quality, but the platform includes a <span className="font-semibold text-foreground">Restricted network mode</span>{" "}
            that relays all media over TLS on TCP 443. If opening UDP is not acceptable on your network,
            it does not need to be opened — see below.
          </li>
          <li>
            <span className="font-semibold text-foreground">Everything is encrypted in transit.</span> HTTPS/TLS for
            web traffic and DTLS-SRTP for live audio and video, which is the standard browser WebRTC stack.
          </li>
        </ul>
      </section>

      {/* ── Required ── */}
      <section className="mt-8">
        <h2 className="text-lg font-black">Required destinations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Allow outbound access from user workstations to the following. All are TLS-encrypted.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-semibold">Host</th>
                <th className="py-2 pr-4 font-semibold">Ports / protocol</th>
                <th className="py-2 font-semibold">What it is used for</th>
              </tr>
            </thead>
            <tbody>
              {essential.map((r, i) => (
                <tr key={`${r.host}-${i}`} className="border-b align-top">
                  <td className="py-3 pr-4 font-mono text-xs">{r.host}</td>
                  <td className="py-3 pr-4 text-xs">{r.ports}</td>
                  <td className="py-3 text-xs text-muted-foreground">
                    <span className="text-foreground">{r.purpose}</span>
                    {r.notes && <span className="mt-1 block">{r.notes}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Optional ── */}
      {optional.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-black">Optional destinations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Class works without these. Blocking them degrades convenience only.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4 font-semibold">Host</th>
                  <th className="py-2 pr-4 font-semibold">Ports / protocol</th>
                  <th className="py-2 font-semibold">What it is used for</th>
                </tr>
              </thead>
              <tbody>
                {optional.map((r, i) => (
                  <tr key={`${r.host}-${i}`} className="border-b align-top">
                    <td className="py-3 pr-4 font-mono text-xs">{r.host}</td>
                    <td className="py-3 pr-4 text-xs">{r.ports}</td>
                    <td className="py-3 text-xs text-muted-foreground">
                      <span className="text-foreground">{r.purpose}</span>
                      {r.notes && <span className="mt-1 block">{r.notes}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── If UDP can't be opened ── */}
      <section className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-black">
          <Lock className="size-4 text-primary" /> If outbound UDP cannot be opened
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That is a common and reasonable policy, and it is supported. The user turns on{" "}
          <span className="font-semibold text-foreground">Restricted network mode</span> in the platform
          (Classroom → Connection check), and every media packet is then relayed over TLS on TCP 443 to
          the same hosts listed above. From the network&apos;s point of view it is an ordinary long-lived
          HTTPS connection.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Two things still matter on the HTTPS path:
        </p>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">WebSocket upgrades must be permitted</span> to the
            classroom host. Some web filters allow HTTPS but strip the <span className="font-mono text-xs">Upgrade</span> header,
            which prevents joining entirely.
          </li>
          <li>
            <span className="font-medium text-foreground">Connections must be allowed to stay open</span> for the
            length of a class (up to two hours). Proxies that time out idle-looking sockets will drop users mid-lesson.
          </li>
        </ul>
      </section>

      {/* ── Workstation ── */}
      <section className="mt-8">
        <h2 className="text-lg font-black">Workstation requirements</h2>
        <dl className="mt-4 flex flex-col gap-4">
          {CLIENT_REQUIREMENTS.map((c) => (
            <div key={c.title}>
              <dt className="text-sm font-semibold">{c.title}</dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">{c.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Data ── */}
      <section className="mt-8 rounded-2xl border p-5">
        <h2 className="text-sm font-black">Data handling, in brief</h2>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
          <li>Live audio and video are encrypted in transit (DTLS-SRTP) and are not written to the workstation.</li>
          <li>
            Sessions are recorded only when the tutor explicitly starts a recording, and participants can see
            that a recording is running.
          </li>
          <li>
            Nothing on the workstation is scanned, enumerated or uploaded. The camera and microphone are used
            only while the user has them switched on, and only within a class.
          </li>
          <li>Screen sharing is browser-native and always initiated by the user, who chooses what to share.</li>
        </ul>
      </section>

      <section className="mt-8 rounded-2xl border bg-muted/30 p-5">
        <h2 className="text-sm font-black">Verifying the change</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          After making a change, the user can confirm it from the affected workstation: sign in and open{" "}
          <span className="font-mono text-xs">/student/connection-check</span>. That page makes a real
          connection to the classroom servers and reports precisely which parts succeeded, with a copyable
          log to attach to the ticket.
        </p>
      </section>

      <footer className="mt-10 border-t pt-5 text-xs text-muted-foreground">
        Generated from this deployment&apos;s live configuration
        {host && <> — <span className="font-mono">{host}</span></>}. If a host below does not match what you
        see in your logs, this page is the authoritative version.
      </footer>
    </main>
  )
}
