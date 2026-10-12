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
