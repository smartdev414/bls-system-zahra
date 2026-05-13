// Shared key + helpers for persisting the user's background-blur preference
// across the pre-join lobby and the live classroom. When the lobby toggle is
// flipped on, ClassroomRoom reads this on mount and auto-applies the processor
// as soon as the local camera track publishes — so the user doesn't have to
// click the blur button again after joining.

export const BLUR_PREF_KEY = "classroom:blur"

export function readBlurPreference(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(BLUR_PREF_KEY) === "1"
  } catch {
    return false
  }
}

export function writeBlurPreference(enabled: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(BLUR_PREF_KEY, enabled ? "1" : "0")
  } catch {
    // Private mode / quota — ignore. The preference simply won't persist.
  }
}
