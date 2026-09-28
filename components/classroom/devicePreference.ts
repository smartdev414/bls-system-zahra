import { MediaDeviceFailure } from "livekit-client"

// Carries the lobby's camera / mic choice into the room it connects.
//
// The lobby toggles used to drive only the preview: the room was mounted with
// fixed `video` / `audio` props, so a student who switched their camera on to
// be seen signing joined with it off, and a tutor who switched theirs off
// joined on camera anyway. The in-room toggles write here too, so a reload —
// including the tutor's "Refresh all" — comes back the way the person left it.
//
// Per tab (sessionStorage), not per device: each lobby writes its current
// state on mount, so a fresh lesson always starts from what the lobby shows.

export type DeviceKind = "camera" | "mic"

const key = (kind: DeviceKind) => `classroom:device:${kind}`

export function readDevicePreference(kind: DeviceKind, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback
  try {
    const v = window.sessionStorage.getItem(key(kind))
    return v === null ? fallback : v === "1"
  } catch {
    return fallback
  }
}

export function writeDevicePreference(kind: DeviceKind, enabled: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(key(kind), enabled ? "1" : "0")
  } catch {
    // Private mode / storage disabled — the room falls back to its default.
  }
}

/**
 * What to tell someone whose camera or mic wouldn't start. The toggle used to
 * swallow the error, so a student whose webcam was held by Teams or Zoom — or
 * blocked in the browser — just saw a black self-view and no reason why.
 */
export function mediaFailureMessage(
  error: unknown,
  kind: DeviceKind,
): string {
  const device = kind === "camera" ? "camera" : "microphone"
  // Accepts either a raw getUserMedia error or the already-classified failure
  // that `LiveKitRoom`'s onMediaDeviceFailure hands over.
  const failure = Object.values(MediaDeviceFailure).includes(error as MediaDeviceFailure)
    ? (error as MediaDeviceFailure)
    : MediaDeviceFailure.getFailure(error)
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return `Your browser is blocking the ${device}. Click the camera icon in the address bar, allow it, then try again.`
    case MediaDeviceFailure.NotFound:
      return `No ${device} was found. Check it is plugged in, then try again.`
    case MediaDeviceFailure.DeviceInUse:
      return `Your ${device} is being used by another app (Teams, Zoom, another browser tab). Close it, then try again.`
    default:
      return `Your ${device} couldn't start. Try again, or refresh the page.`
  }
}
