/**
 * A noise gate on the audio that feeds the caption STT.
 *
 * Background sound is not a cosmetic problem for captions. A speech model asked
 * to transcribe a fan, a corridor, a keyboard or a television will not return
 * nothing — it returns its best guess at words, and those guesses land in the
 * transcript looking exactly like something a person in the room said. In a BSL
 * classroom the caption is often the only channel a participant has for the
 * spoken part of the lesson, so a plausible-looking invented line is worse than
 * a missing one: there is no audio to check it against.
 *
 * So the fix has to happen before the model, not after. This gate forwards the
 * microphone only while someone is actually speaking into it, and forwards
 * digital silence the rest of the time. Silence is forwarded rather than
 * nothing at all: the stream stays continuous, so the provider's endpointing
 * still fires on schedule and the last utterance still finalises promptly.
 *
 * Three details make it usable on real classroom microphones:
 *
 *   - The threshold is **adaptive**. A laptop mic in a quiet front room and a
 *     headset in an open-plan office sit thirty decibels apart; a fixed
 *     threshold would gate one and pass the other. The gate tracks the room's
 *     own quiet level and opens a fixed margin above it.
 *
 *   - It **looks ahead**. Frames are held briefly before being emitted, and the
 *     decision to pass or silence them is taken once their near future is
 *     known. That is what preserves the beginning of a word — a gate that
 *     decides in the present always clips the onset, and a clipped onset is a
 *     dropped first word.
 *
 *   - It **waits before opening and waits before closing**. A single loud click
 *     is not speech, and the gaps between words are not the end of a sentence.
 */

import { AudioFrame } from "@livekit/rtc-node"

export interface NoiseGateOptions {
  /**
   * How long a frame is held before being emitted. This is the pre-roll the
   * gate has available when speech starts, and it is also added to caption
   * latency, so it stays small.
   */
  lookaheadMs: number
  /** How far above the tracked quiet level counts as speech. */
  marginDb: number
  /** The threshold never drops below this, however quiet the room gets. */
  minOpenDb: number
  /**
   * ...and never rises above this. A loud, constant background — a television
   * in the next room — drags the tracked floor up, and without a ceiling the
   * gate would eventually shut on the speaker instead of on the television.
   */
  maxOpenDb: number
  /** The gate closes this far below where it opens, so it can't chatter. */
  hysteresisDb: number
  /** Sustained loudness required to open. Rejects clicks, taps and door bangs. */
  onsetMs: number
  /** Silence required to close. Long enough to sit through pauses mid-sentence. */
  hangoverMs: number
  /** How fast the tracked floor follows the level down, per frame. */
  floorFall: number
  /** ...and up. Only ever applied while the gate is shut, so speech can't raise it. */
  floorRise: number
}

export const DEFAULT_NOISE_GATE: NoiseGateOptions = {
  lookaheadMs:  200,
  marginDb:     10,
  minOpenDb:    -58,
  maxOpenDb:    -32,
  hysteresisDb: 6,
  onsetMs:      60,
  hangoverMs:   600,
  floorFall:    0.3,
  floorRise:    0.02,
}

/** Quietest level we distinguish. Digital silence would otherwise be -Infinity. */
const FLOOR_DB = -100

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function frameDurationMs(frame: AudioFrame): number {
  return (frame.samplesPerChannel / frame.sampleRate) * 1000
}

/** RMS level of a frame in dBFS. */
export function frameLevelDb(frame: AudioFrame): number {
  const samples = frame.data
  if (samples.length === 0) return FLOOR_DB

  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]! / 32768
    sum += s * s
  }
  const rms = Math.sqrt(sum / samples.length)
  if (rms <= 0) return FLOOR_DB
  return Math.max(FLOOR_DB, 20 * Math.log10(rms))
}

function silenced(frame: AudioFrame): AudioFrame {
  return new AudioFrame(
    new Int16Array(frame.data.length),
    frame.sampleRate,
    frame.channels,
    frame.samplesPerChannel,
  )
}

export class NoiseGate {
  private readonly opts: NoiseGateOptions

  /** Tracked quiet level of this microphone. Null until the first frame. */
  private floorDb: number | null = null
  private open = false
  /** Sustained time above the open threshold while shut, and below it while open. */
  private aboveMs = 0
  private belowMs = 0

  /** Frames held for the lookahead window, oldest first. */
  private readonly held: AudioFrame[] = []
  private heldMs = 0

  constructor(opts: Partial<NoiseGateOptions> = {}) {
    this.opts = { ...DEFAULT_NOISE_GATE, ...opts }
  }

  get isOpen(): boolean { return this.open }
  get noiseFloorDb(): number | null { return this.floorDb }

  /**
   * Feed one captured frame. Returns the frames that should now go to the STT —
   * usually one, occasionally none while the lookahead window fills, and each
   * either passed through or replaced by silence.
   */
  push(frame: AudioFrame): AudioFrame[] {
    this.observe(frameLevelDb(frame), frameDurationMs(frame))

    this.held.push(frame)
    this.heldMs += frameDurationMs(frame)

    const out: AudioFrame[] = []
    while (this.held.length > 0 && this.heldMs > this.opts.lookaheadMs) {
      const oldest = this.held.shift()!
      this.heldMs -= frameDurationMs(oldest)
      // Decided now, in the emitted frame's future: this is the lookahead.
      out.push(this.open ? oldest : silenced(oldest))
    }
    return out
  }

  /**
   * Emit whatever is still held. Called when the speaker's track ends, so the
   * tail of the last sentence reaches the model before the stream is closed.
   */
  flush(): AudioFrame[] {
    const out = this.held.map((f) => (this.open ? f : silenced(f)))
    this.held.length = 0
    this.heldMs = 0
    return out
  }

  private observe(db: number, durationMs: number) {
    if (this.floorDb === null) this.floorDb = db

    const openAt  = clamp(this.floorDb + this.opts.marginDb, this.opts.minOpenDb, this.opts.maxOpenDb)
    const closeAt = openAt - this.opts.hysteresisDb

    if (this.open) {
      if (db < closeAt) {
        this.belowMs += durationMs
        if (this.belowMs >= this.opts.hangoverMs) {
          this.open = false
          this.belowMs = 0
          this.aboveMs = 0
        }
      } else {
        this.belowMs = 0
      }
    } else {
      if (db > openAt) {
        this.aboveMs += durationMs
        if (this.aboveMs >= this.opts.onsetMs) {
          this.open = true
          this.aboveMs = 0
          this.belowMs = 0
        }
      } else {
        this.aboveMs = 0
      }
    }

    // Follow the level down quickly; creep up only while we believe this is
    // room noise rather than speech.
    if (db < this.floorDb) {
      this.floorDb += (db - this.floorDb) * this.opts.floorFall
    } else if (!this.open) {
      this.floorDb += (db - this.floorDb) * this.opts.floorRise
    }
  }
}
