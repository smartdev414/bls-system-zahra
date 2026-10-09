/**
 * BSL Platform — Email Templates
 *
 * All templates share a consistent professional layout using the platform's
 * primary colour schema:
 *   Primary    #7C3AED  (violet-600, matches --primary oklch 0.52 0.22 290)
 *   Accent     #0EA5E9  (sky-500,   matches --secondary oklch 0.58 0.16 195)
 *   Background #F9FAFB
 *   Text       #111827
 */

import { NotificationType } from "@/app/generated/prisma/enums"

// ─── Palette ────────────────────────────────────────────────────────────────
const PRIMARY       = "#7C3AED"
const PRIMARY_DARK  = "#6D28D9"
const ACCENT        = "#0EA5E9"
const BG            = "#F9FAFB"
const CARD_BG       = "#FFFFFF"
const TEXT_MAIN     = "#111827"
const TEXT_MUTED    = "#6B7280"
const BORDER        = "#E5E7EB"

// ─── Base layout ────────────────────────────────────────────────────────────
function layout(content: string, previewText = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <title>BSL Platform</title>
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{-ms-interpolation-mode:bicubic}
    body{margin:0;padding:0;background:${BG};font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    a{color:${PRIMARY};text-decoration:none}
    .btn:hover{background:${PRIMARY_DARK} !important}
  </style>
</head>
<body style="margin:0;padding:0;background:${BG}">
${previewText ? `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all">${previewText}</span>` : ""}

<!-- Wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};min-width:100%">
  <tr><td align="center" style="padding:40px 16px 24px">

    <!-- Card -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
      style="max-width:600px;width:100%;background:${CARD_BG};border-radius:12px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 4px 24px rgba(0,0,0,.06)">

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,${PRIMARY} 0%,${ACCENT} 100%);padding:32px 40px;text-align:center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="text-align:center">
                <!-- Logo mark -->
                <div style="display:inline-block;width:44px;height:44px;background:rgba(255,255,255,.2);border-radius:10px;line-height:44px;font-size:22px;margin-bottom:12px">🤟</div>
                <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px">BSL Platform</div>
                <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:2px;letter-spacing:0.5px;text-transform:uppercase">British Sign Language Learning</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:36px 40px 28px">
          ${content}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="border-top:1px solid ${BORDER};padding:20px 40px;background:#FAFAFA;border-radius:0 0 12px 12px">
          <p style="margin:0;font-size:12px;color:${TEXT_MUTED};text-align:center;line-height:1.6">
            You received this email because you have an account on BSL Platform.<br/>
            If you have questions, reply to this email or visit
            <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "#"}" style="color:${PRIMARY}">bslplatform.com</a>.
          </p>
        </td>
      </tr>

    </table>
    <!-- / Card -->

  </td></tr>
</table>
<!-- / Wrapper -->

</body>
</html>`
}

// ─── Shared helpers ─────────────────────────────────────────────────────────
function greeting(name: string) {
  return `<p style="margin:0 0 20px;font-size:16px;color:${TEXT_MAIN};font-weight:600">Hi ${name},</p>`
}

function bodyText(text: string) {
  return `<p style="margin:0 0 16px;font-size:15px;color:${TEXT_MUTED};line-height:1.7">${text}</p>`
}

function ctaButton(label: string, href: string) {
  const url = href.startsWith("http") ? href : `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${href}`
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
    <tr>
      <td style="border-radius:8px;background:${PRIMARY}">
        <a class="btn" href="${url}"
          style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#fff;text-decoration:none;border-radius:8px;background:${PRIMARY};letter-spacing:.1px">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

function badge(label: string, color: string = PRIMARY) {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;background:${color}18;color:${color};font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase">${label}</span>`
}

function divider() {
  return `<hr style="border:none;border-top:1px solid ${BORDER};margin:20px 0" />`
}

function infoRow(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:${TEXT_MUTED};width:40%">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:${TEXT_MAIN};font-weight:500">${value}</td>
  </tr>`
}

// ─── Individual templates ────────────────────────────────────────────────────

function sessionScheduled(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("New Session", PRIMARY)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">A live session has been scheduled</h2>
    ${bodyText(body)}
    ${link ? ctaButton("View Session", link) : ""}
    ${divider()}
    ${bodyText("Make sure to join on time — live sessions are interactive and attendance is recorded.")}
  `
  return layout(content, `New live session: ${body}`)
}

function sessionStarted(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("🔴 Live Now", "#DC2626")}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">Your session is live!</h2>
    ${bodyText(body)}
    ${link ? ctaButton("Join Session Now", link) : ""}
    ${divider()}
    ${bodyText("Don't miss out — join the session right now from the classroom.")}
  `
  return layout(content, `Live now: ${body}`)
}

function sessionInvite(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Invitation", ACCENT)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">You've been invited to a session</h2>
    ${bodyText(body)}
    ${link ? ctaButton("View Invitation", link) : ""}
    ${divider()}
    ${bodyText("This is a private session. Your place has been reserved by your tutor.")}
  `
  return layout(content, `Session invite: ${body}`)
}

function sessionCoTutorInvite(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Co-teaching", PRIMARY)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">You've been invited to co-teach</h2>
    ${bodyText(body)}
    ${link ? ctaButton("Open Classroom", link) : ""}
    ${divider()}
    ${bodyText("Open the classroom to join as a second teacher — you'll have full tutor controls alongside the host.")}
  `
  return layout(content, `Co-teaching invite: ${body}`)
}

function sessionCancelled(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Cancelled", "#DC2626")}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">Session cancelled</h2>
    ${bodyText(body)}
    ${bodyText("We're sorry for any inconvenience. Check the sessions page for upcoming sessions.")}
    ${link ? ctaButton("View Sessions", link) : ""}
  `
  return layout(content, `Session cancelled: ${body}`)
}

function sessionDeleted(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Removed", TEXT_MUTED)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">Session removed</h2>
    ${bodyText(body)}
    ${link ? ctaButton("View All Sessions", link) : ""}
  `
  return layout(content, body)
}

function newEnrollment(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Enrollment", "#059669")}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">Enrollment update</h2>
    ${bodyText(body)}
    ${link ? ctaButton("Go to Course", link) : ""}
    ${divider()}
    ${bodyText("Keep up the great work — consistent learning is the key to mastering BSL.")}
  `
  return layout(content, body)
}

function newReview(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("New Review", "#D97706")}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">A student left a review</h2>
    ${bodyText(body)}
    ${link ? ctaButton("View Review", link) : ""}
  `
  return layout(content, `New review: ${body}`)
}

function newTutorReview(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Tutor Review", "#D97706")}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">A student rated you</h2>
    <div style="background:${BG};border-left:3px solid #D97706;border-radius:0 8px 8px 0;padding:14px 16px;margin:0 0 20px;font-size:14px;color:${TEXT_MUTED};line-height:1.6;font-style:italic">
      ${body}
    </div>
    ${link ? ctaButton("View All Reviews", link) : ""}
    ${divider()}
    ${bodyText("Student reviews help you understand how you're doing and where to improve. Keep up the great teaching!")}
  `
  return layout(content, `New tutor review: ${body}`)
}

function quizResult(name: string, body: string, passed: boolean, link?: string): string {
  const color = passed ? "#059669" : "#DC2626"
  const label = passed ? "Passed ✓" : "Not Passed"
  const headline = passed ? "Well done — you passed!" : "Quiz result"
  const motivational = passed
    ? "Excellent work! Keep it up and move on to the next lesson."
    : "Don't worry — review the material and try again. You can do it!"

  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge(label, color)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">${headline}</h2>
    ${bodyText(body)}
    ${bodyText(motivational)}
    ${link ? ctaButton("View Results", link) : ""}
  `
  return layout(content, body)
}

function newMessage(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("New Message", ACCENT)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">You have a new message</h2>
    <div style="background:${BG};border-left:3px solid ${PRIMARY};border-radius:0 8px 8px 0;padding:14px 16px;margin:0 0 20px;font-size:14px;color:${TEXT_MUTED};line-height:1.6;font-style:italic">
      ${body}
    </div>
    ${link ? ctaButton("Reply", link) : ""}
  `
  return layout(content, `New message: ${body}`)
}

function coursePublished(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Course Update", PRIMARY)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">A course you're enrolled in has been updated</h2>
    ${bodyText(body)}
    ${link ? ctaButton("Go to Course", link) : ""}
    ${divider()}
    ${bodyText("Log in to explore the latest content and continue your BSL journey.")}
  `
  return layout(content, body)
}

function newLesson(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("New Lesson", "#059669")}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">New lesson available</h2>
    ${bodyText(body)}
    ${link ? ctaButton("Start Lesson", link) : ""}
    ${divider()}
    ${bodyText("New content has been added — start learning today!")}
  `
  return layout(content, body)
}

function recordingReady(name: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Recording Ready", ACCENT)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">Session recording is available</h2>
    ${bodyText(body)}
    ${link ? ctaButton("Watch Recording", link) : ""}
  `
  return layout(content, body)
}

export function passwordResetEmail(
  recipientName: string,
  resetUrl: string,
  expiresInMinutes: number,
): { subject: string; html: string } {
  const content = `
    ${greeting(recipientName)}
    <div style="margin-bottom:16px">${badge("Password Reset", PRIMARY)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">Reset your password</h2>
    ${bodyText("We received a request to reset the password for your BSL Platform account. Click the button below to choose a new password.")}
    ${ctaButton("Reset Password", resetUrl)}
    ${divider()}
    ${bodyText(`This link will expire in <strong>${expiresInMinutes} minutes</strong> and can only be used once. If you didn't request a password reset, you can safely ignore this email — your password will stay the same.`)}
    ${bodyText(`If the button above doesn't work, copy and paste this URL into your browser:<br/><a href="${resetUrl}" style="color:${PRIMARY};word-break:break-all">${resetUrl}</a>`)}
  `
  return {
    subject: "Reset your BSL Platform password",
    html: layout(content, "Reset your BSL Platform password"),
  }
}

export function tutorInviteEmail(
  tutorName: string,
  inviteUrl: string,
  expiresInDays: number,
  expiresInMonths: number,
): { subject: string; html: string } {
  const content = `
    <div style="margin-bottom:16px">${badge("You're Invited!", PRIMARY)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">Join BSL Platform</h2>
    ${bodyText(`<strong>${tutorName}</strong> has invited you to join the BSL Platform as a student. Click the button below to create your free account and get started learning British Sign Language.`)}
    ${ctaButton("Accept Invitation & Sign Up", inviteUrl)}
    ${divider()}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      ${infoRow("Invited by", tutorName)}
      ${infoRow("Expires in", `${expiresInMonths} months`)}
      ${infoRow("Role", "Student")}
    </table>
    ${divider()}
    ${bodyText(`This invitation link is personal to you and will expire in ${expiresInDays} days. If you did not expect this email, you can safely ignore it.`)}
  `
  return {
    subject: `${tutorName} invited you to join BSL Platform`,
    html: layout(content, `${tutorName} has invited you to learn BSL`),
  }
}

function ticketComment(name: string, body: string, commentText: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <div style="margin-bottom:16px">${badge("Ticket Reply", PRIMARY)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">The support team replied to your ticket</h2>
    ${bodyText(body)}
    <div style="background:${BG};border-left:3px solid ${PRIMARY};border-radius:0 8px 8px 0;padding:14px 16px;margin:0 0 20px;font-size:14px;color:${TEXT_MUTED};line-height:1.6;font-style:italic">
      ${commentText}
    </div>
    ${link ? ctaButton("View Ticket", link) : ""}
    ${divider()}
    ${bodyText("You can reply directly in your ticket page. We aim to resolve all issues as quickly as possible.")}
  `
  return layout(content, `Support reply: ${body}`)
}

function generic(name: string, title: string, body: string, link?: string): string {
  const content = `
    ${greeting(name)}
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_MAIN}">${title}</h2>
    ${bodyText(body)}
    ${link ? ctaButton("View Details", link) : ""}
  `
  return layout(content, body)
}

// ─── Public dispatcher ───────────────────────────────────────────────────────

export const EMAIL_NOTIFICATION_TYPES = new Set<NotificationType>([
  NotificationType.SESSION_SCHEDULED,
  NotificationType.SESSION_STARTED,
  NotificationType.SESSION_INVITE,
  NotificationType.SESSION_COTUTOR_INVITE,
  NotificationType.SESSION_CANCELLED,
  NotificationType.SESSION_DELETED,
  NotificationType.NEW_ENROLLMENT,
  NotificationType.NEW_REVIEW,
  NotificationType.NEW_TUTOR_REVIEW,
  NotificationType.CERT_STEP_REVIEWED,
  NotificationType.CERT_COMPLETED,
  NotificationType.CERT_SUBMISSION_RECEIVED,
  NotificationType.SESSION_JOIN_REQUEST,
  NotificationType.SESSION_REQUEST_APPROVED,
  NotificationType.SESSION_REQUEST_REJECTED,
  NotificationType.QUIZ_PASSED,
  NotificationType.QUIZ_FAILED,
  NotificationType.NEW_MESSAGE,
  NotificationType.COURSE_PUBLISHED,
  NotificationType.NEW_LESSON,
  NotificationType.RECORDING_READY,
  NotificationType.TICKET_RESOLVED,
  NotificationType.TICKET_COMMENT,
  NotificationType.HOMEWORK_REMINDER,
  NotificationType.COURSE_TEACHER_ADDED,
  NotificationType.VIDEO_BACKGROUND_READY,
  NotificationType.VIDEO_BACKGROUND_FAILED,
])

export function renderEmailTemplate(
  type: NotificationType,
  recipientName: string,
  title: string,
  body: string,
  link?: string,
): { subject: string; html: string } {
  const subjects: Partial<Record<NotificationType, string>> = {
    [NotificationType.SESSION_SCHEDULED]:  `📅 New session scheduled — ${title}`,
    [NotificationType.SESSION_STARTED]:    `🔴 Live now — ${title}`,
    [NotificationType.SESSION_INVITE]:     `📩 You're invited — ${title}`,
    [NotificationType.SESSION_COTUTOR_INVITE]: `🤝 Co-teaching invite — ${title}`,
    [NotificationType.SESSION_CANCELLED]:  `❌ Session cancelled — ${title}`,
    [NotificationType.SESSION_DELETED]:    `Session removed — ${title}`,
    [NotificationType.NEW_ENROLLMENT]:     `🎓 ${title}`,
    [NotificationType.NEW_REVIEW]:         `⭐ New review — ${title}`,
    [NotificationType.NEW_TUTOR_REVIEW]:   `⭐ A student rated you — ${title}`,
    [NotificationType.CERT_STEP_REVIEWED]:        `📋 ${title}`,
    [NotificationType.CERT_COMPLETED]:             `🎓 ${title}`,
    [NotificationType.CERT_SUBMISSION_RECEIVED]:   `📥 ${title}`,
    [NotificationType.SESSION_JOIN_REQUEST]:     `🙋 Join request — ${title}`,
    [NotificationType.SESSION_REQUEST_APPROVED]: `✅ Request approved — ${title}`,
    [NotificationType.SESSION_REQUEST_REJECTED]: `❌ Request declined — ${title}`,
    [NotificationType.QUIZ_PASSED]:        `✅ Quiz passed — ${title}`,
    [NotificationType.QUIZ_FAILED]:        `📝 Quiz result — ${title}`,
    [NotificationType.NEW_MESSAGE]:        `💬 ${title}`,
    [NotificationType.COURSE_PUBLISHED]:   `🚀 ${title}`,
    [NotificationType.NEW_LESSON]:         `📖 ${title}`,
    [NotificationType.RECORDING_READY]:    `🎬 ${title}`,
    [NotificationType.TICKET_RESOLVED]:    `✅ Your ticket has been resolved — ${title}`,
    [NotificationType.TICKET_COMMENT]:     `💬 Support replied to your ticket — ${title}`,
    [NotificationType.HOMEWORK_REMINDER]:  `⏰ ${title}`,
    [NotificationType.COURSE_TEACHER_ADDED]: `🎓 ${title}`,
    [NotificationType.VIDEO_BACKGROUND_READY]:  `🎬 ${title}`,
    [NotificationType.VIDEO_BACKGROUND_FAILED]: `⚠️ ${title}`,
  }

  const subject = subjects[type] ?? `BSL Platform — ${title}`

  let html: string
  switch (type) {
    case NotificationType.SESSION_SCHEDULED: html = sessionScheduled(recipientName, body, link); break
    case NotificationType.SESSION_STARTED:   html = sessionStarted(recipientName, body, link);   break
    case NotificationType.SESSION_INVITE:    html = sessionInvite(recipientName, body, link);    break
    case NotificationType.SESSION_COTUTOR_INVITE: html = sessionCoTutorInvite(recipientName, body, link); break
    case NotificationType.SESSION_CANCELLED: html = sessionCancelled(recipientName, body, link); break
    case NotificationType.SESSION_DELETED:   html = sessionDeleted(recipientName, body, link);   break
    case NotificationType.NEW_ENROLLMENT:    html = newEnrollment(recipientName, body, link);    break
    case NotificationType.NEW_REVIEW:        html = newReview(recipientName, body, link);        break
    case NotificationType.NEW_TUTOR_REVIEW:        html = newTutorReview(recipientName, body, link);   break
    case NotificationType.CERT_STEP_REVIEWED:        html = generic(recipientName, title, body, link);   break
    case NotificationType.CERT_COMPLETED:             html = generic(recipientName, title, body, link);   break
    case NotificationType.CERT_SUBMISSION_RECEIVED:   html = generic(recipientName, title, body, link);   break
    case NotificationType.SESSION_JOIN_REQUEST:     html = generic(recipientName, title, body, link);   break
    case NotificationType.SESSION_REQUEST_APPROVED: html = generic(recipientName, title, body, link);   break
    case NotificationType.SESSION_REQUEST_REJECTED: html = generic(recipientName, title, body, link);   break
    case NotificationType.QUIZ_PASSED:       html = quizResult(recipientName, body, true, link); break
    case NotificationType.QUIZ_FAILED:       html = quizResult(recipientName, body, false, link);break
    case NotificationType.NEW_MESSAGE:       html = newMessage(recipientName, body, link);       break
    case NotificationType.COURSE_PUBLISHED:  html = coursePublished(recipientName, body, link);  break
    case NotificationType.NEW_LESSON:        html = newLesson(recipientName, body, link);        break
    case NotificationType.RECORDING_READY:   html = recordingReady(recipientName, body, link);   break
    case NotificationType.TICKET_RESOLVED:   html = generic(recipientName, title, body, link);   break
    case NotificationType.HOMEWORK_REMINDER:    html = generic(recipientName, title, body, link); break
    case NotificationType.COURSE_TEACHER_ADDED: html = generic(recipientName, title, body, link); break
    // body = ticket title, title = comment preview (passed as title for subject reuse)
    case NotificationType.TICKET_COMMENT:    html = ticketComment(recipientName, `Re: "${title}"`, body, link); break
    default:                                 html = generic(recipientName, title, body, link);   break
  }

  return { subject, html }
}
