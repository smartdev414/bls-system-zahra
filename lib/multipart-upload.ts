/**
 * Browser-side multipart upload to S3, driven by the presigning routes.
 *
 * The browser never streams the file through our server: it PUTs each part
 * straight to S3 with a presigned URL, so the only ceiling is S3's own
 * (5 TB / 10,000 parts). `file.slice()` is lazy, so a 4 GB video is never held
 * in memory — only the parts currently in flight are.
 */

const MIN_PART_SIZE = 5 * 1024 * 1024        // S3 floor for every part but the last
const TARGET_PART_SIZE = 16 * 1024 * 1024    // good throughput without huge retries
const MAX_PARTS = 9_000                      // headroom under S3's 10,000
const PARALLEL_PARTS = 4
const SIGN_BATCH = 100                       // must not exceed the route's per-request cap
const PART_RETRIES = 3

/** Files at or below this go up as one plain PUT — multipart isn't worth the round trips. */
export const MULTIPART_THRESHOLD = 8 * 1024 * 1024

/** Part size that keeps the file inside S3's part-count limit. */
export function partSizeFor(fileSize: number): number {
  const needed = Math.ceil(fileSize / MAX_PARTS)
  const mb = 1024 * 1024
  return Math.max(MIN_PART_SIZE, Math.ceil(Math.max(TARGET_PART_SIZE, needed) / mb) * mb)
}

type CompletedPart = { PartNumber: number; ETag: string }

export type UploadProgress = {
  /** Bytes confirmed sent so far. */
  loaded: number
  total: number
  /** 0–100, rounded. */
  percent: number
}

class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled")
    this.name = "UploadAbortedError"
  }
}

export function isUploadAborted(err: unknown): boolean {
  return err instanceof UploadAbortedError || (err instanceof Error && err.name === "AbortError")
}

/**
 * PUT one blob to a presigned URL, reporting bytes as they go out.
 * `fetch` is deliberately avoided here: only XHR exposes upload progress, and a
 * multi-gigabyte upload with no progress bar looks indistinguishable from a hang.
 */
function xhrPut({
  url,
  body,
  contentType,
  signal,
  onBytes,
  requireEtag,
}: {
  url: string
  body: Blob
  contentType?: string
  signal?: AbortSignal
  onBytes: (loaded: number) => void
  requireEtag: boolean
}): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url, true)
    // Only set on the single-PUT path: that URL signs content-type, so the
    // header has to match. UploadPart URLs sign only the host.
    if (contentType) xhr.setRequestHeader("Content-Type", contentType)

    const onAbort = () => xhr.abort()
    signal?.addEventListener("abort", onAbort)
    const cleanup = () => signal?.removeEventListener("abort", onAbort)

    xhr.upload.onprogress = (e) => onBytes(e.loaded)
    xhr.onerror = () => { cleanup(); reject(new Error("Network error while uploading")) }
    xhr.onabort = () => { cleanup(); reject(new UploadAbortedError()) }
    xhr.onload = () => {
      cleanup()
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status})`))
        return
      }
      if (!requireEtag) {
        resolve(null)
        return
      }
      // S3 identifies each part by its ETag. The bucket's CORS rules must list
      // ETag under ExposeHeaders or the browser hides it and we cannot finish.
      const etag = xhr.getResponseHeader("ETag")
      if (!etag) {
        reject(new Error("Storage did not return an ETag — check the bucket's CORS ExposeHeaders"))
        return
      }
      resolve(etag)
    }

    xhr.send(body)
  })
}

/**
 * Single presigned PUT, for files small enough that multipart's extra round
 * trips cost more than they save. Same progress/cancel contract as the
 * multipart path so the UI can treat both the same way.
 */
export async function uploadFileDirect({
  presignedUrl,
  file,
  contentType,
  signal,
  onProgress,
}: {
  presignedUrl: string
  file: File
  contentType: string
  signal?: AbortSignal
  onProgress?: (p: UploadProgress) => void
}): Promise<void> {
  await xhrPut({
    url: presignedUrl,
    body: file,
    contentType,
    signal,
    requireEtag: false,
    onBytes: (loaded) => onProgress?.({
      loaded,
      total: file.size,
      percent: file.size ? Math.round((loaded / file.size) * 100) : 100,
    }),
  })
}

async function postAction<T>(
  endpoint: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(err.message ?? "Upload request failed")
  }
  return res.json() as Promise<T>
}

/**
 * Upload `file` in parts. Resolves with the object's public URL.
 *
 * On failure or cancellation the multipart upload is aborted so S3 stops
 * holding (and billing for) the parts already sent.
 */
export async function uploadFileInParts({
  endpoint,
  file,
  contentType,
  signal,
  onProgress,
}: {
  endpoint: string
  file: File
  contentType: string
  signal?: AbortSignal
  onProgress?: (p: UploadProgress) => void
}): Promise<string> {
  const partSize = partSizeFor(file.size)
  const partCount = Math.max(1, Math.ceil(file.size / partSize))

  // Internal controller so a failed part tears down its siblings too: without
  // it, a mid-upload error leaves three other parts streaming gigabytes into an
  // upload we are about to abort.
  const ctl = new AbortController()
  const forwardAbort = () => ctl.abort()
  if (signal?.aborted) ctl.abort()
  signal?.addEventListener("abort", forwardAbort)

  const { key, uploadId } = await postAction<{ key: string; uploadId: string }>(
    endpoint,
    { action: "create", fileName: file.name, contentType },
    ctl.signal,
  )

  // Bytes sent per part, so a retried part's progress replaces rather than
  // double-counts its earlier attempt.
  const sent = new Array<number>(partCount).fill(0)
  const report = () => {
    if (!onProgress) return
    const loaded = Math.min(sent.reduce((a, b) => a + b, 0), file.size)
    onProgress({ loaded, total: file.size, percent: Math.round((loaded / file.size) * 100) })
  }
  report()

  // Part URLs are signed in windows as the upload advances, so a multi-hour
  // upload never reaches a part whose URL expired before it got there.
  const urls = new Map<number, string>()
  const pendingWindows = new Map<number, Promise<void>>()
  const urlFor = async (partNumber: number): Promise<string> => {
    const cached = urls.get(partNumber)
    if (cached) return cached
    const windowStart = Math.floor((partNumber - 1) / SIGN_BATCH) * SIGN_BATCH + 1
    let inflight = pendingWindows.get(windowStart)
    if (!inflight) {
      const partNumbers: number[] = []
      for (let n = windowStart; n < windowStart + SIGN_BATCH && n <= partCount; n++) partNumbers.push(n)
      inflight = postAction<{ urls: { partNumber: number; url: string }[] }>(
        endpoint,
        { action: "sign", key, uploadId, partNumbers },
        ctl.signal,
      ).then(({ urls: signed }) => {
        for (const u of signed) urls.set(u.partNumber, u.url)
      }).finally(() => {
        pendingWindows.delete(windowStart)
      })
      pendingWindows.set(windowStart, inflight)
    }
    await inflight
    const url = urls.get(partNumber)
    if (!url) throw new Error(`Could not sign part ${partNumber}`)
    return url
  }

  const completed: CompletedPart[] = []
  let next = 1

  const worker = async () => {
    for (;;) {
      if (ctl.signal.aborted) throw new UploadAbortedError()
      const partNumber = next++
      if (partNumber > partCount) return

      const start = (partNumber - 1) * partSize
      const blob = file.slice(start, Math.min(start + partSize, file.size))

      let lastErr: unknown
      for (let attempt = 0; attempt < PART_RETRIES; attempt++) {
        try {
          const url = await urlFor(partNumber)
          const etag = await xhrPut({
            url,
            body: blob,
            signal: ctl.signal,
            requireEtag: true,
            onBytes: (loaded) => {
              sent[partNumber - 1] = loaded
              report()
            },
          })
          sent[partNumber - 1] = blob.size
          report()
          completed.push({ PartNumber: partNumber, ETag: etag! })
          lastErr = undefined
          break
        } catch (e) {
          if (isUploadAborted(e)) throw e
          lastErr = e
          sent[partNumber - 1] = 0
          report()
          // A part can fail on a blip; back off briefly and re-sign before retrying.
          urls.delete(partNumber)
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
      if (lastErr) throw lastErr
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_PARTS, partCount) }, () =>
        worker().catch((e) => { ctl.abort(); throw e }),
      ),
    )
    const { fileUrl } = await postAction<{ fileUrl: string }>(
      endpoint,
      { action: "complete", key, uploadId, parts: completed },
      // Deliberately unsignalled: once every part is in S3, finishing the object
      // is cheaper than aborting it.
    )
    return fileUrl
  } catch (e) {
    ctl.abort()
    // Best-effort: if this fails too, the bucket's incomplete-upload lifecycle
    // rule reaps the orphaned parts. Don't mask the real error with cleanup's.
    void postAction(endpoint, { action: "abort", key, uploadId }).catch(() => {})
    throw e
  } finally {
    signal?.removeEventListener("abort", forwardAbort)
  }
}
