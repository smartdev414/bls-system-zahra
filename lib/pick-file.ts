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

const ACCEPT: FilePickerAcceptType[] = [
  {
    description: "Slides",
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.ms-powerpoint": [".ppt"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
    },
  },
  {
    description: "Video",
    accept: {
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

  try {
    const [handle] = await picker({
      id: PICKER_ID,
      // Only consulted the first time this id is used; after that the browser's
      // memory of the last folder wins, which is the entire point.
      startIn: "documents",
      multiple: false,
      types: ACCEPT,
    })
    if (!handle) return { status: "cancelled" }
    return { status: "picked", file: await handle.getFile() }
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
