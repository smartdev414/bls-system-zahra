/**
 * API audit middleware.
 *
 * Wrap any route handler with `withAudit` to:
 *   - Log every request (method, path, status, user, IP, duration) to the ApiLog table.
 *   - Send an alert email to DEV_EMAIL for every 5xx response.
 *
 * Usage:
 *   async function handleGET(req: NextRequest) { ... }
 *   export const GET = withAudit(handleGET)
 */

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { sendEmail } from "@/lib/email"

// ─── Types ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtx = any

type Handler<C extends AnyCtx = AnyCtx> = (
  req: NextRequest,
  ctx: C
) => Promise<NextResponse>

// ─── Main wrapper ─────────────────────────────────────────────────────────────

export function withAudit<C extends AnyCtx = AnyCtx>(
  handler: Handler<C>
): Handler<C> {
  return async (req: NextRequest, ctx: C): Promise<NextResponse> => {
    const start = Date.now()
    const method = req.method
    const path = new URL(req.url).pathname

    // Attempt to read session — auth routes may not have one yet
    let userId: string | undefined
    let userRole: string | undefined
    let userEmail: string | undefined
    try {
      const session = await getSession()
      if (session) {
        userId = session.sub
        userRole = session.role
        userEmail = session.email
      }
    } catch {
      // intentionally swallowed
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown"
    const userAgent = req.headers.get("user-agent") ?? undefined

    let res: NextResponse
    let errorMessage: string | undefined

    try {
      res = await handler(req, ctx)
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[audit] Unhandled exception in ${method} ${path}:`, err)
      res = NextResponse.json({ message: "Internal server error" }, { status: 500 })
    }

    const durationMs = Date.now() - start
    const statusCode = res.status

    // Fire-and-forget DB write
    prisma.apiLog
      .create({
        data: {
          method,
          path,
          statusCode,
          userId,
          userRole,
          userEmail,
          ip,
          userAgent,
          durationMs,
          errorMessage,
        },
      })
      .catch((e) => console.error("[audit] DB write failed:", e))

    // Alert dev on any 5xx
    if (statusCode >= 500) {
      sendDevAlert({
        method,
        path,
        statusCode,
        userId,
        userEmail,
        ip,
        userAgent,
        durationMs,
        errorMessage,
      }).catch((e) => console.error("[audit] Dev alert send failed:", e))
    }

    return res
  }
}

// ─── Dev alert email ──────────────────────────────────────────────────────────

interface DevAlertParams {
  method: string
  path: string
  statusCode: number
  userId?: string
  userEmail?: string
  ip?: string
  userAgent?: string
  durationMs: number
  errorMessage?: string
}

async function sendDevAlert(p: DevAlertParams): Promise<void> {
  const devEmail = process.env.DEV_EMAIL
  if (!devEmail) return

  const timestamp = new Date().toISOString()

  const row = (label: string, value: string, valueColor = "#f8f8f2") =>
    `<tr>
      <td style="padding:5px 16px 5px 0;color:#8be9fd;white-space:nowrap;vertical-align:top">${label}</td>
      <td style="padding:5px 0;color:${valueColor};word-break:break-all">${value}</td>
    </tr>`

  const html = `
<div style="font-family:ui-monospace,'Cascadia Code','Fira Code',monospace;
            background:#1e1e2e;color:#f8f8f2;padding:28px;border-radius:10px;max-width:680px">

  <h2 style="margin:0 0 20px;font-size:18px;color:#ff5555;display:flex;align-items:center;gap:8px">
    &#x1F6A8; API Error — ${p.statusCode} ${p.method} ${p.path}
  </h2>

  <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
    ${row("Timestamp", timestamp)}
    ${row("Endpoint", `<strong>${p.method}</strong> ${p.path}`)}
    ${row("Status", String(p.statusCode), "#ff5555")}
    ${row("Duration", `${p.durationMs} ms`)}
    ${row("User ID", p.userId ?? "—")}
    ${row("User Email", p.userEmail ?? "—")}
    ${row("IP", p.ip ?? "—")}
    ${row("User Agent", p.userAgent ?? "—", "#6272a4")}
  </table>

  ${
    p.errorMessage
      ? `<div style="background:#2d2d3e;border-left:3px solid #ff5555;padding:14px 16px;
                    border-radius:0 6px 6px 0;margin-top:4px">
          <p style="margin:0 0 8px;color:#ff5555;font-size:13px;font-weight:bold">Error message</p>
          <pre style="margin:0;white-space:pre-wrap;font-size:12px;color:#f8f8f2;
                      line-height:1.5">${escapeHtml(p.errorMessage)}</pre>
        </div>`
      : ""
  }

  <p style="margin:20px 0 0;font-size:11px;color:#6272a4">
    This alert was generated automatically by BSL Platform audit middleware.
    Review the Admin → API Logs page for full history.
  </p>
</div>`

  await sendEmail(
    devEmail,
    `[BSL] API Error ${p.statusCode}: ${p.method} ${p.path}`,
    html
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
