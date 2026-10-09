// Draws the lesson recorder's camera onto a canvas so the recorded video can
// carry things the raw camera can't: the brand logo stamped in a corner, and
// optionally a flat colour in place of everything behind the tutor. All of it
// runs in the browser. Used by components/ui/camera-recorder.tsx.
//
// With a background colour on, each camera frame goes through:
//   1. MediaPipe selfie segmentation → a 256×256 "how likely is this the person" mask.
//   2. Temporal pass — blends with the previous mask so edges don't shimmer,
//      but snaps straight to the new value on big changes (a moving hand).
//   3. Joint bilateral pass — pulls the low-res mask edge onto the real colour
//      edges in the camera frame, which removes the blocky stair-steps. It
//      reads a slightly blurred copy of the frame (a mip level) so camera
//      grain doesn't end up as speckle along the cut-out.
//   4. Composite — feathered mix of the flat colour and the camera frame.
// Without one, the frame is drawn as-is and the model is never downloaded.
// Either way the logo is stamped on the recorded picture last, on top.
//
// The model only guesses where the person is, and guesses worst on fast,
// motion-blurred hands. Where a plain coloured backdrop (green or blue cloth)
// hangs behind the tutor, the "backdrop" and "auto" methods do better: the
// cloth's colour is read from the top of the picture and every pixel of that
// colour is replaced directly (a chroma key) — exact per-pixel edges, and a
// blurred hand blends into the flat colour the way it would have blended into
// the cloth. The cloth rarely fills the whole picture, so the model still
// runs and decides the parts with no cloth nearby (the room past the cloth's
// edge, the middle of the tutor's body); around the cloth the key decides
// alone, so the model's misses on moving hands don't matter there.
//
// The classroom's background blur uses @livekit/track-processors, which works
// from a hard on/off mask; that reads fine under a blur and looks jagged
// against a flat colour, hence the separate renderer here.

import type { ImageSegmenter } from "@mediapipe/tasks-vision"

// Keep in step with the @mediapipe/tasks-vision version in package.json — the
// WASM runtime has to match the JS that drives it.
const TASKS_VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
// The multi-class selfie model (16 MB, cached by the browser after first use).
// It is heavier than the small selfie_segmenter the classroom blur uses, but
// that one leaves patches of the room around the head, which a blur hides and
// a flat colour does not. Its first mask is "background" confidence.
const SEGMENTER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
uniform float u_flipY;
out vec2 v_uv;
void main() {
  // Textures are uploaded top row first, so v = 0 is the top of the image.
  // Offscreen passes keep that convention (u_flipY = 1); the final pass to the
  // canvas flips it back the right way up (u_flipY = -1).
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 + a_pos.y * 0.5 * u_flipY);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const TEMPORAL_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_raw;
uniform sampler2D u_prev;
uniform float u_reset;
in vec2 v_uv;
out vec4 o;
void main() {
  float raw = texture(u_raw, v_uv).r;
  float prev = texture(u_prev, v_uv).r;
  // Small frame-to-frame differences are noise → average them out.
  // Large ones are real movement → follow immediately, no ghost trail.
  float follow = mix(0.35, 1.0, smoothstep(0.08, 0.3, abs(raw - prev)));
  o = vec4(mix(prev, raw, max(follow, u_reset)), 0.0, 0.0, 1.0);
}`

const REFINE_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_mask;
uniform sampler2D u_frame;
uniform vec2 u_step;
uniform float u_lod;
in vec2 v_uv;
out vec4 o;
void main() {
  // The frame is read from a mip level: the taps are a mask texel apart, so
  // full-res samples would alias, and raw camera grain would make the weights
  // (and so the edge) different on every frame.
  vec3 centre = textureLod(u_frame, v_uv, u_lod).rgb;
  float sum = 0.0;
  float weights = 0.0;
  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      vec2 tap = vec2(float(x), float(y));
      vec2 uv = v_uv + tap * u_step;
      vec3 diff = textureLod(u_frame, uv, u_lod).rgb - centre;
      // Neighbours count for more when they are close by and look like the
      // same surface as this pixel, so the mask stops at real edges. The small
      // floor keeps a pixel that matches none of its neighbours from falling
      // back to its own unsmoothed value.
      float w = exp(-dot(tap, tap) / 9.0) * (exp(-dot(diff, diff) / 0.02) + 0.02);
      sum += texture(u_mask, uv).r * w;
      weights += w;
    }
  }
  o = vec4(sum / weights, 0.0, 0.0, 1.0);
}`

const COMPOSITE_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform vec3 u_color;
in vec2 v_uv;
out vec4 o;
void main() {
  float person = texture(u_mask, v_uv).r;
  // Feathered edge around the half-way point. A hand in motion only scores
  // middling confidence, so a cut biased any further inwards thins the fingers
  // and lets the flat colour bleed through them.
  float alpha = smoothstep(0.4, 0.7, person);
  o = vec4(mix(u_color, texture(u_frame, v_uv).rgb, alpha), 1.0);
}`

// Chroma key for the "backdrop" method. Works on colour only (the Cb/Cr part
// of YCbCr), so shadows and uneven light on the cloth — which mostly change
// brightness — are still treated as backdrop.
const KEY_GLSL = `
uniform vec2 u_key;   // backdrop colour as (Cb, Cr)
uniform vec2 u_range; // keyness where the cut starts and where it is complete
vec3 toYcc(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(y, (c.b - y) * 0.564, (c.r - y) * 0.713);
}
// 1 = backdrop, 0 = not. How far the colour goes in the backdrop's direction,
// less part of how far it strays to either side: high for the cloth (lit or
// in shadow), zero or below for skin, hair and clothes of any other hue, and
// in between for a motion-blurred hand, which really is part cloth.
float backdrop(vec2 chroma) {
  vec2 dir = normalize(u_key);
  float along = dot(chroma, dir);
  float keyness = along - 0.5 * length(chroma - dir * along);
  return smoothstep(u_range.x, u_range.y, keyness);
}`

// A coarse map of where the cloth is, drawn very small from a blurred copy of
// the frame. The composite looks along it in each direction to ask "is this
// pixel surrounded by cloth?".
const COVERAGE_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_frame;
uniform float u_lod;
${KEY_GLSL}
in vec2 v_uv;
out vec4 o;
void main() {
  o = vec4(backdrop(toYcc(textureLod(u_frame, v_uv, u_lod).rgb).yz), 0.0, 0.0, 1.0);
}`

const CHROMA_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_frame;
uniform sampler2D u_cover;
uniform sampler2D u_mask;
uniform vec2 u_coverStep;
uniform float u_useMask;
uniform vec3 u_color;
${KEY_GLSL}
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 px = toYcc(texture(u_frame, v_uv).rgb);
  // Cameras store colour at half resolution and it is noisy, so the decision
  // is made on a slightly blurred copy (one mip level down) to keep speckle
  // off the edge.
  float alpha = 1.0 - backdrop(toYcc(textureLod(u_frame, v_uv, 1.0).rgb).yz);

  // Is there cloth on two opposite sides of this pixel, within reach? True
  // for a hand or arm held out over the cloth. False for the room beyond the
  // cloth's edge (cloth on one side only) and the middle of the tutor's body
  // (cloth too far away).
  float enclosed = 0.0;
  for (int d = 0; d < 4; d++) {
    vec2 ray = d == 0 ? vec2(1.0, 0.0) : d == 1 ? vec2(0.0, 1.0) : d == 2 ? vec2(0.7, 0.7) : vec2(0.7, -0.7);
    float ahead = 0.0;
    float behind = 0.0;
    for (int i = 1; i <= 4; i++) {
      vec2 offset = ray * float(i) * u_coverStep;
      ahead = max(ahead, texture(u_cover, v_uv + offset).r);
      behind = max(behind, texture(u_cover, v_uv - offset).r);
    }
    enclosed = max(enclosed, min(ahead, behind));
  }
  // Among cloth, not being cloth-coloured is all it takes to be kept. Away
  // from it the pixel must also be a person according to the model.
  float amongCloth = smoothstep(0.5, 0.8, enclosed);
  float person = smoothstep(0.4, 0.7, texture(u_mask, v_uv).r);
  alpha *= mix(mix(person, 1.0, amongCloth), 1.0, 1.0 - u_useMask);

  // The cloth reflects its colour onto the person's edges; take that tint out
  // of what is kept so there is no green rim against the new colour.
  vec2 dir = normalize(u_key);
  px.yz -= dir * max(dot(px.yz, dir), 0.0);
  float r = px.x + px.z / 0.713;
  float b = px.x + px.y / 0.564;
  float g = (px.x - 0.299 * r - 0.114 * b) / 0.587;
  o = vec4(mix(u_color, clamp(vec3(r, g, b), 0.0, 1.0), alpha), 1.0);
}`

// The backdrop colour is read from a small copy of the frame: its top third,
// where there is cloth either side of the tutor's head and no clothing (a
// bright shirt lower down must not be mistaken for the backdrop).
const KEY_SAMPLE_WIDTH = 64
const KEY_SAMPLE_HEIGHT = 36
const KEY_BAND_HEIGHT = 12
const KEY_HUE_BINS = 24
/** Share of that band one colour must fill to count as a backdrop. */
const KEY_MIN_SHARE = 0.3
/** Frames between re-reads, so the key follows the camera's exposure settling. */
const KEY_SAMPLE_INTERVAL = 30
/** Below this much colour the "backdrop" is a white or grey wall, which can't be keyed. */
const KEY_MIN_SATURATION = 0.07
// The "auto" method switches to the chroma key by itself, so it asks for a
// stronger colour before believing it is looking at a backdrop.
const AUTO_KEY_MIN_SATURATION = 0.1
// Colours on the skin side of the colour wheel are never a backdrop: a beige
// or wooden wall keyed out would take the tutor's face with it.
const SKIN_HUE: [number, number] = [-0.6, 0.8]
/** Failed re-reads in a row before "auto" decides the backdrop has gone. */
const AUTO_KEY_MAX_MISSES = 5

function toCbCr(r: number, g: number, b: number): [number, number] {
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  return [(b - y) * 0.564, (r - y) * 0.713]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

const GPU_WARMUP_FRAMES = 3
const GPU_SAMPLE_FRAMES = 10
const GPU_SLOW_MS = 40

function hasSoftwareGraphics(gl: WebGL2RenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info")
  if (!info) return false
  const renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "")
  return /swiftshader|llvmpipe|software|basic render/i.test(renderer)
}

const OVERLAY_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() {
  o = texture(u_tex, v_uv);
}`

// Logo geometry, as fractions of the video height so it scales with the
// camera resolution. The logo sits on the signer's lower chest, centred, with
// no tile behind it: there it can't be cropped out of a copied video the way a
// corner mark can. The recorder's preview shows a matching DOM element, so
// keep the two in step through these.
export const WATERMARK_HEIGHT = 0.1
/** Where the middle of the logo sits, down from the top of the picture. */
export const WATERMARK_CENTER_Y = 0.76

export function supportsLessonVideoCanvas(): boolean {
  if (typeof document === "undefined" || typeof WebAssembly === "undefined") return false
  if (typeof HTMLCanvasElement.prototype.captureStream !== "function") return false
  try {
    return !!document.createElement("canvas").getContext("webgl2")
  } catch {
    return false
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("Could not create shader")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader) ?? ""}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, vertex: WebGLShader, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error("Could not create program")
  gl.attachShader(program, vertex)
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource))
  // Every program shares one quad buffer, so pin the attribute slot.
  gl.bindAttribLocation(program, 0, "a_pos")
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program) ?? ""}`)
  }
  return program
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error("Could not create texture")
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

/** A single-channel texture we can render into. */
type MaskTarget = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }

function createMaskTarget(gl: WebGL2RenderingContext): MaskTarget {
  const texture = createTexture(gl)
  const framebuffer = gl.createFramebuffer()
  if (!framebuffer) throw new Error("Could not create framebuffer")
  return { texture, framebuffer, width: 0, height: 0 }
}

function resizeMaskTarget(gl: WebGL2RenderingContext, target: MaskTarget, width: number, height: number) {
  if (target.width === width && target.height === height) return false
  gl.bindTexture(gl.TEXTURE_2D, target.texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  target.width = width
  target.height = height
  return true
}

/**
 * How the tutor is separated from what is behind them: "model" works anywhere
 * (segmentation), "backdrop" needs a plain coloured cloth behind the tutor and
 * gives much cleaner hands (chroma key). "auto" uses the chroma key whenever
 * it can see such a cloth and the model otherwise.
 */
export type BackgroundMethod = "auto" | "model" | "backdrop"

export type LessonVideoCanvas = {
  /**
   * Set the background colour (`#rrggbb`), or null for the real background.
   * With the "model" and "auto" methods the first colour downloads the
   * segmentation model; the promise resolves once the colour is actually on
   * screen and rejects if the model can't load. The "backdrop" method resolves at once
   * and shows the colour as soon as a backdrop is found (see
   * `onBackdropDetected`).
   */
  setBackground: (hex: string | null, method?: BackgroundMethod) => Promise<void>
  /** Forget the backdrop colour and read it again from the next frame. */
  resampleBackdrop: () => void
  /** 0–1: how much of the backdrop's shadows and creases to remove. Default 0.5. */
  setBackdropStrength: (strength: number) => void
  /**
   * The processed picture, logo included, as a video track ready for
   * MediaRecorder. Stop the track when the recording is over.
   */
  captureStream: (fps?: number) => MediaStream
  destroy: () => void
}

/**
 * Start drawing `video` onto `canvas`. The logo at `watermarkSrc` (if given)
 * is stamped on the recorded picture only (see `captureStream`), not on
 * `canvas`. Throws if the browser has no WebGL2.
 */
export function createLessonVideoCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options: {
    watermarkSrc?: string
    /** Called when the "backdrop" method finds, or loses, a usable backdrop. */
    onBackdropDetected?: (detected: boolean) => void
  } = {},
): LessonVideoCanvas {
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false })
  if (!context) throw new Error("WebGL2 is not available")
  const gl: WebGL2RenderingContext = context

  // The model is fastest on the GPU, but on machines where the browser only
  // has software graphics it is far slower there than on the CPU. Start on the
  // likely winner; the render loop below re-checks with real timings and swaps
  // if GPU is slow.
  let delegate: "GPU" | "CPU" = hasSoftwareGraphics(gl) ? "CPU" : "GPU"
  let segmenter: ImageSegmenter | null = null
  let createSegmenter: ((delegate: "GPU" | "CPU") => Promise<ImageSegmenter>) | null = null
  let segmenterLoading: Promise<void> | null = null
  let timedFrames = 0
  let timedMs = 0
  let switching = false

  // Only fetched when a background colour is first asked for (16 MB model).
  function loadSegmenter(): Promise<void> {
    segmenterLoading ??= (async () => {
      const vision = await import("@mediapipe/tasks-vision")
      const fileset = await vision.FilesetResolver.forVisionTasks(TASKS_VISION_WASM)
      const create = (delegate: "GPU" | "CPU") =>
        vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate },
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        })
      let created: ImageSegmenter
      try {
        created = await create(delegate)
      } catch (err) {
        if (delegate === "CPU") throw err
        delegate = "CPU"
        created = await create(delegate)
      }
      if (destroyed) {
        created.close()
        return
      }
      createSegmenter = create
      segmenter = created
    })().catch((err) => {
      segmenterLoading = null // let a later attempt retry
      throw err
    })
    return segmenterLoading
  }

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const temporal = link(gl, vertex, TEMPORAL_SHADER)
  const refine = link(gl, vertex, REFINE_SHADER)
  const composite = link(gl, vertex, COMPOSITE_SHADER)
  const coverage = link(gl, vertex, COVERAGE_SHADER)
  const chroma = link(gl, vertex, CHROMA_SHADER)
  const overlay = link(gl, vertex, OVERLAY_SHADER)

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const frameTexture = createTexture(gl)
  const rawMaskTexture = createTexture(gl)
  // Two targets so the temporal pass can read last frame's mask while writing this one's.
  const history = [createMaskTarget(gl), createMaskTarget(gl)]
  const refined = createMaskTarget(gl)
  const cover = createMaskTarget(gl)
  let current = 0
  let historyValid = false
  let maskBytes = new Uint8Array(0)
  let rgb: [number, number, number] | null = null
  let method: BackgroundMethod = "model"
  let backgroundRequest = 0
  let destroyed = false

  // "backdrop" method state: the backdrop's colour as (Cb, Cr), once found.
  let key: [number, number] | null = null
  let keyStrength = 0.5
  let framesSinceKeySample = KEY_SAMPLE_INTERVAL
  let keyMisses = 0
  let keySampler: CanvasRenderingContext2D | null = null

  function setKey(next: [number, number] | null) {
    const changed = (key === null) !== (next === null)
    key = next
    if (changed) options.onBackdropDetected?.(next !== null)
  }

  // Reads the backdrop colour from the top of the current frame: the hue that
  // most of the strongly coloured pixels there share. Returns null if no one
  // colour fills enough of it. The cloth doesn't have to reach the edges.
  function sampleKey(): [number, number] | null {
    if (!keySampler) {
      const sampler = document.createElement("canvas")
      sampler.width = KEY_SAMPLE_WIDTH
      sampler.height = KEY_SAMPLE_HEIGHT
      keySampler = sampler.getContext("2d", { willReadFrequently: true })
      if (!keySampler) return null
    }
    keySampler.drawImage(video, 0, 0, KEY_SAMPLE_WIDTH, KEY_SAMPLE_HEIGHT)
    const { data } = keySampler.getImageData(0, 0, KEY_SAMPLE_WIDTH, KEY_BAND_HEIGHT)
    const minSaturation = method === "auto" ? AUTO_KEY_MIN_SATURATION : KEY_MIN_SATURATION
    const bins: [number, number][][] = Array.from({ length: KEY_HUE_BINS }, () => [])
    for (let i = 0; i < data.length; i += 4) {
      const [cb, cr] = toCbCr(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255)
      if (Math.hypot(cb, cr) < minSaturation) continue
      if (cb * SKIN_HUE[0] + cr * SKIN_HUE[1] > 0) continue
      const hue = (Math.atan2(cr, cb) / (2 * Math.PI) + 1) % 1
      bins[Math.min(KEY_HUE_BINS - 1, Math.floor(hue * KEY_HUE_BINS))].push([cb, cr])
    }
    // The busiest hue, with its two neighbours so a colour that straddles a
    // bin boundary isn't split in half.
    let best: [number, number][] = []
    for (let i = 0; i < KEY_HUE_BINS; i++) {
      const group = [
        ...bins[(i + KEY_HUE_BINS - 1) % KEY_HUE_BINS], ...bins[i], ...bins[(i + 1) % KEY_HUE_BINS],
      ]
      if (group.length > best.length) best = group
    }
    if (best.length < (data.length / 4) * KEY_MIN_SHARE) return null
    return [median(best.map((c) => c[0])), median(best.map((c) => c[1]))]
  }

  // Keeps the key in step with the camera (exposure and white balance drift
  // for a few seconds after it opens) without letting something else that
  // fills the top of the picture for a moment replace it.
  function updateKey() {
    if (++framesSinceKeySample < KEY_SAMPLE_INTERVAL) return
    framesSinceKeySample = 0
    const sample = sampleKey()
    if (!sample) {
      // "auto" goes back to the model once the backdrop has clearly gone — not
      // on one bad read, which is usually just the tutor leaning across it.
      if (method === "auto" && key && ++keyMisses >= AUTO_KEY_MAX_MISSES) setKey(null)
      return
    }
    keyMisses = 0
    if (!key) {
      setKey(sample)
      return
    }
    const sameHue =
      (sample[0] * key[0] + sample[1] * key[1]) / (Math.hypot(...sample) * Math.hypot(...key)) > 0.9
    if (sameHue) key = [key[0] + (sample[0] - key[0]) * 0.3, key[1] + (sample[1] - key[1]) * 0.3]
  }

  // The logo is not drawn on `canvas`: the recorder shows that mirrored, which
  // would turn the logo back to front, and it has no tile behind it that a
  // readable copy could cover. Instead each finished frame is copied to a
  // second canvas while a recording is running, and the logo is stamped there.
  let watermarkImage: HTMLImageElement | null = null
  if (options.watermarkSrc) {
    const image = new Image()
    image.onload = () => { watermarkImage = image }
    image.onerror = () => console.warn("[lesson-video-canvas] logo failed to load")
    image.src = options.watermarkSrc
  }
  let output: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; track?: MediaStreamTrack } | null = null

  // Must run in the same task as the frame's last draw call, while the WebGL
  // drawing buffer still holds it.
  function copyToOutput(width: number, height: number) {
    if (!output) return
    if (output.track?.readyState === "ended") {
      output = null
      return
    }
    if (output.canvas.width !== width || output.canvas.height !== height) {
      output.canvas.width = width
      output.canvas.height = height
    }
    const { ctx } = output
    ctx.drawImage(canvas, 0, 0, width, height)
    if (!watermarkImage) return
    const logoHeight = Math.max(8, Math.round(height * WATERMARK_HEIGHT))
    const logoWidth = Math.round(logoHeight * (watermarkImage.naturalWidth / watermarkImage.naturalHeight))
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(
      watermarkImage,
      Math.round((width - logoWidth) / 2),
      Math.round(height * WATERMARK_CENTER_Y - logoHeight / 2),
      logoWidth,
      logoHeight,
    )
  }

  function bind(program: WebGLProgram, textures: Record<string, WebGLTexture>, flipY: number) {
    gl.useProgram(program)
    gl.uniform1f(gl.getUniformLocation(program, "u_flipY"), flipY)
    Object.entries(textures).forEach(([name, texture], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(gl.getUniformLocation(program, name), unit)
    })
  }

  // The refine pass reads the camera frame through its mip chain; every other
  // pass draws it 1:1 and must not depend on mips having been built.
  function setFrameMipmaps(on: boolean) {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, frameTexture)
    if (on) gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, on ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  }

  function draw(target: MaskTarget | null, width: number, height: number) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null)
    gl.viewport(0, 0, width, height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  // Skip the first few frames (shader warm-up), then average the next ten. If
  // the GPU can't segment a frame in well under a frame interval, move to CPU.
  function checkGpuSpeed(elapsedMs: number) {
    timedFrames++
    if (timedFrames <= GPU_WARMUP_FRAMES) return
    timedMs += elapsedMs
    const sampled = timedFrames - GPU_WARMUP_FRAMES
    // Don't sit through ten frames if they are each taking a second.
    if (sampled < GPU_SAMPLE_FRAMES && timedMs < GPU_SAMPLE_FRAMES * GPU_SLOW_MS) return
    if (timedMs / sampled <= GPU_SLOW_MS) {
      switching = true // fast enough — stop measuring
      return
    }
    switching = true
    createSegmenter?.("CPU")
      .then((cpu) => {
        if (destroyed) {
          cpu.close()
          return
        }
        segmenter?.close()
        segmenter = cpu
        delegate = "CPU"
      })
      .catch((err) => console.warn("[lesson-video-canvas] CPU fallback failed", err))
  }

  function render() {
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height || video.readyState < 2) return

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    // Mask rows are tightly packed single bytes.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    if (rgb && method !== "model") {
      try {
        updateKey()
      } catch (err) {
        // Reading the frame back can be refused (e.g. a tainted source); keep
        // whatever key we already have.
        console.warn("[lesson-video-canvas] backdrop sample failed", err)
      }
    }

    // The camera keeps advancing while we work, so pin one frame and use it
    // for both the mask and the picture — otherwise the cut-out can trail a
    // frame behind a moving hand.
    const frame = typeof VideoFrame === "function" ? new VideoFrame(video) : null
    const source = frame ?? video
    let maskWidth = 0
    let maskHeight = 0
    try {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, frameTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

      if (rgb && segmenter) {
        const startedAt = performance.now()
        segmenter.segmentForVideo(source, startedAt, (result) => {
          // The mask is only valid inside this callback, so copy it out now.
          const mask = result.confidenceMasks?.[0]
          if (!mask) return
          const values = mask.getAsFloat32Array()
          if (maskBytes.length !== values.length) maskBytes = new Uint8Array(values.length)
          for (let i = 0; i < values.length; i++) maskBytes[i] = (1 - values[i]) * 255
          maskWidth = mask.width
          maskHeight = mask.height
        })
        if (delegate === "GPU" && !switching) checkGpuSpeed(performance.now() - startedAt)
      }
    } finally {
      frame?.close()
    }

    const haveMask = maskWidth > 0 && maskHeight > 0
    if (!rgb || (!key && !haveMask)) {
      // No background colour (or nothing to cut it out with this frame): the
      // camera as it is.
      historyValid = false
      bind(overlay, { u_tex: frameTexture }, -1)
      draw(null, width, height)
      copyToOutput(width, height)
      return
    }

    setFrameMipmaps(true)
    if (haveMask) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, rawMaskTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, maskWidth, maskHeight, 0, gl.RED, gl.UNSIGNED_BYTE, maskBytes)

      // A resized target has no usable history, so start it from the raw mask.
      const previous = history[current]
      const next = history[1 - current]
      const resizedPrevious = resizeMaskTarget(gl, previous, maskWidth, maskHeight)
      const resizedNext = resizeMaskTarget(gl, next, maskWidth, maskHeight)
      if (resizedPrevious || resizedNext) historyValid = false

      bind(temporal, { u_raw: rawMaskTexture, u_prev: previous.texture }, 1)
      gl.uniform1f(gl.getUniformLocation(temporal, "u_reset"), historyValid ? 0 : 1)
      draw(next, maskWidth, maskHeight)
      current = 1 - current
      historyValid = true

      // Half the output size is plenty for the mask and halves the filter cost.
      const refinedWidth = Math.max(1, width >> 1)
      const refinedHeight = Math.max(1, height >> 1)
      resizeMaskTarget(gl, refined, refinedWidth, refinedHeight)
      bind(refine, { u_mask: next.texture, u_frame: frameTexture }, 1)
      gl.uniform2f(gl.getUniformLocation(refine, "u_step"), 1 / maskWidth, 1 / maskHeight)
      // At least one level down (the target is half size anyway), more when the
      // camera is much sharper than the mask.
      gl.uniform1f(gl.getUniformLocation(refine, "u_lod"), Math.max(1, Math.log2(width / maskWidth) - 0.5))
      draw(refined, refinedWidth, refinedHeight)
    } else {
      historyValid = false
    }

    if (key) {
      const saturation = Math.hypot(key[0], key[1])
      // Stronger = the cut starts closer to neutral, so darker shadows and
      // creases in the cloth go too, at the cost of eating into dull colours.
      const start = saturation * (0.25 - 0.2 * keyStrength)
      const end = saturation * (0.85 - 0.5 * keyStrength)

      // 1/32 of the picture each way: the composite looks four of these
      // texels out, a reach a little wider than a hand.
      const coverWidth = Math.max(1, width >> 5)
      const coverHeight = Math.max(1, height >> 5)
      resizeMaskTarget(gl, cover, coverWidth, coverHeight)
      bind(coverage, { u_frame: frameTexture }, 1)
      gl.uniform1f(gl.getUniformLocation(coverage, "u_lod"), 5)
      gl.uniform2f(gl.getUniformLocation(coverage, "u_key"), key[0], key[1])
      gl.uniform2f(gl.getUniformLocation(coverage, "u_range"), start, end)
      draw(cover, coverWidth, coverHeight)

      // Without a mask (model still loading, or it failed) the key works alone.
      bind(chroma, { u_frame: frameTexture, u_cover: cover.texture, u_mask: haveMask ? refined.texture : cover.texture }, -1)
      gl.uniform3f(gl.getUniformLocation(chroma, "u_color"), rgb[0], rgb[1], rgb[2])
      gl.uniform2f(gl.getUniformLocation(chroma, "u_key"), key[0], key[1])
      gl.uniform2f(gl.getUniformLocation(chroma, "u_range"), start, end)
      gl.uniform2f(gl.getUniformLocation(chroma, "u_coverStep"), 1 / coverWidth, 1 / coverHeight)
      gl.uniform1f(gl.getUniformLocation(chroma, "u_useMask"), haveMask ? 1 : 0)
    } else {
      bind(composite, { u_frame: frameTexture, u_mask: refined.texture }, -1)
      gl.uniform3f(gl.getUniformLocation(composite, "u_color"), rgb[0], rgb[1], rgb[2])
    }
    draw(null, width, height)
    setFrameMipmaps(false)
    copyToOutput(width, height)
  }

  // Drive the loop from the camera's own frames where the browser can tell us
  // about them, so we process each frame exactly once.
  const perVideoFrame = typeof video.requestVideoFrameCallback === "function"
  let handle = 0
  function schedule() {
    handle = perVideoFrame ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick)
  }
  function tick() {
    if (destroyed) return
    try {
      render()
    } catch (err) {
      console.warn("[lesson-video-canvas] frame failed", err)
    }
    schedule()
  }
  schedule()

  return {
    async setBackground(hex, nextMethod = "model") {
      const request = ++backgroundRequest
      if (hex === null) {
        rgb = null
        return
      }
      if (nextMethod === "backdrop") {
        // The key can start alone; the model joins in once it has loaded.
        if (!segmenter) loadSegmenter().catch((err) => console.warn("[lesson-video-canvas] model failed to load", err))
      } else if (!segmenter) {
        await loadSegmenter()
      }
      // A newer choice was made while the model was loading — leave it be.
      if (destroyed || request !== backgroundRequest) return
      if (nextMethod !== method) {
        // Each method has its own idea of what counts as a backdrop, so look
        // again — straight away rather than on the next interval.
        setKey(null)
        keyMisses = 0
        framesSinceKeySample = KEY_SAMPLE_INTERVAL
      }
      method = nextMethod
      rgb = hexToRgb(hex)
    },
    resampleBackdrop() {
      setKey(null)
      keyMisses = 0
      framesSinceKeySample = KEY_SAMPLE_INTERVAL
    },
    setBackdropStrength(strength) {
      keyStrength = Math.min(1, Math.max(0, strength))
    },
    captureStream(fps = 30) {
      const copy = document.createElement("canvas")
      copy.width = canvas.width
      copy.height = canvas.height
      const ctx = copy.getContext("2d", { alpha: false })
      // No 2D canvas to stamp the logo on: the picture without it.
      if (!ctx) return canvas.captureStream(fps)
      const stream = copy.captureStream(fps)
      output = { canvas: copy, ctx, track: stream.getVideoTracks()[0] }
      return stream
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      if (perVideoFrame) video.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
      segmenter?.close()
      // Free our objects but leave the context alive — the same canvas may be
      // handed to a new renderer.
      for (const program of [temporal, refine, composite, coverage, chroma, overlay]) gl.deleteProgram(program)
      for (const target of [...history, refined, cover]) {
        gl.deleteTexture(target.texture)
        gl.deleteFramebuffer(target.framebuffer)
      }
      gl.deleteTexture(frameTexture)
      gl.deleteTexture(rawMaskTexture)
      output = null
      gl.deleteBuffer(quad)
    },
  }
}
