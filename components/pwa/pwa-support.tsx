"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Download, Share, Bell, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isIOS, isStandalone, usePhoneNotifications } from "@/hooks/use-phone-notifications"

/**
 * Mounted once in the dashboard layout. Registers the service worker
 * (public/sw.js) and, on phone widths only, shows one small dismissible strip:
 *
 *   Android / Chrome — "Install app" button (the browser's own install prompt)
 *   iPhone / iPad    — "Tap Share → Add to Home Screen" (Safari has no prompt)
 *   Installed app    — once: "Turn on notifications?"
 *
 * Never shown in a live class or on Messages, never once dismissed.
 */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const DISMISS_INSTALL = "tms-install-dismissed"
const DISMISS_PUSH = "tms-push-offer-dismissed"

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === "1" } catch { return false }
}
function writeFlag(key: string) {
  try { localStorage.setItem(key, "1") } catch { /* private mode — just hide for now */ }
}

export function PwaSupport() {
  const pathname = usePathname() ?? ""
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)
  const [mode, setMode] = useState<"none" | "android" | "ios" | "push">("none")
  const [pushDismissed, setPushDismissed] = useState(false)
  const push = usePhoneNotifications()

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("[pwa] service worker not registered", err))
    }

    if (isStandalone()) return // already installed — the push offer below takes over
    if (readFlag(DISMISS_INSTALL)) return

    const onPrompt = (e: Event) => {
      e.preventDefault() // keep Chrome's own mini-bar away; ours is quieter
      setInstallEvent(e as InstallPromptEvent)
      setMode("android")
    }
    const onInstalled = () => { setInstallEvent(null); setMode("none") }
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    // Safari on iOS never fires beforeinstallprompt; show the manual hint
    if (isIOS()) queueMicrotask(() => setMode("ios"))
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  // Running as the installed app with notifications not yet decided → offer once
  const offerPush = mode === "none" && push.state === "off" && isStandalone() &&
    typeof Notification !== "undefined" && Notification.permission === "default" && !pushDismissed && !readFlag(DISMISS_PUSH)

  const shown = offerPush ? "push" : mode
  const hiddenHere = /^\/(student|tutor)\/(classroom\/[^/]+|messages)/.test(pathname)
  if (shown === "none" || hiddenHere) return null

  function dismiss() {
    writeFlag(shown === "push" ? DISMISS_PUSH : DISMISS_INSTALL)
    if (shown === "push") setPushDismissed(true)
    setMode("none")
    setInstallEvent(null)
  }

  async function install() {
    if (!installEvent) return
    await installEvent.prompt()
    await installEvent.userChoice.catch(() => null)
    setInstallEvent(null)
    setMode("none")
  }

  return (
    // Bottom-left, clear of the round Feedback button on the right
    <div className="md:hidden fixed bottom-6 left-3 right-20 z-40 flex items-center gap-2 rounded-xl border bg-background/95 backdrop-blur px-3 py-2 shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-200">
      {shown === "android" && (
        <>
          <Download className="size-4 text-primary shrink-0" />
          <span className="text-sm font-medium flex-1 min-w-0 truncate">Get the app</span>
          <Button size="sm" onClick={() => void install()}>Install</Button>
        </>
      )}
      {shown === "ios" && (
        <>
          <Share className="size-4 text-primary shrink-0" />
          <span className="text-sm flex-1 min-w-0 leading-snug">Tap <b>Share</b> → <b>Add to Home Screen</b></span>
        </>
      )}
      {shown === "push" && (
        <>
          <Bell className="size-4 text-primary shrink-0" />
          <span className="text-sm font-medium flex-1 min-w-0 truncate">Class reminders?</span>
          <Button size="sm" disabled={push.busy} onClick={() => void push.enable().then(() => writeFlag(DISMISS_PUSH))}>Turn on</Button>
        </>
      )}
      <button onClick={dismiss} aria-label="Dismiss" className="p-1 -mr-1 text-muted-foreground hover:text-foreground shrink-0">
        <X className="size-4" />
      </button>
    </div>
  )
}
