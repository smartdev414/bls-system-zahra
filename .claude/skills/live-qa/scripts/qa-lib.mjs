// Helpers for hand-written feature walk-throughs on the live site.
//
//   import { openAs, shot, done } from "<skill>/scripts/qa-lib.mjs"
//   const { page, issues } = await openAs("A", { phone: true, out })
//   await page.goto("/student/dictionary"); await shot(page, "dictionary")
//   ...
//   await done()   // prints the collected console/page/network errors
//
// Accounts come from ~/.config/bls-qa/accounts.env (QA_<KEY>_EMAIL / _PASSWORD,
// QA_URL) or the environment; nothing secret is written anywhere else. The login
// is done once per account and cached as a Playwright storage state in
// ~/.config/bls-qa/state-<KEY>.json (mode 600) for 6 hours, so repeated scripts
// don't hammer the login endpoint.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const CONF_DIR = path.join(os.homedir(), ".config", "bls-qa")
loadEnvFile(path.join(CONF_DIR, "accounts.env"))
export const BASE = new URL(process.env.QA_URL || "https://classroom.tms.webcam").origin

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
const DESKTOP = { viewport: { width: 1366, height: 768 } }
let browser
const opened = []

// fakeMedia: a fake camera + mic with permission granted, for the classroom / connection check.
export async function openAs(key, { phone = false, out = process.cwd(), slowMo = 0, fakeMedia = false } = {}) {
  const { chromium } = loadPlaywright()
  const args = fakeMedia ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] : []
  browser ??= await launch(chromium, { headless: true, slowMo, args })
  const storageState = key ? await getState(key) : undefined
  const ctx = await browser.newContext({ ...(phone ? PHONE : DESKTOP), baseURL: BASE, storageState, ignoreHTTPSErrors: true,
    ...(fakeMedia ? { permissions: ["camera", "microphone"] } : {}) })
  const page = await ctx.newPage()
  const issues = []
  page.on("console", (m) => m.type() === "error" && issues.push(`console: ${m.text().slice(0, 300)}`))
  page.on("pageerror", (e) => issues.push(`exception: ${String(e.message || e).slice(0, 300)}`))
  page.on("response", (r) => r.status() >= 400 && !r.url().includes("favicon") && issues.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`))
  page.__qaOut = out
  page.__qaTag = `${key ?? "anon"}-${phone ? "phone" : "desktop"}`
  fs.mkdirSync(out, { recursive: true })
  opened.push({ ctx, page, issues })
  return { ctx, page, issues }
}

// Full-page screenshot named <account>-<viewport>-<name>.jpg; returns the path so you can Read it.
export async function shot(page, name, { fullPage = true } = {}) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {})
  const file = path.join(page.__qaOut, `${page.__qaTag}-${name}.jpg`.replace(/[^\w.-]+/g, "_"))
  await page.screenshot({ path: file, fullPage, type: "jpeg", quality: 70 })
  console.log("shot:", file)
  return file
}

export async function done() {
  for (const { page, issues } of opened) {
    if (issues.length) console.log(`\n[${page.__qaTag}] ${issues.length} error(s):\n  ` + [...new Set(issues)].join("\n  "))
  }
  await browser?.close()
}

async function getState(key) {
  const file = path.join(CONF_DIR, `state-${key}.json`)
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 6 * 3600e3) return file
  const email = process.env[`QA_${key}_EMAIL`]
  const password = process.env[`QA_${key}_PASSWORD`]
  if (!email || !password) throw new Error(`No login for account ${key}: set QA_${key}_EMAIL / QA_${key}_PASSWORD in ${CONF_DIR}/accounts.env`)
  const ctx = await browser.newContext({ ...DESKTOP, baseURL: BASE, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  // Wait for hydration: clicking before React is up submits the form as a plain GET (/login?).
  // networkidle can never come (live polling), so wait for load plus a hydration pause.
  await page.goto("/login", { waitUntil: "load", timeout: 90000 })
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.locator('input[type="email"], input[name*="email" i]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await Promise.all([
    page.waitForURL((u) => !/login/i.test(u.pathname), { timeout: 30000 }).catch(() => {}),
    page.locator('button[type="submit"]').first().click(),
  ])
  if (/login/i.test(new URL(page.url()).pathname)) {
    const err = (await page.locator('[role="alert"], .text-destructive').allInnerTexts().catch(() => [])).join(" ")
    await ctx.close()
    throw new Error(`Login failed for account ${key}: ${err || "no error shown"}`)
  }
  fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 })
  await ctx.storageState({ path: file })
  fs.chmodSync(file, 0o600)
  console.log(`logged in as ${key} → ${new URL(page.url()).pathname}`)
  await ctx.close()
  return file
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2")
  }
}

// Same lookup as sweep.mjs: cwd, this folder, then any npx cache (where `npx playwright` left it).
function loadPlaywright() {
  const candidates = [process.cwd(), path.dirname(new URL(import.meta.url).pathname)]
  const npx = path.join(os.homedir(), ".npm/_npx")
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) candidates.push(path.join(npx, d))
  for (const dir of candidates) {
    try {
      const req = createRequire(path.join(dir, "noop.js"))
      return req(req.resolve("playwright"))
    } catch {}
  }
  throw new Error("Playwright not found. Install it in a scratch dir: npm i --prefix <dir> playwright, then run your script from <dir>")
}

async function launch(chromium, opts) {
  try {
    return await chromium.launch(opts)
  } catch (e) {
    const cache = path.join(os.homedir(), ".cache/ms-playwright")
    const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : []
    for (const d of dirs) {
      const exe = path.join(cache, d, "chrome-linux64/chrome")
      if (fs.existsSync(exe)) return chromium.launch({ ...opts, executablePath: exe })
    }
    throw e
  }
}
