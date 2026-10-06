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
// Either way the logo tile is drawn last, on top.
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
  // Feathered edge, biased slightly inwards so a rim of the real room
  // doesn't show around the person.
  float alpha = smoothstep(0.6, 0.9, person);
  o = vec4(mix(u_color, texture(u_frame, v_uv).rgb, alpha), 1.0);
}`

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

// Logo tile geometry, as fractions of the video height so it scales with the
// camera resolution. The recorder's preview covers the tile with a matching
// DOM element, so keep the two in step through these.
export const WATERMARK_HEIGHT = 0.1
export const WATERMARK_MARGIN = 0.025
/** Padding inside the tile, as a fraction of the tile height. */
export const WATERMARK_PADDING = 0.1
/** Corner radius, as a fraction of the tile height. */
export const WATERMARK_RADIUS = 0.12

/** Width ÷ height of the tile for a logo of the given width ÷ height. */
export function watermarkTileAspect(logoAspect: number): number {
  return (1 - 2 * WATERMARK_PADDING) * logoAspect + 2 * WATERMARK_PADDING
}

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

export type LessonVideoCanvas = {
  /**
   * Set the background colour (`#rrggbb`), or null for the real background.
   * The first colour downloads the segmentation model; the promise resolves
   * once the colour is actually on screen and rejects if the model can't load.
   */
  setBackground: (hex: string | null) => Promise<void>
  /** The processed picture as a video track, ready for MediaRecorder. */
  captureStream: (fps?: number) => MediaStream
  destroy: () => void
}

/**
 * Start drawing `video` onto `canvas`, with the logo at `watermarkSrc` (if
 * given) stamped in the top-left corner. Throws if the browser has no WebGL2.
 */
export function createLessonVideoCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options: { watermarkSrc?: string } = {},
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
  const overlay = link(gl, vertex, OVERLAY_SHADER)

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const frameTexture = createTexture(gl)
  const rawMaskTexture = createTexture(gl)
  // Two targets so the temporal pass can read last frame's mask while writing this one's.
  const history = [createMaskTarget(gl), createMaskTarget(gl)]
  const refined = createMaskTarget(gl)
  let current = 0
  let historyValid = false
  let maskBytes = new Uint8Array(0)
  let rgb: [number, number, number] | null = null
  let backgroundRequest = 0
  let destroyed = false

  // The logo tile is painted once per video size on a 2D canvas (white rounded
  // tile + logo, same look as LogoWatermark) and kept as a texture.
  const watermarkTexture = createTexture(gl)
  let watermarkImage: HTMLImageElement | null = null
  let watermarkWidth = 0
  let watermarkHeight = 0
  let watermarkBuiltFor = 0
  if (options.watermarkSrc) {
    const image = new Image()
    image.onload = () => { watermarkImage = image }
    image.onerror = () => console.warn("[lesson-video-canvas] logo failed to load")
    image.src = options.watermarkSrc
  }

  function buildWatermark(image: HTMLImageElement, videoHeight: number) {
    const tileHeight = Math.max(8, Math.round(videoHeight * WATERMARK_HEIGHT))
    const pad = Math.round(tileHeight * WATERMARK_PADDING)
    const logoHeight = tileHeight - pad * 2
    const logoWidth = Math.round(logoHeight * (image.naturalWidth / image.naturalHeight))
    const tile = document.createElement("canvas")
    tile.width = logoWidth + pad * 2
    tile.height = tileHeight
    const ctx = tile.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)"
    ctx.beginPath()
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(0, 0, tile.width, tile.height, tileHeight * WATERMARK_RADIUS)
    } else {
      ctx.rect(0, 0, tile.width, tile.height)
    }
    ctx.fill()
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(image, pad, pad, logoWidth, logoHeight)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, watermarkTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile)
    watermarkWidth = tile.width
    watermarkHeight = tile.height
    watermarkBuiltFor = videoHeight
  }

  function drawWatermark(height: number) {
    if (!watermarkImage) return
    if (watermarkBuiltFor !== height) buildWatermark(watermarkImage, height)
    if (!watermarkWidth) return
    const margin = Math.round(height * WATERMARK_MARGIN)
    bind(overlay, { u_tex: watermarkTexture }, -1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    // GL's origin is the bottom-left corner; the tile goes top-left.
    gl.viewport(margin, height - margin - watermarkHeight, watermarkWidth, watermarkHeight)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disable(gl.BLEND)
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

    if (!rgb || !maskWidth || !maskHeight) {
      // No background colour (or no mask this frame): the camera as it is.
      historyValid = false
      bind(overlay, { u_tex: frameTexture }, -1)
      draw(null, width, height)
      drawWatermark(height)
      return
    }

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
    setFrameMipmaps(true)
    bind(refine, { u_mask: next.texture, u_frame: frameTexture }, 1)
    gl.uniform2f(gl.getUniformLocation(refine, "u_step"), 1 / maskWidth, 1 / maskHeight)
    // At least one level down (the target is half size anyway), more when the
    // camera is much sharper than the mask.
    gl.uniform1f(gl.getUniformLocation(refine, "u_lod"), Math.max(1, Math.log2(width / maskWidth) - 0.5))
    draw(refined, refinedWidth, refinedHeight)
    setFrameMipmaps(false)

    bind(composite, { u_frame: frameTexture, u_mask: refined.texture }, -1)
    gl.uniform3f(gl.getUniformLocation(composite, "u_color"), rgb[0], rgb[1], rgb[2])
    draw(null, width, height)
    drawWatermark(height)
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
    async setBackground(hex) {
      const request = ++backgroundRequest
      if (hex === null) {
        rgb = null
        return
      }
      if (!segmenter) await loadSegmenter()
      // A newer choice was made while the model was loading — leave it be.
      if (destroyed || request !== backgroundRequest) return
      rgb = hexToRgb(hex)
    },
    captureStream(fps = 30) {
      return canvas.captureStream(fps)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      if (perVideoFrame) video.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
      segmenter?.close()
      // Free our objects but leave the context alive — the same canvas may be
      // handed to a new renderer.
      for (const program of [temporal, refine, composite, overlay]) gl.deleteProgram(program)
      for (const target of [...history, refined]) {
        gl.deleteTexture(target.texture)
        gl.deleteFramebuffer(target.framebuffer)
      }
      gl.deleteTexture(frameTexture)
      gl.deleteTexture(rawMaskTexture)
      gl.deleteTexture(watermarkTexture)
      gl.deleteBuffer(quad)
    },
  }
}
