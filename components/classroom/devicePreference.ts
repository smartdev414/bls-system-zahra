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
