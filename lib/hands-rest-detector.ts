// Tells when a signer has finished: their hands have come back to where they
// were resting before the sign began. The dictionary recorder uses it to stop
// a take by itself, so the signer never has to reach for the keyboard.
//
// A pose model finds the shoulders and arms a few times a second. Where the
// wrists settle as recording starts is taken as the rest position — clasped at
// the waist, down by the sides, on the lap, whatever the signer does — so
// nothing about how they stand or sit has to be assumed. A hand counts as
// signing once it has been raised well away from there, and the sign as over
// once both hands are back and have stayed for a moment.

import type { PoseLandmarker } from "@mediapipe/tasks-vision"

// Keep in step with the @mediapipe/tasks-vision version in package.json.
const TASKS_VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"

// Distances are in shoulder widths, so they hold at any distance from the camera.
/** A hand this far from its rest position has started signing. */
const LEAVE_DISTANCE = 0.5
/** A hand back within this of its rest position has finished. */
const RETURN_DISTANCE = 0.35
/** How long both hands must stay back before the sign counts as over. */
const REST_HOLD_MS = 450
/** How long a hand must be away before the sign counts as started. */
const LEAVE_HOLD_MS = 120
/** How long the hands must hold still, lowered, to be taken as resting. */
const CALIBRATION_MS = 400
/** How far back poses are kept for that: longer, so a slow computer that only
 * manages a few poses a second still has enough to go on. */
const CALIBRATION_WINDOW_MS = 650
/** How far a resting hand may wander in that time (the model's guess jitters). */
const STEADY_DISTANCE = 0.25
const MIN_VISIBILITY = 0.5
/** Poses looked at per second. Hands are slow next to this, and it is cheap. */
const SAMPLE_INTERVAL_MS = 70

type Point = { x: number; y: number }
/**
 * One look at the signer. The wrists are the model's best guess even when it
 * can't see them (resting below the picture, say): that guess is steady
 * enough, and "can it see them" flickers too much at the edge to go by.
 */
export type PoseSample = {
  left: Point
  right: Point
  shoulderWidth: number
  /** Wrist below its elbow — true of a resting hand, rarely of a signing one. */
  leftLowered: boolean
  rightLowered: boolean
}
export type RestState = "calibrating" | "ready" | "signing" | "done"

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function restPoint(points: Point[]): Point {
  return { x: median(points.map((p) => p.x)), y: median(points.map((p) => p.y)) }
}

/**
 * The reasoning, kept apart from the camera and the model so it can be run
 * over recorded poses. Feed it every sample with `add`; call `begin` when
 * recording starts.
 */
export function createRestTracker() {
  let samples: { time: number; sample: PoseSample }[] = []
  let rest: { left: Point; right: Point } | null = null
  let began: number | null = null
  let state: RestState = "calibrating"
  let awaySince: number | null = null
  let signedUnseen = false
  let backSince: number | null = null
  let restTime: number | null = null

  function away(wrist: Point, home: Point, scale: number, limit: number): boolean {
    return Math.hypot(wrist.x - home.x, wrist.y - home.y) / scale > limit
  }

  // The rest position is only taken from hands that are lowered and still:
  // a hand on its way back from the keyboard, or a signer who starts at once
  // and pauses mid-sign, must not be mistaken for it.
  function calibrate(now: number): boolean {
    if (samples.length < 3 || now - samples[0].time < CALIBRATION_MS) return false
    if (!samples.every((s) => s.sample.leftLowered && s.sample.rightLowered)) return false
    const home = {
      left: restPoint(samples.map((s) => s.sample.left)),
      right: restPoint(samples.map((s) => s.sample.right)),
    }
    const steady = samples.every(({ sample }) =>
      !away(sample.left, home.left, sample.shoulderWidth, STEADY_DISTANCE) &&
      !away(sample.right, home.right, sample.shoulderWidth, STEADY_DISTANCE))
    if (!steady) return false
    rest = home
    return true
  }

  return {
    get state() { return state },
    /** When the hands came to rest, in the same clock as `add`'s times. */
    get restTime() { return restTime },
    begin(time: number) {
      began = time
    },
    add(time: number, sample: PoseSample | null): RestState {
      if (state === "done") return state
      if (!sample) return state
      if (state === "calibrating") {
        samples.push({ time, sample })
        samples = samples.filter((s) => s.time >= time - CALIBRATION_WINDOW_MS)
        // Before recording this only keeps the last moments in hand, so the
        // rest position is as fresh as it can be when recording starts.
        if (began === null) return state
        // The signer went straight into the sign, before their hands had been
        // seen at rest. The first time they are lowered and still is the end.
        const raised = !sample.leftLowered || !sample.rightLowered
        awaySince = raised ? awaySince ?? time : null
        if (awaySince !== null && time - awaySince >= LEAVE_HOLD_MS) signedUnseen = true
        if (calibrate(time)) {
          awaySince = null
          if (signedUnseen) restTime = samples[0].time
          state = signedUnseen ? "done" : "ready"
        }
        return state
      }
      if (!rest) return state
      if (state === "ready") {
        // A hand that moves but stays lowered is settling, not signing (it
        // was on the keyboard, say): follow it to where it comes to rest.
        samples.push({ time, sample })
        samples = samples.filter((s) => s.time >= time - CALIBRATION_WINDOW_MS)
        calibrate(time)
        const raised =
          (!sample.leftLowered && away(sample.left, rest.left, sample.shoulderWidth, LEAVE_DISTANCE)) ||
          (!sample.rightLowered && away(sample.right, rest.right, sample.shoulderWidth, LEAVE_DISTANCE))
        awaySince = raised ? awaySince ?? time : null
        if (awaySince !== null && time - awaySince >= LEAVE_HOLD_MS) state = "signing"
        return state
      }
      const isAway =
        away(sample.left, rest.left, sample.shoulderWidth, RETURN_DISTANCE) ||
        away(sample.right, rest.right, sample.shoulderWidth, RETURN_DISTANCE)
      backSince = isAway ? null : backSince ?? time
      if (backSince !== null && time - backSince >= REST_HOLD_MS) {
        restTime = backSince
        state = "done"
      }
      return state
    },
  }
}

/** Shoulders and wrists from a pose result, or null when no one is in view. */
export function poseSample(
  landmarks: { x: number; y: number; visibility?: number }[] | undefined,
  aspect: number,
): PoseSample | null {
  if (!landmarks || landmarks.length < 17) return null
  // x is scaled so that a distance means the same across and down the picture.
  const point = (i: number): Point => ({ x: landmarks[i].x * aspect, y: landmarks[i].y })
  const visible = (i: number) => (landmarks[i].visibility ?? 0) >= MIN_VISIBILITY
  if (!visible(11) || !visible(12)) return null
  const shoulderWidth = Math.hypot(point(11).x - point(12).x, point(11).y - point(12).y)
  if (shoulderWidth < 0.02) return null
  return {
    left: point(15),
    right: point(16),
    shoulderWidth,
    leftLowered: landmarks[15].y > landmarks[13].y,
    rightLowered: landmarks[16].y > landmarks[14].y,
  }
}

export type HandsRestDetector = {
  /**
   * Start looking at the signer. Call a moment before recording (when the
   * countdown starts) so the rest position is known by the time it begins.
   */
  watch: () => void
  /** Call when recording starts. `onRest` fires once, when the sign is over. */
  begin: (onRest: () => void) => void
  /** Call when the take is over or abandoned. Stops looking. */
  end: () => void
  destroy: () => void
}

/**
 * Loads the pose model for watching the signer in `video`. Rejects if it
 * can't be loaded.
 */
export async function createHandsRestDetector(video: HTMLVideoElement): Promise<HandsRestDetector> {
  const vision = await import("@mediapipe/tasks-vision")
  const fileset = await vision.FilesetResolver.forVisionTasks(TASKS_VISION_WASM)
  // On the CPU: the model is small, and the GPU is busy with the background.
  const landmarker: PoseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  })

  // The first pose takes several times longer than the rest; get it out of
  // the way now rather than in the first moments of a take.
  if (video.readyState >= 2 && video.videoWidth) {
    try {
      landmarker.detectForVideo(video, performance.now())
    } catch {
      // Tried again, and reported, once a take starts.
    }
  }

  let tracker = createRestTracker()
  let onRest: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let lastTime = 0

  function look() {
    if (video.readyState < 2 || !video.videoWidth) return
    // The model wants times that only go up.
    const now = Math.max(performance.now(), lastTime + 1)
    lastTime = now
    let sample: PoseSample | null = null
    try {
      const result = landmarker.detectForVideo(video, now)
      sample = poseSample(result.landmarks[0], video.videoWidth / video.videoHeight)
    } catch (err) {
      console.warn("[hands-rest-detector] pose failed", err)
      return
    }
    if (tracker.add(now, sample) === "done" && onRest) {
      const done = onRest
      onRest = null
      done()
    }
  }

  function watch() {
    if (timer === null) timer = setInterval(look, SAMPLE_INTERVAL_MS)
  }

  function end() {
    if (timer !== null) clearInterval(timer)
    timer = null
    onRest = null
    tracker = createRestTracker()
  }

  return {
    watch,
    begin(callback) {
      watch()
      onRest = callback
      tracker.begin(performance.now())
    },
    end,
    destroy() {
      end()
      landmarker.close()
    },
  }
}
