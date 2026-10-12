/**
 * Naming for recordings that get their background replaced after upload (see
 * lib/background-clean.ts). Shared by the recorders, which name the upload,
 * and the server, which finds the finished file from it.
 */

const RAW_SUFFIX = /\.raw\.(webm|mp4|mov|m4v)$/

/**
 * File name to upload a raw recording under, e.g. `take.webm` → `take.raw.webm`.
 * A name with no video extension (or one the worker's output can't be named
 * after) is stored as `.raw.mp4`; the worker reads any container ffmpeg can.
 */
export function rawRecordingName(fileName: string): string {
  const m = fileName.match(/^(.*)\.(webm|mp4|mov|m4v)$/i)
  return m ? `${m[1]}.raw.${m[2].toLowerCase()}` : `${fileName.replace(/\.[^.]*$/, "")}.raw.mp4`
}

export function isRawRecordingKey(key: string): boolean {
  return RAW_SUFFIX.test(key)
}

/** Where the finished video for a raw recording is written. */
export function cleanKeyFor(rawKey: string): string {
  return rawKey.replace(RAW_SUFFIX, ".clean.mp4")
}

/** The raw-recording key a stored file URL points at, or null if it isn't one. */
export function rawKeyFromUrl(url: string): string | null {
  try {
    const key = decodeURIComponent(new URL(url).pathname.slice(1))
    return isRawRecordingKey(key) ? key : null
  } catch {
    return null
  }
}
