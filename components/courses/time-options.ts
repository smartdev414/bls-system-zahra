// One dropdown of clock times in quarter-hour steps — a single choice instead
// of separate hour and minute pickers. Shared by the course dialogs.

const pad = (n: number) => String(n).padStart(2, "0")

/** "06:00" … "22:45". */
export const TIME_OPTIONS: string[] = Array.from({ length: (23 - 6) * 4 }, (_, i) => `${pad(6 + Math.floor(i / 4))}:${pad((i % 4) * 15)}`)

/**
 * A date's local time as one of `TIME_OPTIONS` (rounded down to the quarter
 * hour, and kept within the list's range).
 */
export function timeOf(date: Date): string {
  const value = `${pad(date.getHours())}:${pad(Math.floor(date.getMinutes() / 15) * 15)}`
  return TIME_OPTIONS.includes(value) ? value : "09:00"
}
