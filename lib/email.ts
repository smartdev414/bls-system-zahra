/**
 * Mailgun email sender.
 *
 * Required environment variables:
 *   MAILGUN_API_KEY    — your Mailgun private API key
 *   MAILGUN_DOMAIN     — your sending domain, e.g. mg.bslplatform.com
 *   MAILGUN_FROM       — sender address, e.g. Teach Me Sign Student Space Platform <noreply@mg.bslplatform.com>
 *   MAILGUN_API_BASE   — (optional) defaults to https://api.mailgun.net/v3  (EU: https://api.eu.mailgun.net/v3)
 */

import prisma from "@/lib/prisma"
import { NotificationType } from "@/app/generated/prisma/enums"
import { EMAIL_NOTIFICATION_TYPES, renderEmailTemplate } from "@/lib/email-templates"

// ─── Low-level send ──────────────────────────────────────────────────────────

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const apiKey  = process.env.MAILGUN_API_KEY
  const domain  = process.env.MAILGUN_DOMAIN
  const from    = process.env.MAILGUN_FROM ?? `Teach Me Sign Student Space Platform <noreply@${domain}>`
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
  testName?: string,
): Promise<void> {
  if (!EMAIL_NOTIFICATION_TYPES.has(type)) return

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, status: true },
    })
    // A suspended student hears nothing from us until staff lift the suspension.
    if (!user || user.status === "SUSPENDED") return

    const { subject, html } = renderEmailTemplate(type, user.name, title, body, link, testName)
    await sendEmail(user.email, subject, html)
  } catch (err) {
    console.error("[email] sendNotificationEmail failed", err)
  }
}
