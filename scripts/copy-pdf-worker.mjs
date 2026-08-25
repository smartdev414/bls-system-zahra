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
import { copyFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const WORKER_FILE = "pdf.worker.min.mjs"
const DEST_DIR = path.join(root, "public", "pdf")

async function main() {
  const pkgPath = require.resolve("pdfjs-dist/package.json")
  const src = path.join(path.dirname(pkgPath), "build", WORKER_FILE)
  const dest = path.join(DEST_DIR, WORKER_FILE)

  await mkdir(DEST_DIR, { recursive: true })
  await copyFile(src, dest)

  const { version } = JSON.parse(await readFile(pkgPath, "utf8"))
  console.log(`[copy-pdf-worker] pdfjs-dist@${version} → public/pdf/${WORKER_FILE}`)
}

main().catch((err) => {
  console.error("[copy-pdf-worker] failed:", err.message)
  process.exit(1)
})
