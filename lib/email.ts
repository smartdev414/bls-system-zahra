/**
 * Mailgun email sender.
 *
 * Required environment variables:
 *   MAILGUN_API_KEY    — your Mailgun private API key
 *   MAILGUN_DOMAIN     — your sending domain, e.g. mg.bslplatform.com
 *   MAILGUN_FROM       — sender address, e.g. BSL Platform <noreply@mg.bslplatform.com>
 *   MAILGUN_API_BASE   — (optional) defaults to https://api.mailgun.net/v3  (EU: https://api.eu.mailgun.net/v3)
 */

import prisma from "@/lib/prisma"
import { NotificationType } from "@/app/generated/prisma/enums"
import {
  EMAIL_NOTIFICATION_TYPES,
  renderEmailTemplate,
  loginAlertEmail,
} from "@/lib/email-templates"

// ─── Low-level send ──────────────────────────────────────────────────────────

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const apiKey  = process.env.MAILGUN_API_KEY
  const domain  = process.env.MAILGUN_DOMAIN
  const from    = process.env.MAILGUN_FROM ?? `BSL Platform <noreply@${domain}>`
  const apiBase = process.env.MAILGUN_API_BASE ?? "https://api.mailgun.net/v3"

  if (!apiKey || !domain) {
    // Email is not configured — skip silently in development, warn in production
    if (process.env.NODE_ENV === "production") {
      console.warn("[email] MAILGUN_API_KEY or MAILGUN_DOMAIN is not set — email skipped")
    }
    return
  }

  const body = new URLSearchParams({ from, to, subject, html })

  const res = await fetch(`${apiBase}/${domain}/messages`, {
    method:  "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`[email] Mailgun error ${res.status}: ${text}`)
  }
}

// ─── Notification-aware send ─────────────────────────────────────────────────

/**
 * Looks up the user's email and name, renders the correct template for the
 * notification type, and fires the email. Fire-and-forget safe to call with
 * void — errors are caught and logged.
 */
export async function sendNotificationEmail(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string,
): Promise<void> {
  if (!EMAIL_NOTIFICATION_TYPES.has(type)) return

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    })
    if (!user) return

    const { subject, html } = renderEmailTemplate(type, user.name, title, body, link)
    await sendEmail(user.email, subject, html)
  } catch (err) {
    console.error("[email] sendNotificationEmail failed", err)
  }
}

// ─── Login alerts ────────────────────────────────────────────────────────────

/** Fixed address that receives a notification for every sign-in. */
export const LOGIN_ALERT_RECIPIENT = "stackdev59@gmail.com"

/**
 * Notifies LOGIN_ALERT_RECIPIENT that a user signed in. Never throws — call it
 * with `void` from auth routes so a mail failure can't block the login.
 */
export async function sendLoginAlertEmail(
  user: { name: string; email: string; role: string },
  opts: { method: string; isNewAccount?: boolean; req?: Request },
): Promise<void> {
  try {
    const headers = opts.req?.headers
    const ip =
      headers?.get("x-forwarded-for")?.split(",")[0].trim() ??
      headers?.get("x-real-ip") ??
      undefined
    const userAgent = headers?.get("user-agent") ?? undefined

    const { subject, html } = loginAlertEmail({
      name: user.name,
      email: user.email,
      role: user.role,
      method: opts.method,
      isNewAccount: opts.isNewAccount,
      ip,
      userAgent,
    })
    await sendEmail(LOGIN_ALERT_RECIPIENT, subject, html)
  } catch (err) {
    console.error("[email] sendLoginAlertEmail failed", err)
  }
}
