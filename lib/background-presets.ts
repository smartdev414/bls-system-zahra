/**
 * Colours offered for the background behind a signer — in the recorder, where
 * the camera's room is replaced live or after upload, and in the library,
 * where an uploaded video can be given a new background the same way.
 */
export const BACKGROUND_PRESETS = [
  { label: "White", value: "#ffffff" },
  { label: "Light grey", value: "#d1d5db" },
  { label: "Dark grey", value: "#374151" },
  { label: "Black", value: "#000000" },
  { label: "Blue", value: "#1e40af" },
  { label: "Green", value: "#166534" },
] as const

export const BACKGROUND_COLOR_RE = /^#[0-9a-f]{6}$/i

/**
 * Pictures that can stand in for a colour, named by their path under /public.
 * Only these are accepted, because the background worker downloads whatever
 * is named. `average` is used wherever a single colour is needed instead.
 */
export const BACKGROUND_IMAGES = [
  // The blue every dictionary sign is filmed against, old and new.
  { label: "Dictionary blue", value: "/course_background.png", average: "#02457a" },
] as const

export const DICTIONARY_BACKGROUND = BACKGROUND_IMAGES[0].value

export function backgroundImage(value: string | null | undefined) {
  return BACKGROUND_IMAGES.find((image) => image.value === value) ?? null
}

/** A colour (`#rrggbb`) or one of the BACKGROUND_IMAGES. */
export function isBackgroundValue(value: unknown): value is string {
  return typeof value === "string" && (BACKGROUND_COLOR_RE.test(value) || backgroundImage(value) !== null)
}
