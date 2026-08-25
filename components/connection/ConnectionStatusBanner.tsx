"use client"

/**
 * The one place the app admits the network is misbehaving.
 *
 * Public Wi-Fi fails in ways that look, from inside the page, exactly like the
 * app being broken: a button that does nothing, a list that never loads, a
 * video that stops moving. Without a banner the student's only evidence is that
 * our software is bad, and their only move is to reload — which on a captive
 * portal or a dead link makes things worse, because it discards everything the
 * page was holding.
 *
 * So one bar, at the top, above everything including the classroom, saying
 * which of the three things is happening and what to do about it. It appears
 * only when something is actually wrong, and it disappears by itself when the
 * link returns — the recovery probe lives in `lib/network-health.ts` and needs
 * no help from the user.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CloudOff, RefreshCw, Wifi, WifiOff, Loader2 } from "lucide-react"
import { useNetworkHealth } from "@/hooks/use-network-health"
import { probeNetworkNow } from "@/lib/network-health"
import { cn } from "@/lib/utils"

export function ConnectionStatusBanner() {
  const { status, probing } = useNetworkHealth()
  const pathname = usePathname()

  // The diagnostics page lives under each role's own tree; admin and support
  // have none, so they get the public requirements page instead.
  const checkHref =
    pathname?.startsWith("/tutor") ? "/tutor/connection-check"
      : pathname?.startsWith("/student") ? "/student/connection-check"
        : "/it-requirements"

  if (status === "online") return null

  // "unstable" is one failed request. Saying nothing yet is deliberate: on a
  // shared café line a single drop happens several times an hour and recovers
  // before anyone notices, and a bar that flickers in and out trains people to
  // ignore it by the time it matters.
  if (status === "unstable") return null

  const portal = status === "captive-portal"

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-x-3 gap-y-1",
        "px-4 py-2 text-sm font-medium shadow-lg",
        portal
          ? "bg-amber-500 text-amber-950"
          : "bg-destructive text-destructive-foreground",
      )}
    >
      <span className="flex items-center gap-2">
        {portal ? <Wifi className="size-4 shrink-0" /> : <WifiOff className="size-4 shrink-0" />}
        {portal ? (
          <span>
            <strong>This Wi-Fi needs you to sign in.</strong>{" "}
            Open a new tab, load any website, finish the Wi-Fi login, then come back — you don&apos;t need to reload this page.
          </span>
        ) : (
          <span>
            <strong>You&apos;re offline.</strong>{" "}
            We&apos;re trying to reconnect. Nothing you&apos;ve typed is lost — please don&apos;t reload.
          </span>
        )}
      </span>

      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={probeNetworkNow}
          disabled={probing}
          className="inline-flex items-center gap-1.5 rounded-md bg-black/15 px-2 py-1 text-xs font-semibold hover:bg-black/25 disabled:opacity-60"
        >
          {probing
            ? <><Loader2 className="size-3 animate-spin" /> Checking…</>
            : <><RefreshCw className="size-3" /> Try now</>}
        </button>
        <Link
          href={checkHref}
          className="inline-flex items-center gap-1.5 rounded-md bg-black/15 px-2 py-1 text-xs font-semibold hover:bg-black/25"
        >
          <CloudOff className="size-3" />
          Test my connection
        </Link>
      </span>
    </div>
  )
}
