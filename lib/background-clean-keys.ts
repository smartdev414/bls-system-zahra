/**
 * Naming for recordings that get their background replaced after upload (see
 * lib/background-clean.ts). Shared by the recorders, which name the upload,
 * and the server, which finds the finished file from it.
 */

const RAW_SUFFIX = /\.raw\.(webm|mp4)$/

/** File name to upload a raw recording under, e.g. `take.webm` → `take.raw.webm`. */
export function rawRecordingName(fileName: string): string {
  return fileName.replace(/\.(webm|mp4)$/, ".raw.$1")
}

export function isRawRecordingKey(key: string): boolean {
  return RAW_SUFFIX.test(key)
}

/** Where the finished video for a raw recording is written. */
export function cleanKeyFor(rawKey: string): string {
  return rawKey.replace(RAW_SUFFIX, ".clean.mp4")
}
