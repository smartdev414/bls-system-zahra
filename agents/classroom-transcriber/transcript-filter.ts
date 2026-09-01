/**
 * The second line of defence against noise in the captions.
 *
 * The gate in `noise-gate.ts` removes the audio a speech model would otherwise
 * hallucinate over. What still gets through is the loud stuff — a door, a chair,
 * a cough, someone else's voice across the room — which is loud enough to open
 * the gate and unintelligible enough that the model returns a guess.
 *
 * Those guesses are not random. Every streaming recogniser has a small set of
 * stock phrases it falls back on when handed sound that isn't speech, and they
 * are recognisable: a bare "you", a "thank you", a bracketed sound tag. They
 * arrive with visibly lower confidence than real speech, so the rule here is a
 * pair rather than a list: a phrase is dropped when it is *both* one of the
 * stock guesses *and* not confidently recognised.
 *
 * That pairing matters. "Thanks" and "yeah" are things people genuinely say in
 * a lesson, and dropping a clearly-spoken one would be its own kind of wrong
 * caption. Said properly into a microphone they come back with high confidence
 * and survive. Words that carry an answer — "yes", "no", "okay", numbers, names
 * — are deliberately not on the list at all.
 */

/**
 * Phrases a recogniser reaches for when the audio isn't speech. Kept to things
 * that carry no lesson content on their own: fillers, sign-offs, sound tags.
 */
const STOCK_GUESSES = new Set([
  "you", "you you", "thank you", "thank you very much", "thanks",
  "thanks for watching", "thank you for watching", "bye", "bye bye", "goodbye",
  "uh", "um", "erm", "mm", "mmm", "mhm", "mm hmm", "hmm", "huh", "ah", "oh",
  "eh", "hm", "yeah", "yep", "uh huh", "so", "the", "a", "and", "i", "it",
  "music", "applause", "laughter", "silence", "inaudible", "blank audio",
  "background noise", "foreign", "subscribe", "please subscribe",
])

/** Below this, nothing is published — the model is telling us it is guessing. */
const MIN_CONFIDENCE = 0.4

/** At or above this, a stock phrase is taken at face value: someone said it. */
const CLEARLY_SPOKEN = 0.75

/** Longest a stock guess can be. Beyond this it is a sentence, not an artefact. */
const MAX_STOCK_WORDS = 3

export interface TranscriptVerdict {
  publish: boolean
  /** Why it was dropped, for the log. Absent when published. */
  reason?: "empty" | "low-confidence" | "sound-tag" | "stock-guess"
}

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

/**
 * Whether a transcript is worth putting on screen.
 *
 * `confidence` is the recogniser's own score for the utterance. Providers that
 * don't report one are treated as confident, so this can only ever remove
 * transcripts we have a positive reason to distrust.
 */
export function classifyTranscript(text: string, confidence = 1): TranscriptVerdict {
  const trimmed = text.trim()

  // Nothing at all: ordinary endpointing on a stretch of silence.
  if (!trimmed) return { publish: false, reason: "empty" }

  // "[BLANK_AUDIO]", "(music)", "♪♪" — the model saying "this wasn't speech".
  if (/^[[(<{♪].*[\])>}♪]$/.test(trimmed)) return { publish: false, reason: "sound-tag" }

  // Punctuation, or a stray dash, with no word in it.
  const words = normalize(trimmed)
  if (!words) return { publish: false, reason: "empty" }

  if (confidence < MIN_CONFIDENCE) return { publish: false, reason: "low-confidence" }

  if (
    confidence < CLEARLY_SPOKEN &&
    words.split(" ").length <= MAX_STOCK_WORDS &&
    STOCK_GUESSES.has(words)
  ) {
    return { publish: false, reason: "stock-guess" }
  }

  return { publish: true }
}
