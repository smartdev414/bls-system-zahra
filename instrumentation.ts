import type { Instrumentation } from "next"

// Centralised server-error alerting. Next calls onRequestError whenever the
// server captures an error in a route handler, server action, or during SSR.
// We forward a concise summary to the ops webhook (see lib/alert.ts) so the
// team is notified quickly. Kept dependency-free and fail-soft.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const { sendAlert } = await import("@/lib/alert")
    const message = err instanceof Error ? err.message : String(err)
    await sendAlert(
      `Server error: ${message}`,
      `where: ${context.routeType} ${request.method} ${request.path}`,
    )
  } catch {
    // Never let alerting throw inside the error hook.
  }
}
