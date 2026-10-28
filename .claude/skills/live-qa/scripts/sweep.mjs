#!/usr/bin/env node
// Read-only QA sweep of a live web app: logs in, crawls same-origin links, and
// checks every page at desktop and phone width. It only navigates (GET) and
// never clicks, so it is safe to point at production.
//
// Credentials come from the environment so they never land in files or args:
//   QA_EMAIL=... QA_PASSWORD=... node sweep.mjs --url https://app.example.com --out ./qa/tutor
//
// Options:
//   --url <base>          app origin (required)
//   --out <dir>           where report.json, summary.md and screenshots go (required)
//   --login-path <path>   login page (default /login); omit creds to sweep logged-out
//   --start <path>        extra start paths, comma-separated (default: page after login)
//   --routes <file>       file with one path per line to visit in addition to crawling
//   --max-pages <n>       cap on distinct pages (default 80)
//   --per-pattern <n>     pages per route pattern like /courses/:id (default 2)
//   --skip <regex>        paths never visited (default covers logout, tokens, live rooms)
//   --no-screens          skip screenshots

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createRequire } from "node:module"

const args = parseArgs(process.argv.slice(2))
if (!args.url || !args.out) {
  console.error("usage: QA_EMAIL=.. QA_PASSWORD=.. node sweep.mjs --url <base> --out <dir> [options]")
  process.exit(2)
}
const BASE = new URL(args.url).origin
const OUT = path.resolve(args.out)
const MAX_PAGES = Number(args["max-pages"] ?? 80)
const PER_PATTERN = Number(args["per-pattern"] ?? 2)
const SKIP = new RegExp(
  args.skip ??
    "logout|log-out|sign-?out|/api/|/verify/|/invite/|reset-password/|/egress|/classroom/|delete|remove|unsubscribe|\\.(pdf|zip|mp4|png|jpe?g)$",
  "i",
)
const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1366, height: 768 } },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
]

fs.mkdirSync(path.join(OUT, "screens"), { recursive: true })
const { chromium } = await loadPlaywright()
const browser = await launch(chromium)

const report = { base: BASE, startedAt: new Date().toISOString(), login: null, pages: [] }
try {
  const storageState = await login()
  const contexts = {}
  for (const v of VIEWPORTS) {
    const { name, ...opts } = v
    contexts[name] = await browser.newContext({ ...opts, storageState, ignoreHTTPSErrors: true })
  }

  const queue = []
  const seen = new Set()
  const patternCount = new Map()
  const enqueue = (p) => {
    const u = new URL(p, BASE)
    if (u.origin !== BASE) return
    const key = u.pathname.replace(/\/$/, "") || "/"
    if (seen.has(key) || SKIP.test(key)) return
    const pattern = toPattern(key)
    if ((patternCount.get(pattern) ?? 0) >= PER_PATTERN) return
    patternCount.set(pattern, (patternCount.get(pattern) ?? 0) + 1)
    seen.add(key)
    queue.push(key)
  }
  for (const p of (args.start ?? "").split(",").filter(Boolean)) enqueue(p)
  if (report.login?.landedOn) enqueue(report.login.landedOn)
  if (args.routes) for (const line of fs.readFileSync(args.routes, "utf8").split("\n")) if (line.trim()) enqueue(line.trim())
  if (!queue.length) enqueue("/")

  while (queue.length && report.pages.length < MAX_PAGES) {
    const p = queue.shift()
    const entry = { path: p, pattern: toPattern(p), views: {} }
    for (const v of VIEWPORTS) {
      const result = await checkPage(contexts[v.name], p, v)
      entry.views[v.name] = result
      if (v.name === "desktop") for (const link of result.links ?? []) enqueue(link)
      delete result.links
    }
    report.pages.push(entry)
    const issues = Object.values(entry.views).reduce((n, r) => n + countIssues(r), 0)
    console.log(`${String(report.pages.length).padStart(3)}  ${issues ? "!" : " "} ${p}${issues ? `  (${issues} issues)` : ""}`)
  }
  report.unvisited = queue
} finally {
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(OUT, "summary.md"), summarize(report))
  await browser.close()
}
console.log(`\nreport: ${path.join(OUT, "summary.md")}`)

async function login() {
  const email = process.env.QA_EMAIL
  const password = process.env.QA_PASSWORD
  if (!email || !password) {
    report.login = { skipped: true }
    return undefined
  }
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  const loginUrl = new URL(args["login-path"] ?? "/login", BASE).href
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" })
  await page.locator('input[type="email"], input[name*="email" i], input[id*="email" i], input[name*="user" i]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await Promise.all([
    page.waitForURL((u) => u.href !== loginUrl && !/login/i.test(u.pathname), { timeout: 30000 }).catch(() => {}),
    page.locator('button[type="submit"], input[type="submit"]').first().click(),
  ])
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
  const landed = new URL(page.url())
  const ok = !/login/i.test(landed.pathname)
  const errorText = ok ? null : (await page.locator('[role="alert"], .text-destructive, .error').allInnerTexts().catch(() => [])).join(" ").slice(0, 300)
  report.login = { ok, landedOn: landed.pathname, errorText }
  const state = await ctx.storageState()
  await ctx.close()
  if (!ok) throw new Error(`login failed (still on ${landed.pathname}): ${errorText || "no error shown"}`)
  return state
}

async function checkPage(ctx, p, v) {
  const page = await ctx.newPage()
  const r = { status: null, finalPath: null, loadMs: null, consoleErrors: [], pageErrors: [], failedRequests: [], layout: null, screenshot: null }
  page.on("console", (m) => m.type() === "error" && r.consoleErrors.push(m.text().slice(0, 400)))
  page.on("pageerror", (e) => r.pageErrors.push(String(e.message || e).slice(0, 400)))
  page.on("response", (res) => {
    const u = res.url()
    if (res.status() >= 400 && !u.includes("favicon")) r.failedRequests.push(`${res.status()} ${res.request().method()} ${shorten(u)}`)
  })
  page.on("requestfailed", (req) => {
    const err = req.failure()?.errorText ?? ""
    if (!/ERR_ABORTED/.test(err)) r.failedRequests.push(`FAILED ${req.method()} ${shorten(req.url())} ${err}`)
  })
  const t0 = Date.now()
  try {
    const res = await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 45000 })
    r.status = res?.status() ?? null
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
    r.loadMs = Date.now() - t0
    await page.waitForTimeout(400)
    r.finalPath = new URL(page.url()).pathname
    r.layout = await page.evaluate(inspectLayout, { mobile: !!v.isMobile })
    r.links = r.layout.links
    delete r.layout.links
    if (!args["no-screens"]) {
      const file = `${slug(p)}__${v.name}.jpg`
      await page.screenshot({ path: path.join(OUT, "screens", file), fullPage: true, type: "jpeg", quality: 60 })
      r.screenshot = `screens/${file}`
    }
  } catch (e) {
    r.navError = String(e.message || e).split("\n")[0]
  }
  await page.close()
  return r
}

// Runs in the page. Keep it self-contained.
function inspectLayout({ mobile }) {
  const vw = document.documentElement.clientWidth
  const describe = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.id) s += "#" + el.id
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""
    if (cls) s += "." + cls
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)
    return text ? `${s} "${text}"` : s
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0"
  }
  const out = {}
  const scrollW = document.documentElement.scrollWidth
  out.horizontalOverflowPx = Math.max(0, scrollW - vw)
  if (out.horizontalOverflowPx > 1) {
    out.overflowing = [...document.body.querySelectorAll("*")]
      .filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 1)
      .filter((el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= vw + 1)
      .slice(0, 6)
      .map((el) => `${describe(el)} (right=${Math.round(el.getBoundingClientRect().right)})`)
  }
  const interactive = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="checkbox"]')].filter(visible)
  if (mobile) {
    const small = interactive.filter((el) => {
      const r = el.getBoundingClientRect()
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") return false
      if (r.width <= 2 || r.height <= 2) return false // visually-hidden native controls
      return Math.min(r.width, r.height) < 20 || r.width * r.height < 24 * 24
    })
    out.smallTapTargets = small.length
    out.smallTapExamples = small.slice(0, 6).map((el) => {
      const r = el.getBoundingClientRect()
      return `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`
    })
  }
  const unnamed = interactive.filter((el) => {
    if (!/^(BUTTON|A)$/.test(el.tagName) && el.getAttribute("role") !== "button") return false
    const name = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("aria-labelledby") || "").trim()
    const labelled = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    return !name && !labelled && !el.querySelector("img[alt]:not([alt=''])")
  })
  out.unlabelledButtons = unnamed.length
  out.unlabelledExamples = unnamed.slice(0, 4).map(describe)
  const inputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")].filter(visible)
  out.unlabelledInputs = inputs.filter((el) => {
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("placeholder")) return false
    return !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) && !el.closest("label")
  }).length
  let tiny = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const counted = new Set()
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement
    if (!el || counted.has(el) || !walker.currentNode.textContent.trim() || !visible(el)) continue
    counted.add(el)
    if (parseFloat(getComputedStyle(el).fontSize) < 12) tiny++
  }
  out.tinyTextElements = tiny
  out.brokenImages = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && visible(i)).map((i) => i.currentSrc || i.src).slice(0, 5)
  const bodyText = document.body.innerText || ""
  const m = bodyText.match(/application error|something went wrong|unhandled runtime error|internal server error|this page could not be found|404|undefined|NaN|\[object Object\]|Invalid Date/i)
  out.errorText = m ? bodyText.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\s+/g, " ") : null
  out.title = document.title
  out.h1 = document.querySelector("h1")?.innerText?.trim().slice(0, 80) ?? null
  out.links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && !h.startsWith("#") && !/^(mailto|tel|javascript):/i.test(h))
  return out
}

function countIssues(r) {
  if (r.navError) return 1
  const l = r.layout ?? {}
  return (
    r.consoleErrors.length + r.pageErrors.length + r.failedRequests.length + (r.status >= 400 ? 1 : 0) +
    (l.horizontalOverflowPx > 1 ? 1 : 0) + (l.brokenImages?.length ?? 0) + (l.errorText ? 1 : 0) +
    (l.unlabelledButtons ? 1 : 0) + (l.smallTapTargets ? 1 : 0)
  )
}

function summarize(rep) {
  const lines = [`# QA sweep: ${rep.base}`, "", `Login: ${rep.login?.skipped ? "logged out" : rep.login?.ok ? `ok, landed on ${rep.login.landedOn}` : "FAILED"}`, `Pages: ${rep.pages.length}${rep.unvisited?.length ? ` (cap hit, ${rep.unvisited.length} more found)` : ""}`, ""]
  const rows = []
  for (const pg of rep.pages) {
    for (const [vp, r] of Object.entries(pg.views)) {
      const l = r.layout ?? {}
      const f = []
      if (r.navError) f.push(`navigation error: ${r.navError}`)
      if (r.status >= 400) f.push(`HTTP ${r.status}`)
      if (r.finalPath && r.finalPath !== pg.path) f.push(`redirected to ${r.finalPath}`)
      for (const e of r.pageErrors) f.push(`JS exception: ${e}`)
      for (const e of [...new Set(r.consoleErrors)].slice(0, 5)) f.push(`console: ${e}`)
      for (const e of [...new Set(r.failedRequests)].slice(0, 5)) f.push(`request: ${e}`)
      if (l.errorText) f.push(`suspicious text: "…${l.errorText}…"`)
      if (l.horizontalOverflowPx > 1) f.push(`horizontal scroll +${l.horizontalOverflowPx}px: ${(l.overflowing ?? []).join("; ")}`)
      if (l.smallTapTargets) f.push(`${l.smallTapTargets} tap targets too small (<20px or <24x24): ${l.smallTapExamples.join("; ")}`)
      if (l.unlabelledButtons) f.push(`${l.unlabelledButtons} buttons/links with no name: ${l.unlabelledExamples.join("; ")}`)
      if (l.unlabelledInputs) f.push(`${l.unlabelledInputs} inputs with no label`)
      if (l.tinyTextElements > 5) f.push(`${l.tinyTextElements} text elements under 12px`)
      for (const b of l.brokenImages ?? []) f.push(`broken image: ${b}`)
      if (r.loadMs > 6000) f.push(`slow: ${(r.loadMs / 1000).toFixed(1)}s`)
      if (f.length) rows.push({ where: `${pg.path} [${vp}]`, f, shot: r.screenshot })
    }
  }
  lines.push(`Pages with findings: ${rows.length}`, "")
  for (const row of rows) {
    lines.push(`## ${row.where}`)
    if (row.shot) lines.push(`screenshot: ${row.shot}`)
    for (const x of row.f) lines.push(`- ${x}`)
    lines.push("")
  }
  lines.push("## All pages", "", "| path | desktop | mobile | load |", "|---|---|---|---|")
  for (const pg of rep.pages) {
    const d = pg.views.desktop, m = pg.views.mobile
    lines.push(`| ${pg.path} | ${countIssues(d)} | ${countIssues(m)} | ${d.loadMs ? (d.loadMs / 1000).toFixed(1) + "s" : "-"} |`)
  }
  return lines.join("\n") + "\n"
}

function toPattern(p) {
  return p.split("/").map((s) => (/^\d+$/.test(s) || /^[a-z0-9]{20,}$/i.test(s) || /^[0-9a-f-]{32,36}$/i.test(s) ? ":id" : s)).join("/")
}
function slug(p) {
  return (p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "root").slice(0, 80)
}
function shorten(u) {
  return u.replace(BASE, "").slice(0, 160)
}
function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue
    const k = argv[i].slice(2)
    o[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true
  }
  return o
}

// Use whatever Playwright is already on the box: project deps, then the npx cache.
async function loadPlaywright() {
  const candidates = [process.cwd(), path.dirname(new URL(import.meta.url).pathname)]
  const npx = path.join(os.homedir(), ".npm/_npx")
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) candidates.push(path.join(npx, d))
  for (const dir of candidates) {
    try {
      const req = createRequire(path.join(dir, "noop.js"))
      return req(req.resolve("playwright"))
    } catch {}
  }
  console.error("Playwright not found. Install it in a scratch dir: npm i --prefix <dir> playwright && cd <dir> && node <this script>")
  process.exit(2)
}
async function launch(chromium) {
  try {
    return await chromium.launch()
  } catch (e) {
    const cache = path.join(os.homedir(), ".cache/ms-playwright")
    const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : []
    for (const d of dirs) {
      const exe = path.join(cache, d, "chrome-linux64/chrome")
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe })
    }
    throw e
  }
}
