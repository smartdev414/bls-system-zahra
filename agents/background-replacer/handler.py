"""RunPod serverless worker — replaces the background of a recorded video.

The lesson recorder can swap the room behind the tutor for a flat colour live
in the browser, but the small model it has to use there can't follow fast
hands. This worker does the same job after upload with a much heavier matting
model, where it doesn't have to keep up with the camera.

One job = one video:
  input.source_url   signed GET for the raw recording (camera as-is)
  input.upload_url   signed PUT the finished MP4 is sent to
  input.color        "#rrggbb" to put behind the tutor
  input.logo_url     optional logo, stamped top-left the way the recorder does

The worker never holds storage credentials: it only sees the two signed URLs.
Deployed by scripts/deploy-background-replacer.mjs.
"""

import os
import re
import subprocess
import tempfile
import time
from io import BytesIO

import numpy as np
import requests
import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw
from transformers import AutoModelForImageSegmentation

MODEL_ID = os.environ.get("MATTING_MODEL", "ZhengPeng7/BiRefNet-matting")
MODEL_REVISION = os.environ.get("MATTING_MODEL_REVISION") or None
# The model's native input. Frames are squashed to this square and the matte
# is stretched back, which is how BiRefNet is meant to be used.
MODEL_SIZE = 1024
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "4"))
FPS = 30
# A recording is capped at 500 MB by the upload route (about 16 minutes); this
# only stops a runaway job from burning GPU time.
MAX_SECONDS = int(os.environ.get("MAX_SECONDS", "1500"))

# Logo tile geometry as fractions of the video height — keep in step with the
# WATERMARK_* constants in lib/lesson-video-canvas.ts.
WATERMARK_HEIGHT = 0.1
WATERMARK_MARGIN = 0.025
WATERMARK_PADDING = 0.1
WATERMARK_RADIUS = 0.12

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
HALF = DEVICE == "cuda"

torch.set_float32_matmul_precision("high")
model = AutoModelForImageSegmentation.from_pretrained(
    MODEL_ID, trust_remote_code=True, revision=MODEL_REVISION
)
model.to(DEVICE).eval()
if HALF:
    model.half()

MEAN = torch.tensor([0.485, 0.456, 0.406], device=DEVICE).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225], device=DEVICE).view(1, 3, 1, 1)


def parse_color(value):
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(value or "").strip())
    if not match:
        raise ValueError("color must be #rrggbb")
    n = int(match.group(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]


def require_https(name, value):
    if not isinstance(value, str) or not value.startswith("https://"):
        raise ValueError(f"{name} must be an https URL")
    return value


def download(url, path):
    with requests.get(url, stream=True, timeout=60) as res:
        res.raise_for_status()
        with open(path, "wb") as out:
            for chunk in res.iter_content(1 << 20):
                out.write(chunk)


def probe_size(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    width, height = (int(v) for v in out.split("x")[:2])
    # H.264 needs even dimensions.
    return width - width % 2, height - height % 2


def build_logo(url, video_height):
    """The white rounded tile with the logo on it, as float RGB + alpha tensors."""
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    logo = Image.open(BytesIO(res.content)).convert("RGBA")

    tile_h = max(8, round(video_height * WATERMARK_HEIGHT))
    pad = round(tile_h * WATERMARK_PADDING)
    logo_h = tile_h - pad * 2
    logo_w = round(logo_h * logo.width / logo.height)
    tile = Image.new("RGBA", (logo_w + pad * 2, tile_h), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle(
        (0, 0, tile.width - 1, tile.height - 1),
        radius=tile_h * WATERMARK_RADIUS,
        fill=(255, 255, 255, 242),
    )
    tile.alpha_composite(logo.resize((logo_w, logo_h), Image.LANCZOS), (pad, pad))

    data = torch.from_numpy(np.array(tile)).to(DEVICE).float()
    rgb = data[..., :3].permute(2, 0, 1).unsqueeze(0)
    alpha = (data[..., 3:] / 255).permute(2, 0, 1).unsqueeze(0)
    return rgb, alpha


@torch.inference_mode()
def matte(frames):
    """frames: uint8 (B, H, W, 3) on DEVICE → person alpha, float (B, 1, H, W)."""
    height, width = frames.shape[1:3]
    x = frames.permute(0, 3, 1, 2).float() / 255
    x = F.interpolate(x, size=(MODEL_SIZE, MODEL_SIZE), mode="bilinear", antialias=True)
    x = (x - MEAN) / STD
    alpha = model(x.half() if HALF else x)[-1].sigmoid().float()
    alpha = F.interpolate(alpha, size=(height, width), mode="bilinear")
    # Drop the faint haze the model leaves on empty background and make sure
    # the solid parts of the person are fully opaque.
    return ((alpha - 0.05) / 0.9).clamp(0, 1)


def process(source, output, color, logo_url, on_progress):
    width, height = probe_size(source)
    frame_bytes = width * height * 3

    decoder = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", source,
         # Browser recordings have an uneven frame rate; even it out.
         "-vf", f"fps={FPS},scale={width}:{height}",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    encoder = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(FPS), "-i", "-",
         "-i", source,
         "-map", "0:v", "-map", "1:a?",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k",
         # Index at the front so the browser can start playing before the
         # whole file has arrived.
         "-movflags", "+faststart", output],
        stdin=subprocess.PIPE,
    )

    background = torch.tensor(color, device=DEVICE).float().view(1, 3, 1, 1)
    logo = build_logo(logo_url, height) if logo_url else None
    margin = round(height * WATERMARK_MARGIN)

    def flush(batch):
        frames = torch.from_numpy(np.stack(batch)).to(DEVICE)
        alpha = matte(frames)
        out = frames.permute(0, 3, 1, 2).float() * alpha + background * (1 - alpha)
        if logo:
            rgb, logo_alpha = logo
            h, w = rgb.shape[2:]
            region = out[:, :, margin:margin + h, margin:margin + w]
            out[:, :, margin:margin + h, margin:margin + w] = rgb * logo_alpha + region * (1 - logo_alpha)
        encoder.stdin.write(out.round().clamp(0, 255).byte().permute(0, 2, 3, 1).cpu().numpy().tobytes())

    count = 0
    batch = []
    try:
        while True:
            buf = decoder.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            batch.append(np.frombuffer(buf, np.uint8).reshape(height, width, 3))
            count += 1
            if count > MAX_SECONDS * FPS:
                raise ValueError(f"video is longer than {MAX_SECONDS // 60} minutes")
            if len(batch) == BATCH_SIZE:
                flush(batch)
                batch = []
                if count % (FPS * 10) < BATCH_SIZE:
                    on_progress(count)
        if batch:
            flush(batch)
    except BaseException:
        decoder.kill()
        encoder.kill()
        raise
    finally:
        decoder.stdout.close()

    encoder.stdin.close()
    if decoder.wait() != 0:
        raise RuntimeError("could not read the source video")
    if encoder.wait() != 0:
        raise RuntimeError("could not write the finished video")
    if count == 0:
        raise RuntimeError("the source video has no frames")
    return {"frames": count, "width": width, "height": height}


def handler(job):
    data = job.get("input") or {}
    source_url = require_https("source_url", data.get("source_url"))
    upload_url = require_https("upload_url", data.get("upload_url"))
    color = parse_color(data.get("color"))
    logo_url = require_https("logo_url", data["logo_url"]) if data.get("logo_url") else None

    started = time.time()
    with tempfile.TemporaryDirectory() as work:
        source = os.path.join(work, "source")
        output = os.path.join(work, "output.mp4")
        download(source_url, source)

        def on_progress(frames):
            import runpod
            runpod.serverless.progress_update(job, f"{frames // FPS}s processed")

        result = process(source, output, color, logo_url, on_progress)

        with open(output, "rb") as body:
            res = requests.put(upload_url, data=body, headers={"Content-Type": "video/mp4"}, timeout=600)
            res.raise_for_status()
        result["bytes"] = os.path.getsize(output)

    result["seconds"] = round(time.time() - started, 1)
    result["device"] = DEVICE
    return result


if __name__ == "__main__":
    import runpod
    runpod.serverless.start({"handler": handler})
