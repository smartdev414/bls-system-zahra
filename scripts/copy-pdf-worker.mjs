// Copy the pdf.js worker out of node_modules and into `public/` so the browser
// can load it from our own origin.
//
// Why this exists: pdf.js only uses `new Worker(src)` directly when `src` is
// same-origin. Point it at a CDN and it wraps the URL in a blob that
// `await import()`s across origins — a path Safari does not run reliably, and
// one that also dies behind school proxies that block public CDNs. Serving the
// worker ourselves removes both failure modes.
//
// The copy is taken from the installed package, so the worker can never drift
// out of version-lock with the pdf.js the app bundles (a mismatch throws at
// load time). Runs before `dev` and `build`; `public/pdf/` is gitignored.

import { createRequire } from "node:module"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const WORKER_FILE = "pdf.worker.min.mjs"
const DEST_DIR = path.join(root, "public", "pdf")

// `Promise.withResolvers` reached Safari only in 17.4 (March 2024), and pdf.js 5
// uses it in both the main bundle and the worker. On iPadOS 16 and 17.0-17.3 —
// which is a great many of the tablets students actually own, and every device
// an institution has pinned to an older OS — the worker throws
// "Promise.withResolvers is not a function" the moment it starts.
//
// The failure is invisible from the page: the worker dies during startup, no
// document ever resolves, and the student sits on "Loading presentation…" while
// the teacher on Chrome sees the deck and has no idea. That is the bug report.
//
// Prepending the shim here rather than shipping a separate file keeps it
// version-locked to the worker it patches, and means the worker is still a
// single same-origin request. Keep this in step with the identical shim in
// `lib/pdfjs.ts`, which covers the main thread.
const WITH_RESOLVERS_SHIM = `// Injected by scripts/copy-pdf-worker.mjs — see the note there.
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve, reject
    const promise = new this((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}
`

async function main() {
  const pkgPath = require.resolve("pdfjs-dist/package.json")
  const src = path.join(path.dirname(pkgPath), "build", WORKER_FILE)
  const dest = path.join(DEST_DIR, WORKER_FILE)

  const worker = await readFile(src, "utf8")

  await mkdir(DEST_DIR, { recursive: true })
  await writeFile(dest, WITH_RESOLVERS_SHIM + worker, "utf8")

  const { version } = JSON.parse(await readFile(pkgPath, "utf8"))
  console.log(
    `[copy-pdf-worker] pdfjs-dist@${version} → public/pdf/${WORKER_FILE} ` +
    "(with the Promise.withResolvers shim for Safari < 17.4)",
  )
}

main().catch((err) => {
  console.error("[copy-pdf-worker] failed:", err.message)
  process.exit(1)
})
