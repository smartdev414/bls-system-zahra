/**
 * "Add to calendar" for a class: builds a one-event .ics file and hands it to
 * the browser. Phones open it straight into the calendar app, and desktop
 * calendars (Outlook, Apple, Google via import) all read the same format.
 */
export type CalendarEvent = {
  id: string
  title: string
  start: Date
  durationMins: number
  url: string
  description?: string
  /** A face-to-face class's venue. Such a class has no online room to join. */
  location?: string | null
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")

// Commas, semicolons, backslashes and newlines are special in .ics text.
const escape = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")

export function buildIcs(event: CalendarEvent): string {
  const end = new Date(event.start.getTime() + event.durationMins * 60_000)
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DeafSign//Classes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // Stable per class, so adding it again updates the event instead of doubling it.
    `UID:${event.id}@deafsign`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape([event.description, event.location ? null : `Join: ${event.url}`].filter(Boolean).join("\n"))}`,
    ...(event.location ? [`LOCATION:${escape(event.location)}`] : []),
    `URL:${event.url}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escape(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n")
}

export function downloadIcs(event: CalendarEvent) {
  const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" })
  const href = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = href
  a.download = `${event.title.replace(/[^\w\- ]+/g, "").trim() || "class"}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
