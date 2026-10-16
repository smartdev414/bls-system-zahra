"use client"

import { Bell, BellOff, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePhoneNotifications } from "@/hooks/use-phone-notifications"

// The "Phone notifications" card on the student and tutor settings pages.
// One button: it asks the browser for permission and subscribes this device.
// Everything the app already notifies about (class starting, messages,
// reviews…) then also arrives on the lock screen.

const HINT: Record<string, string> = {
  "needs-install": "On iPhone and iPad, first add this site to your Home Screen (tap Share → Add to Home Screen), then open it from there.",
  unsupported: "This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.",
  blocked: "Notifications are blocked for this site. Allow them in your browser's site settings, then come back.",
}

export function PhoneNotificationsCard() {
  const { state, busy, enable, disable } = usePhoneNotifications()
  const on = state === "on"

  return (
    <div className="rounded-2xl border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            {on ? <Bell className="size-5" /> : <BellOff className="size-5" />}
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold">Phone notifications</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {on
                ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-emerald-600" />On for this device.</span>
                : "Get class reminders and messages on this device, even when the site is closed."}
            </p>
          </div>
        </div>

        {(state === "off" || state === "on" || state === "loading") && (
          <Button
            variant={on ? "outline" : "default"}
            disabled={busy || state === "loading"}
            onClick={() => void (on ? disable() : enable())}
            className="shrink-0 max-sm:w-full"
          >
            {(busy || state === "loading") && <Loader2 className="size-4 animate-spin" />}
            {on ? "Turn off" : "Turn on"}
          </Button>
        )}
      </div>

      {HINT[state] && <p className="text-sm text-muted-foreground mt-4 rounded-lg bg-muted/60 px-3 py-2.5">{HINT[state]}</p>}
    </div>
  )
}
