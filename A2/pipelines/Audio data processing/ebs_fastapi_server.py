#!/usr/bin/env python3
"""
FastAPI server for TempoFlow EBS processing.

This is a modern replacement for `ebs_server.py` (http.server) with:
  - POST /api/process  (multipart ref_video + user_video [+ session_id])
  - GET  /api/status?session=<id>
  - GET  /api/result?session=<id>

Run:
  python3 -m pip install -r requirements.txt
  python3 -m pip install fastapi uvicorn python-multipart
  uvicorn ebs_fastapi_server:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

import json
import logging
import math
import uuid
import asyncio
import threading
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from ebs_segment import auto_align, extract_audio_from_video, load_audio, run_ebs_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ebs-fastapi")

app = FastAPI(title="TempoFlow EBS Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


SESSION_STATUS: dict[str, str] = {}
SESSION_RESULTS: dict[str, dict[str, Any]] = {}

# Overlay job tracking for real-time progress polling
OVERLAY_JOBS: dict[str, dict[str, Any]] = {}


def _sanitize_json(obj: Any) -> Any:
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_json(v) for v in obj]
    return obj


def probe_video_metadata(video_path: str) -> dict[str, Any]:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate,nb_frames,duration",
        "-of",
        "json",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr.strip()}")

    payload = json.loads(result.stdout or "{}")
    streams = payload.get("streams", [])
    if not streams:
        raise RuntimeError("No video stream found")

    stream = streams[0]
    fps_raw = stream.get("avg_frame_rate", "0/1")
    num, den = fps_raw.split("/")
    fps = float(num) / float(den) if float(den) != 0 else 0.0
    duration_sec = float(stream.get("duration") or 0.0)

    nb_frames_raw = stream.get("nb_frames")
    if nb_frames_raw and str(nb_frames_raw).isdigit():
        frame_count = int(nb_frames_raw)
    else:
        frame_count = int(round(duration_sec * fps)) if fps > 0 else 0

    return {"fps": fps, "duration_sec": duration_sec, "frame_count": frame_count}


def _save_upload(upload: UploadFile, prefix: str) -> str:
    suffix = Path(upload.filename or "video.mp4").suffix or ".mp4"
    tmp = tempfile.NamedTemporaryFile(prefix=f"ebs_{prefix}_", suffix=suffix, delete=False)
    try:
        data = upload.file.read()
        tmp.write(data)
    finally:
        tmp.close()
    return tmp.name


@app.post("/api/process")
async def process(
    ref_video: UploadFile = File(...),
    user_video: UploadFile = File(...),
    session_id: str | None = Form(default=None),
):
    sid = (session_id or "").strip() or "default"
    SESSION_STATUS[sid] = "processing"
    logger.info("Received video files — running EBS pipeline (session=%s)", sid)

    ref_tmp = _save_upload(ref_video, "ref")
    user_tmp = _save_upload(user_video, "user")
    ref_wav: str | None = None
    user_wav: str | None = None

    try:
        logger.info("Extracting audio…")
        ref_wav = extract_audio_from_video(ref_tmp)
        user_wav = extract_audio_from_video(user_tmp)

        logger.info("Auto-align…")
        ref_audio = load_audio(ref_wav)
        user_audio = load_audio(user_wav)
        alignment = auto_align(ref_audio, user_audio)

        logger.info("EBS segmentation…")
        artifact = run_ebs_pipeline(
            ref_audio_path=ref_wav,
            alignment=alignment,
            user_audio_path=user_wav,
        )

        try:
            artifact["video_meta"] = {
                "clip_1": probe_video_metadata(ref_tmp),
                "clip_2": probe_video_metadata(user_tmp),
            }
        except Exception as probe_exc:
            logger.warning("Video probe failed: %s", probe_exc)

        payload = _sanitize_json(artifact)
        SESSION_RESULTS[sid] = payload
        SESSION_STATUS[sid] = "done"
        return JSONResponse(payload, status_code=200)

    except Exception as exc:
        logger.exception("Pipeline error")
        SESSION_STATUS[sid] = "error"
        return JSONResponse({"error": str(exc)}, status_code=500)

    finally:
        for p in [ref_tmp, user_tmp, ref_wav, user_wav]:
            if not p:
                continue
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass


@app.get("/api/status")
async def status(session: str | None = None):
    sid = (session or "").strip() or "default"
    st = SESSION_STATUS.get(sid, "idle")
    has_result = sid in SESSION_RESULTS
    segment_count = None
    if has_result:
        try:
            segment_count = len(SESSION_RESULTS[sid].get("segments") or [])
        except Exception:
            segment_count = None
    return {"session": sid, "status": st, "has_result": has_result, "segment_count": segment_count}


@app.get("/api/result")
async def result(session: str | None = None):
    sid = (session or "").strip() or "default"
    if sid not in SESSION_RESULTS:
        return JSONResponse({"error": "No result for this session yet."}, status_code=404)
    return JSONResponse(SESSION_RESULTS[sid], status_code=200)


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = (hex_color or "#38bdf8").strip().lstrip("#")
    if len(h) == 3:
        h = "".join([c * 2 for c in h])
    if len(h) != 6:
        return (56, 189, 248)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


@app.post("/api/overlay/yolo")
async def overlay_yolo(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    color: str = Form(default="#38bdf8"),
    fps: int = Form(default=12),
    session_id: str | None = Form(default=None),
    side: str | None = Form(default=None),
    backend: str = Form(default="wasm"),
):
    """
    Generate a transparent overlay video (WebM VP9 w/ alpha) for dancer segmentation.

    Notes:
      - Uses Ultralytics YOLO segmentation (person class only).
      - Returns `video/webm` with alpha channel.
    """
    sid = (session_id or "").strip() or "default"
    _ = side  # reserved for logging/caching later
    _ = backend  # reserved for future GPU selection

    # Dependency check happens once in the request thread; the heavy lifting is done in a worker thread.
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
        from ultralytics import YOLO  # type: ignore
    except Exception as exc:
        return JSONResponse(
            {"error": f"Missing overlay deps. Install ultralytics + opencv-python. Details: {exc}"},
            status_code=500,
        )

    # Resolve weights from repo (web-app/public/models/yolo26n-seg.pt)
    weights = (
        Path(__file__).resolve().parents[3] / "web-app" / "public" / "models" / "yolo26n-seg.pt"
    ).resolve()
    if not weights.exists():
        return JSONResponse({"error": f"YOLO weights not found at {weights}"}, status_code=500)

    tmp_in = _save_upload(video, "overlay")
    tmp_out = tempfile.NamedTemporaryFile(prefix="overlay_", suffix=".webm", delete=False).name

    def worker() -> None:
        cap = cv2.VideoCapture(tmp_in)
        if not cap.isOpened():
            raise RuntimeError("Failed to open video.")

        src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)

        out_fps_local = max(1, int(fps))
        out_dt_local = 1.0 / float(out_fps_local)

        try:
            meta = probe_video_metadata(tmp_in)
            duration_sec = float(meta.get("duration_sec") or 0.0)
        except Exception:
            duration_sec = 0.0

        expected_frames_local = None
        if duration_sec > 0:
            expected_frames_local = max(1, int(math.ceil(duration_sec * out_fps_local)))

        logger.info(
            "YOLO overlay (session=%s) %dx%d src_fps=%.2f → out_fps=%d",
            sid,
            w,
            h,
            src_fps,
            out_fps_local,
        )

        model = YOLO(str(weights))
        r0, g0, b0 = _hex_to_rgb(color)

        fourcc = cv2.VideoWriter_fourcc(*"VP90")
        writer = cv2.VideoWriter(tmp_out, fourcc, out_fps_local, (w, h))
        if not writer.isOpened():
            raise RuntimeError("Failed to open VideoWriter for overlay.")

        written_frames_local = 0
        last_overlay_local = None

        next_out_time_local = 0.0
        last_frame_time_local = 0.0

        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                break

            try:
                frame_time_sec_local = float(cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0) / 1000.0
            except Exception:
                frame_time_sec_local = last_frame_time_local + out_dt_local
            last_frame_time_local = frame_time_sec_local

            if frame_time_sec_local + (out_dt_local * 0.25) < next_out_time_local:
                continue

            results = model.predict(
                frame_bgr, imgsz=640, conf=0.25, iou=0.5, classes=[0], verbose=False
            )

            alpha_u8 = np.zeros((h, w), dtype=np.uint8)
            if results and results[0].masks is not None:
                m = results[0].masks.data
                mm = m.detach().cpu().numpy()  # type: ignore[attr-defined]
                alpha = np.max(mm, axis=0).astype(np.float32)
                alpha = np.clip(alpha, 0.0, 1.0)
                if alpha.shape[0] != h or alpha.shape[1] != w:
                    alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_CUBIC)
                alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=1.4, sigmaY=1.4)
                alpha_u8 = (alpha * 255.0).astype(np.uint8)

            overlay = np.zeros((h, w, 3), dtype=np.uint8)
            overlay[..., 0] = (alpha_u8.astype(np.uint16) * b0 // 255).astype(np.uint8)
            overlay[..., 1] = (alpha_u8.astype(np.uint16) * g0 // 255).astype(np.uint8)
            overlay[..., 2] = (alpha_u8.astype(np.uint16) * r0 // 255).astype(np.uint8)

            slack_local = out_dt_local * 0.25
            dup_count_local = 1
            if frame_time_sec_local + slack_local > next_out_time_local:
                dup_count_local = int(
                    math.floor(
                        (frame_time_sec_local + slack_local - next_out_time_local) / out_dt_local
                    )
                ) + 1
                dup_count_local = max(1, dup_count_local)

            if expected_frames_local is not None:
                remaining_local = expected_frames_local - written_frames_local
                if remaining_local <= 0:
                    break
                dup_count_local = min(dup_count_local, remaining_local)

            for _ in range(dup_count_local):
                writer.write(overlay)
                last_overlay_local = overlay
                written_frames_local += 1
                next_out_time_local += out_dt_local
                if expected_frames_local is not None and written_frames_local >= expected_frames_local:
                    break

        cap.release()

        if expected_frames_local is not None and written_frames_local < expected_frames_local:
            if last_overlay_local is None:
                last_overlay_local = np.zeros((h, w, 3), dtype=np.uint8)
            pad_count_local = expected_frames_local - written_frames_local
            for _ in range(pad_count_local):
                writer.write(last_overlay_local)
            written_frames_local = expected_frames_local

        writer.release()

    try:
        await asyncio.to_thread(worker)
        background_tasks.add_task(lambda: Path(tmp_in).unlink(missing_ok=True))
        background_tasks.add_task(lambda: Path(tmp_out).unlink(missing_ok=True))

        return FileResponse(
            path=tmp_out,
            media_type="video/webm",
            filename=f"{sid}_yolo_overlay.webm",
        )
    except Exception as exc:
        logger.exception("YOLO overlay error")
        return JSONResponse({"error": str(exc)}, status_code=500)

def _expected_frames(duration_sec: float, out_fps: int) -> int:
    if duration_sec and duration_sec > 0:
        return max(1, int(math.ceil(duration_sec * out_fps)))
    return 1


def _yolo_overlay_job_worker(job_id: str, tmp_in: str, tmp_out: str, color: str, fps: int) -> None:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
        from ultralytics import YOLO  # type: ignore
    except Exception as exc:
        OVERLAY_JOBS[job_id]["status"] = "error"
        OVERLAY_JOBS[job_id]["error"] = f"Missing overlay deps: {exc}"
        return

    weights = (
        Path(__file__).resolve().parents[3] / "web-app" / "public" / "models" / "yolo26n-seg.pt"
    ).resolve()
    if not weights.exists():
        OVERLAY_JOBS[job_id]["status"] = "error"
        OVERLAY_JOBS[job_id]["error"] = f"YOLO weights not found at {weights}"
        return

    cap = cv2.VideoCapture(tmp_in)
    if not cap.isOpened():
        OVERLAY_JOBS[job_id]["status"] = "error"
        OVERLAY_JOBS[job_id]["error"] = "Failed to open video."
        return

    out_fps_local = max(1, int(fps))
    out_dt_local = 1.0 / float(out_fps_local)

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)

    try:
        meta = probe_video_metadata(tmp_in)
        duration_sec = float(meta.get("duration_sec") or 0.0)
    except Exception:
        duration_sec = 0.0

    expected = _expected_frames(duration_sec, out_fps_local)

    OVERLAY_JOBS[job_id]["frames_expected"] = expected
    OVERLAY_JOBS[job_id]["frames_written"] = 0
    OVERLAY_JOBS[job_id]["progress"] = 0.0
    OVERLAY_JOBS[job_id]["status"] = "processing"

    model = YOLO(str(weights))
    r0, g0, b0 = _hex_to_rgb(color)

    fourcc = cv2.VideoWriter_fourcc(*"VP90")
    writer = cv2.VideoWriter(tmp_out, fourcc, out_fps_local, (w, h))
    if not writer.isOpened():
        OVERLAY_JOBS[job_id]["status"] = "error"
        OVERLAY_JOBS[job_id]["error"] = "Failed to open VideoWriter."
        return

    written = 0
    next_out_time = 0.0
    last_frame_time = 0.0
    last_overlay = None

    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break

        try:
            t = float(cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0) / 1000.0
        except Exception:
            t = last_frame_time + out_dt_local
        last_frame_time = t

        if t + (out_dt_local * 0.25) < next_out_time:
            continue

        results = model.predict(frame_bgr, imgsz=640, conf=0.25, iou=0.5, classes=[0], verbose=False)

        alpha_u8 = np.zeros((h, w), dtype=np.uint8)
        if results and results[0].masks is not None:
            m = results[0].masks.data
            mm = m.detach().cpu().numpy()  # type: ignore[attr-defined]
            alpha = np.max(mm, axis=0).astype(np.float32)
            alpha = np.clip(alpha, 0.0, 1.0)
            if alpha.shape[0] != h or alpha.shape[1] != w:
                alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_CUBIC)
            alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=1.4, sigmaY=1.4)
            alpha_u8 = (alpha * 255.0).astype(np.uint8)

        overlay = np.zeros((h, w, 3), dtype=np.uint8)
        overlay[..., 0] = (alpha_u8.astype(np.uint16) * b0 // 255).astype(np.uint8)
        overlay[..., 1] = (alpha_u8.astype(np.uint16) * g0 // 255).astype(np.uint8)
        overlay[..., 2] = (alpha_u8.astype(np.uint16) * r0 // 255).astype(np.uint8)
        last_overlay = overlay

        slack = out_dt_local * 0.25
        dup_count = 1
        if t + slack > next_out_time:
            dup_count = int(math.floor((t + slack - next_out_time) / out_dt_local)) + 1
            dup_count = max(1, dup_count)

        remaining = expected - written
        if remaining <= 0:
            break
        dup_count = min(dup_count, remaining)

        for _ in range(dup_count):
            writer.write(overlay)
            written += 1
            next_out_time += out_dt_local
            OVERLAY_JOBS[job_id]["frames_written"] = written
            OVERLAY_JOBS[job_id]["progress"] = min(1.0, written / float(expected))
            if written >= expected:
                break

        if written >= expected:
            break

    # Pad if needed
    if written < expected and last_overlay is not None:
        for _ in range(expected - written):
            writer.write(last_overlay)
        written = expected
        OVERLAY_JOBS[job_id]["frames_written"] = written
        OVERLAY_JOBS[job_id]["progress"] = 1.0

    cap.release()
    writer.release()
    OVERLAY_JOBS[job_id]["status"] = "done"


@app.post("/api/overlay/yolo/start")
async def overlay_yolo_start(
    video: UploadFile = File(...),
    color: str = Form(default="#38bdf8"),
    fps: int = Form(default=12),
    session_id: str | None = Form(default=None),
    side: str | None = Form(default=None),
    backend: str = Form(default="wasm"),
):
    _ = backend
    sid = (session_id or "").strip() or "default"
    side_val = (side or "").strip() or "unknown"
    job_id = str(uuid.uuid4())

    tmp_in = _save_upload(video, f"overlay_{side_val}_{job_id}")
    tmp_out = tempfile.NamedTemporaryFile(prefix=f"overlay_{side_val}_{job_id}_", suffix=".webm", delete=False).name

    OVERLAY_JOBS[job_id] = {
        "status": "queued",
        "progress": 0.0,
        "frames_written": 0,
        "frames_expected": None,
        "tmp_in": tmp_in,
        "tmp_out": tmp_out,
        "session_id": sid,
        "side": side_val,
        "error": None,
    }

    t = threading.Thread(
        target=_yolo_overlay_job_worker,
        args=(job_id, tmp_in, tmp_out, color, fps),
        daemon=True,
    )
    t.start()

    return JSONResponse({"job_id": job_id}, status_code=200)


@app.get("/api/overlay/yolo/status")
async def overlay_yolo_status(job_id: str):
    job = OVERLAY_JOBS.get(job_id)
    if not job:
        return JSONResponse({"error": "Unknown job_id"}, status_code=404)
    return {
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": float(job.get("progress", 0.0) or 0.0),
        "frames_written": job.get("frames_written"),
        "frames_expected": job.get("frames_expected"),
        "error": job.get("error"),
    }


@app.get("/api/overlay/yolo/result")
async def overlay_yolo_result(job_id: str, background_tasks: BackgroundTasks):
    job = OVERLAY_JOBS.get(job_id)
    if not job:
        return JSONResponse({"error": "Unknown job_id"}, status_code=404)
    if job.get("status") != "done":
        return JSONResponse({"error": "Job not ready"}, status_code=409)

    tmp_out = job.get("tmp_out")
    tmp_in = job.get("tmp_in")
    if not tmp_out:
        return JSONResponse({"error": "Missing output"}, status_code=500)

    background_tasks.add_task(lambda: Path(tmp_out).unlink(missing_ok=True))
    if tmp_in:
        background_tasks.add_task(lambda: Path(tmp_in).unlink(missing_ok=True))
    OVERLAY_JOBS.pop(job_id, None)

    return FileResponse(path=tmp_out, media_type="video/webm", filename=f"{job_id}_yolo_overlay.webm")

