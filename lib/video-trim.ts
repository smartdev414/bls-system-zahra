// Cutting the start and end off a recording before it is uploaded. Runs in the
// browser. Used by components/ui/recording-trimmer.tsx and the recorder.
//
// Nothing is re-encoded: the wanted stretch of the file is copied out as it
// is, so it takes a moment and loses no quality. The price is that a video can
// only begin on a key frame, so the recorder asks for one every second and the
// start of a cut is one of those. The end can fall on any frame.

import type { StreamTargetChunk } from "mediabunny"

/** How often the recorder should produce a key frame — the steps a cut can start on. */
export const KEYFRAME_INTERVAL_MS = 1000

export type RecordingInfo = {
  /** Length of the recording in seconds. */
  duration: number
  /** The times, in seconds, a cut can start on. Always includes the very start. */
  cutPoints: number[]
}

/** Seconds into the recording. A side left out is not cut. */
export type TrimRange = { start?: number; end?: number }

/** Reads how long a recording is and where it can be cut. Throws if it can't be read. */
export async function inspectRecording(blob: Blob): Promise<RecordingInfo> {
  const { Input, BlobSource, EncodedPacketSink, WEBM } = await import("mediabunny")
  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error("The recording has no video")
    const cutPoints: number[] = []
    for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      if (packet.type === "key") cutPoints.push(Math.max(0, packet.timestamp))
    }
    const duration = await input.computeDuration()
    if (cutPoints.length === 0 || !(duration > 0)) throw new Error("The recording is empty")
    return { duration, cutPoints }
  } finally {
    input.dispose()
  }
}

/**
 * The stretch of a recording inside `range`, as a new WebM file. `range.start`
 * must be one of the recording's cut points.
 */
export async function trimRecording(blob: Blob, range: TrimRange): Promise<Blob> {
  const { Input, Output, BlobSource, StreamTarget, WebMOutputFormat, Conversion, WEBM } = await import("mediabunny")

  // The finished file is kept as the pieces it was written in rather than one
  // growing buffer, which would need the whole video in memory twice over.
  const parts: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  const writable = new WritableStream<StreamTargetChunk>({
    write({ data, position }) {
      // Mostly appends; the header is gone back over at the end to fill in
      // the length and the seek index.
      let offset = 0
      for (const part of parts) {
        const from = Math.max(position, offset)
        const to = Math.min(position + data.length, offset + part.length)
        if (from < to) part.set(data.subarray(from - position, to - position), from - offset)
        offset += part.length
      }
      if (position > size) {
        parts.push(new Uint8Array(position - size))
        size = position
      }
      if (position + data.length > size) {
        parts.push(data.slice(size - position))
        size = position + data.length
      }
    },
  })

  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] })
  try {
    const output = new Output({ format: new WebMOutputFormat(), target: new StreamTarget(writable, { chunked: true }) })
    const conversion = await Conversion.init({
      input,
      output,
      trim: range,
      // Copy only, and never anything from outside the range: what was cut
      // off must not be left in the file.
      copy: { mode: "forced", boundaryPolicy: "shrink" },
      showWarnings: false,
    })
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      throw new Error("The recording can't be cut without re-encoding it")
    }
    await conversion.execute()
  } finally {
    input.dispose()
  }
  if (size === 0) throw new Error("Nothing was left after trimming")
  return new Blob(parts, { type: blob.type || "video/webm" })
}
