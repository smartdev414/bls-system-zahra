"use client"

/**
 * Open the file chooser in the folder the teacher used last time.
 *
 * `<input type="file">` gives the browser no say in where the dialog opens, and
 * in practice teachers keep their decks several folders deep in Documents or on
 * a shared drive. Every upload meant navigating there from scratch.
 *
 * The File System Access API fixes exactly this: `showOpenFilePicker` takes an
 * `id`, and the browser remembers the directory last used under that id —
 * across dialogs, across pages, and across restarts. `startIn` seeds it for the
 * very first time.
 *
 * Chrome and Edge support it. Firefox and Safari do not, and it needs a secure
 * context, so this always degrades to the plain input the caller already has.
 */

/** Stable across the whole app: all presentation picking shares one folder. */
const PICKER_ID = "bsl-presentations"

/**
 * Which picker ids this device has already used.
 *
 * `startIn` and `id` both feed the same decision, and the browser is supposed to
 * let a remembered folder win. Relying on that is not worth it: the cost of
 * being wrong is exactly the bug teachers keep reporting — the dialog opening
 * back at Documents every time. So once a folder has been chosen under an id,
 * stop sending `startIn` at all and leave the browser nothing to prefer.
 */
const USED_IDS_KEY = "bsl:file-picker-used"

function usedIds(): string[] {
  try {
    const raw = window.localStorage.getItem(USED_IDS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []
  } catch {
    // Site data disabled. Seeding `startIn` every time is the old behaviour,
    // not a new failure.
    return []
  }
}

function hasPickedBefore(id: string): boolean {
  if (typeof window === "undefined") return false
  return usedIds().includes(id)
}

function markPickedBefore(id: string): void {
  try {
    const ids = usedIds()
    if (ids.includes(id)) return
    window.localStorage.setItem(USED_IDS_KEY, JSON.stringify([...ids, id]))
  } catch { /* nothing to remember with — the id still works within the session */ }
}

type FilePickerAcceptType = {
  description?: string
  accept: Record<string, string[]>
}

type OpenFilePickerOptions = {
  id?: string
  startIn?: string
  multiple?: boolean
  excludeAcceptAllOption?: boolean
  types?: FilePickerAcceptType[]
}

type FileSystemFileHandleLike = { getFile: () => Promise<File> }

type WindowWithPicker = Window & {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandleLike[]>
}

/**
 * ONE group, never several. Chrome on macOS turns each group into an entry in
 * the dialog's "Format" dropdown and preselects the first, so with separate
 * "Slides" and "Video" groups every .mp4 showed up greyed out and unclickable —
 * teachers reported it as "I can't upload video any more".
 */
const ACCEPT: FilePickerAcceptType[] = [
  {
    description: "Slides and video",
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.ms-powerpoint": [".ppt"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
      "video/webm": [".webm"],
    },
  },
]

export function supportsFolderMemory(): boolean {
  if (typeof window === "undefined") return false
  return typeof (window as WindowWithPicker).showOpenFilePicker === "function"
}

export type PickResult =
  /** The teacher chose a file. */
  | { status: "picked"; file: File }
  /** They closed the dialog. Not an error, and must not raise one. */
  | { status: "cancelled" }
  /** This browser has no folder memory — fall back to the plain input. */
  | { status: "unsupported" }

/**
 * Must be called directly from a click handler: the API requires a user
 * gesture, and awaiting anything first spends it.
 */
export async function pickPresentationFile(): Promise<PickResult> {
  const picker = (window as WindowWithPicker).showOpenFilePicker
  if (typeof picker !== "function") return { status: "unsupported" }

  const seedFolder = !hasPickedBefore(PICKER_ID)

  try {
    const [handle] = await picker({
      id: PICKER_ID,
      // Only on the very first pick. From then on the id alone decides, so the
      // dialog reopens wherever the teacher was last time.
      ...(seedFolder ? { startIn: "documents" as const } : {}),
      multiple: false,
      types: ACCEPT,
    })
    if (!handle) return { status: "cancelled" }
    const file = await handle.getFile()
    markPickedBefore(PICKER_ID)
    return { status: "picked", file }
  } catch (err) {
    // AbortError is the teacher pressing Cancel — the overwhelmingly common
    // outcome, and not something to report. Anything else means the API is
    // present but unusable here (a policy block, a sandboxed frame), so hand
    // back to the plain input rather than leaving them unable to choose a file.
    if ((err as { name?: string })?.name === "AbortError") return { status: "cancelled" }
    console.warn("[pick-file] falling back to the standard file input", err)
    return { status: "unsupported" }
  }
}
