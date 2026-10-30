// Creates or updates the RunPod serverless endpoint that replaces video
// backgrounds after upload (agents/background-replacer, lib/background-clean.ts).
//
//   RUNPOD_API_KEY=… node scripts/deploy-background-replacer.mjs
//
// Safe to re-run: it finds the template and endpoint by name and updates them.
// Prints the endpoint id to set as RUNPOD_BACKGROUND_ENDPOINT_ID.
//
// There is no image to build. The worker runs on the stock PyTorch image and
// its start command installs the few extra packages and unpacks
// handler.py from an environment variable. That costs a minute or two on each
// cold start; baking a proper image would remove it, but needs a container
// registry this project doesn't have yet.

import { readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const NAME = "bls-background-replacer"
// PyTorch built for CUDA 12.8. RunPod's 24 GB pool hands out slices of newer
// (Blackwell) cards as well as the ones listed below, and an older PyTorch
// starts on those and then dies loading the model — the job just sits queued.
const IMAGE = "pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime"
const API = "https://rest.runpod.io/v1"

const apiKey = process.env.RUNPOD_API_KEY
if (!apiKey) {
  console.error("RUNPOD_API_KEY is not set")
  process.exit(1)
}

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "background-replacer")
const handler = readFileSync(join(workerDir, "handler.py"))
const requirements = readFileSync(join(workerDir, "requirements.txt"), "utf8")
  .split("\n")
  .map((line) => line.replace(/#.*/, "").trim())
  .filter(Boolean)

const startScript = [
  "set -e",
  "command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg >/dev/null)",
  `pip install -q --no-cache-dir ${requirements.map((r) => `'${r}'`).join(" ")}`,
  'echo "$HANDLER_GZ_B64" | base64 -d | gunzip > /handler.py',
  "exec python -u /handler.py",
].join("\n")

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const template = {
  name: NAME,
  imageName: IMAGE,
  isServerless: true,
  containerDiskInGb: 20,
  volumeInGb: 0,
  dockerStartCmd: ["bash", "-c", startScript],
  env: {
    HANDLER_GZ_B64: gzipSync(handler).toString("base64"),
    // Overridable without touching the code: which matting model, and how
    // many frames go through it at once.
    MATTING_MODEL: process.env.MATTING_MODEL ?? "ZhengPeng7/BiRefNet-matting",
    BATCH_SIZE: process.env.BATCH_SIZE ?? "4",
  },
}

const endpoint = {
  name: NAME,
  computeType: "GPU",
  // Named cards only. The generic 24 GB choices (3090, A5000) share a pool
  // with quarter-slices of Blackwell cards ("RTX PRO 6000 … MIG 1g.24gb"),
  // and RunPod hands those out too: on a 30 s 1080p clip a slice took 167 s,
  // a 4090 67 s and a 5090 55 s (2026-10-14). The 4090 is the cheapest per
  // video; the 5090 is the fallback when no 4090 is free.
  gpuTypeIds: ["NVIDIA GeForce RTX 4090", "NVIDIA GeForce RTX 5090"],
  gpuCount: 1,
  // Cost controls: nothing runs (or bills) once a sitting is over, and a stuck
  // job is stopped rather than left running. A second worker is there for when
  // the first lands on a host with no free GPU, which otherwise holds the queue.
  workersMin: 0,
  workersMax: 2,
  // A cold start is about 110 s against about 15 s to process a sign
  // (2026-10-30), so the worker stays up through the pauses between takes. Each
  // sitting costs about 5 minutes of idle GPU, roughly $0.10.
  idleTimeout: 300,
  executionTimeoutMs: 2 * 60 * 60 * 1000,
  scalerType: "QUEUE_DELAY",
  scalerValue: 4,
  flashboot: true,
  // Hosts whose driver is too old for the image's CUDA can't run it at all.
  allowedCudaVersions: ["12.8", "12.9", "13.0"],
}

const templates = await api("GET", "/templates")
let existingTemplate = templates.find((t) => t.name === NAME)
if (existingTemplate) {
  // Whether a template is serverless is fixed when it is created.
  const changes = { ...template }
  delete changes.isServerless
  await api("PATCH", `/templates/${existingTemplate.id}`, changes)
  console.log(`Updated template ${existingTemplate.id}`)
} else {
  existingTemplate = await api("POST", "/templates", template)
  console.log(`Created template ${existingTemplate.id}`)
}

const endpoints = await api("GET", "/endpoints")
let existingEndpoint = endpoints.find((e) => e.name === NAME || e.name?.startsWith(`${NAME} `))
if (existingEndpoint) {
  // GPU-or-CPU is fixed when an endpoint is created.
  const changes = { ...endpoint, templateId: existingTemplate.id }
  delete changes.computeType
  await api("PATCH", `/endpoints/${existingEndpoint.id}`, changes)
  console.log(`Updated endpoint ${existingEndpoint.id}`)
} else {
  existingEndpoint = await api("POST", "/endpoints", { ...endpoint, templateId: existingTemplate.id })
  console.log(`Created endpoint ${existingEndpoint.id}`)
}

console.log(`\nRUNPOD_BACKGROUND_ENDPOINT_ID=${existingEndpoint.id}`)
