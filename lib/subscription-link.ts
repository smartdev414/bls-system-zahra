import prisma from "@/lib/prisma"

/**
 * Where a student goes once their course has finished (lib/course-closing.ts):
 * the school's subscription options, a web address an admin sets in Settings.
 */

const SETTINGS_ID = "default"

/** The school's subscription options page, set by an admin in Settings. Null when not set. */
export async function subscriptionUrl(): Promise<string | null> {
  const settings = await prisma.platformSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { subscriptionUrl: true },
  })
  return settings?.subscriptionUrl ?? null
}

export async function setSubscriptionUrl(url: string | null): Promise<void> {
  await prisma.platformSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, subscriptionUrl: url },
    update: { subscriptionUrl: url },
  })
}

/**
 * A web address typed by an admin: "" or null clears it, "www.x.com" gets
 * https:// added. Undefined when it isn't a usable http(s) address.
 */
export function cleanSubscriptionUrl(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== "string") return undefined
  const typed = value.trim()
  if (!typed) return null
  if (typed.length > 500) return undefined
  try {
    const url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}
