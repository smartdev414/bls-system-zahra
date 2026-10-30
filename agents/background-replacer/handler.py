"""RunPod serverless worker — replaces the background of a recorded video.

The lesson recorder can swap the room behind the tutor for a flat colour live
in the browser, but the small model it has to use there can't follow fast
hands. This worker does the same job after upload with a much heavier matting
model, where it doesn't have to keep up with the camera.

One job = one video:
  input.source_url   signed GET for the raw recording (camera as-is)
  input.upload_url   signed PUT the finished MP4 is sent to
  input.color        "#rrggbb" to put behind the tutor
  input.background_url  optional picture to put behind the tutor instead (scaled to fill)
  input.logo_url     optional logo, stamped on the lower chest the way the recorder does

The worker never holds storage credentials: it only sees the two signed URLs.
Deployed by scripts/deploy-background-replacer.mjs.
"""

import os
import queue
import re
import subprocess
import tempfile
import threading
import time
from io import BytesIO

import numpy as np
import requests
import torch
import torch.nn.functional as F
from PIL import Image
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

# Logo geometry as fractions of the video height — keep in step with the
# WATERMARK_* constants in lib/lesson-video-canvas.ts.
WATERMARK_HEIGHT = 0.1
WATERMARK_CENTER_Y = 0.76
WATERMARK_OPACITY = 0.1

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


def build_logo(url, video_width, video_height):
    """The logo on its own (no tile behind it), as float RGB + alpha tensors."""
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    logo = Image.open(BytesIO(res.content)).convert("RGBA")

    logo_h = max(8, round(video_height * WATERMARK_HEIGHT))
    logo_w = min(video_width, round(logo_h * logo.width / logo.height))
    logo = logo.resize((logo_w, logo_h), Image.LANCZOS)

    data = torch.from_numpy(np.array(logo)).to(DEVICE).float()
    rgb = data[..., :3].permute(2, 0, 1).unsqueeze(0)
    alpha = (data[..., 3:] / 255 * WATERMARK_OPACITY).permute(2, 0, 1).unsqueeze(0)
    return rgb, alpha


def build_background(url, video_width, video_height):
    """A picture scaled to cover the frame and cropped to it, as float RGB (1, 3, H, W)."""
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    picture = Image.open(BytesIO(res.content)).convert("RGB")
    scale = max(video_width / picture.width, video_height / picture.height)
    w, h = max(video_width, round(picture.width * scale)), max(video_height, round(picture.height * scale))
    picture = picture.resize((w, h), Image.LANCZOS)
    x, y = (w - video_width) // 2, (h - video_height) // 2
    picture = picture.crop((x, y, x + video_width, y + video_height))
    return torch.from_numpy(np.array(picture)).to(DEVICE).float().permute(2, 0, 1).unsqueeze(0)


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


def box_blur(x, radius):
    """Mean over a (2r+1)² window, done as two 1-D passes."""
    k = 2 * radius + 1
    x = F.avg_pool2d(x, (1, k), stride=1, padding=(0, radius), count_include_pad=False)
    return F.avg_pool2d(x, (k, 1), stride=1, padding=(radius, 0), count_include_pad=False)


def blur_fusion(image, foreground, background, alpha, radius):
    blurred_alpha = box_blur(alpha, radius)
    blurred_fg = box_blur(foreground * alpha, radius) / (blurred_alpha + 1e-5)
    blurred_bg = box_blur(background * (1 - alpha), radius) / (1 - blurred_alpha + 1e-5)
    foreground = blurred_fg + alpha * (image - alpha * blurred_fg - (1 - alpha) * blurred_bg)
    return foreground.clamp(0, 255), blurred_bg


@torch.inference_mode()
def person_colour(image, alpha):
    """What colour the person is in each pixel, with the room taken out.

    A pixel on the person's outline is part person, part room — more so when
    they move and the edge blurs. Laid over the new colour as it is, it keeps
    the room's share and shows as a pale rim round the head and neck. This
    estimates the person's own colour there from nearby pixels that are fully
    person (blur fusion, Forte & Pitié 2021: a wide pass, then a tight one).
    image: float (B, 3, H, W) 0–255; alpha: (B, 1, H, W).
    """
    height = image.shape[2]
    foreground, background = blur_fusion(image, image, image, alpha, max(8, round(height * 0.09)))
    return blur_fusion(image, foreground, background, alpha, max(2, round(height * 0.006)))[0]


def process(source, output, color, logo_url, on_progress, background_url=None):
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

    if background_url:
        background = build_background(background_url, width, height)
    else:
        background = torch.tensor(color, device=DEVICE).float().view(1, 3, 1, 1)
    logo = build_logo(logo_url, width, height) if logo_url else None

    timings = {"matte": 0.0, "edges": 0.0}

    def lap(name, started):
        if DEVICE == "cuda":
            torch.cuda.synchronize()
        timings[name] += time.time() - started
        return time.time()

    def composite(frames):
        t = time.time()
        frames = torch.from_numpy(frames).to(DEVICE)
        alpha = matte(frames)
        t = lap("matte", t)
        image = frames.permute(0, 3, 1, 2).float()
        out = person_colour(image, alpha) * alpha + background * (1 - alpha)
        lap("edges", t)
        if logo:
            rgb, logo_alpha = logo
            h, w = rgb.shape[2:]
            # Centred on the lower chest.
            x = (width - w) // 2
            y = min(height - h, round(height * WATERMARK_CENTER_Y - h / 2))
            region = out[:, :, y:y + h, x:x + w]
            out[:, :, y:y + h, x:x + w] = rgb * logo_alpha + region * (1 - logo_alpha)
        return out.round().clamp(0, 255).byte().permute(0, 2, 3, 1).cpu().numpy().tobytes()

    # Reading frames, running the model and writing the video each wait on
    # something different (decoder, GPU, encoder), so they run side by side:
    # one thread reads batches, this one runs the model, one thread writes.
    # The small queues keep memory bounded.
    batches = queue.Queue(maxsize=3)
    results = queue.Queue(maxsize=3)
    stop = threading.Event()
    errors = []

    def put(q, item):
        while not stop.is_set():
            try:
                q.put(item, timeout=0.5)
                return True
            except queue.Full:
                pass
        return False

    def read():
        try:
            batch = []
            while not stop.is_set():
                buf = decoder.stdout.read(frame_bytes)
                if len(buf) < frame_bytes:
                    break
                batch.append(np.frombuffer(buf, np.uint8).reshape(height, width, 3))
                if len(batch) == BATCH_SIZE:
                    if not put(batches, np.stack(batch)):
                        return
                    batch = []
            if batch:
                put(batches, np.stack(batch))
        except BaseException as error:
            errors.append(error)
        finally:
            put(batches, None)

    def write():
        try:
            while not stop.is_set():
                try:
                    data = results.get(timeout=0.5)
                except queue.Empty:
                    continue
                if data is None:
                    return
                encoder.stdin.write(data)
        except BaseException as error:
            errors.append(error)
            stop.set()

    reader = threading.Thread(target=read, daemon=True)
    writer = threading.Thread(target=write, daemon=True)
    reader.start()
    writer.start()

    count = 0
    try:
        while True:
            try:
                frames = batches.get(timeout=0.5)
            except queue.Empty:
                if stop.is_set():
                    break
                continue
            if frames is None:
                break
            previous = count
            count += len(frames)
            if count > MAX_SECONDS * FPS:
                raise ValueError(f"video is longer than {MAX_SECONDS // 60} minutes")
            if not put(results, composite(frames)):
                break
            if count // (FPS * 10) > previous // (FPS * 10):
                on_progress(count)
        put(results, None)
        writer.join()
        if errors:
            raise errors[0]
    except BaseException:
        stop.set()
        decoder.kill()
        encoder.kill()
        raise
    finally:
        stop.set()
        reader.join(timeout=5)
        decoder.stdout.close()

    encoder.stdin.close()
    if decoder.wait() != 0:
        raise RuntimeError("could not read the source video")
    if encoder.wait() != 0:
        raise RuntimeError("could not write the finished video")
    if count == 0:
        raise RuntimeError("the source video has no frames")
    return {"frames": count, "width": width, "height": height,
            "timings": {k: round(v, 1) for k, v in timings.items()}}


def handler(job):
    data = job.get("input") or {}
    # Sent when someone opens the recorder. Starting this worker is the point:
    # the model is already loaded by the time a job can arrive.
    if data.get("warm"):
        return {"warm": True}
    source_url = require_https("source_url", data.get("source_url"))
    upload_url = require_https("upload_url", data.get("upload_url"))
    color = parse_color(data.get("color"))
    logo_url = require_https("logo_url", data["logo_url"]) if data.get("logo_url") else None
    background_url = require_https("background_url", data["background_url"]) if data.get("background_url") else None

    started = time.time()
    with tempfile.TemporaryDirectory() as work:
        source = os.path.join(work, "source")
        output = os.path.join(work, "output.mp4")
        download(source_url, source)

        def on_progress(frames):
            import runpod
            runpod.serverless.progress_update(job, f"{frames // FPS}s processed")

        result = process(source, output, color, logo_url, on_progress, background_url)

        with open(output, "rb") as body:
            res = requests.put(upload_url, data=body, headers={"Content-Type": "video/mp4"}, timeout=600)
            res.raise_for_status()
        result["bytes"] = os.path.getsize(output)

    result["seconds"] = round(time.time() - started, 1)
    result["device"] = torch.cuda.get_device_name() if DEVICE == "cuda" else DEVICE
    return result


if __name__ == "__main__":
    import runpod
    runpod.serverless.start({"handler": handler})
