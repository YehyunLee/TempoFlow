"""Tests for `src/overlay_api` helpers and lightweight route branches."""

from __future__ import annotations

import io
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.overlay_api as oa


@pytest.fixture()
def overlay_client():
    app = FastAPI()
    app.include_router(oa.router)
    return TestClient(app)


def test_hex_to_rgb_defaults_and_short_form():
    assert oa._hex_to_rgb("") == (56, 189, 248)
    assert oa._hex_to_rgb("#abc") == (170, 187, 204)
    assert oa._hex_to_rgb("#010203") == (1, 2, 3)
    assert oa._hex_to_rgb("not-a-color") == (56, 189, 248)


def test_scaled_bgr_clamps():
    r, g, b = oa._scaled_bgr("#ff0000", 0.5)
    assert (r, g, b) == (0, 0, 128)


def test_expected_frames():
    assert oa._expected_frames(0, 30) == 1
    assert oa._expected_frames(-1, 30) == 1
    assert oa._expected_frames(1.0, 10) == 10
    assert oa._expected_frames(1.0, 0) == 1


def test_resolve_segment_window():
    assert oa._resolve_segment_window(10.0, None, None) == (0.0, 10.0)
    assert oa._resolve_segment_window(10.0, 2.0, 5.0) == (2.0, 5.0)
    assert oa._resolve_segment_window(0.0, 0.0, None) == (0.0, 0.0)
    # end <= start collapses to start
    s, e = oa._resolve_segment_window(10.0, 5.0, 3.0)
    assert s == 5.0 and e == 5.0


def test_visible_pose_point():
    xy = [(1.0, 2.0), (3.0, 4.0)]
    conf = [0.9, 0.1]
    assert oa._visible_pose_point(xy, conf, 0, threshold=0.25) == (1, 2)
    assert oa._visible_pose_point(xy, conf, 1, threshold=0.25) is None
    assert oa._visible_pose_point(xy, None, 0) == (1, 2)
    assert oa._visible_pose_point([], [], 0) is None
    assert oa._visible_pose_point("not-indexable", None, 0) is None


def test_render_pose_layers_default_shoulder_width(monkeypatch):
    cv2 = MagicMock()
    cv2.LINE_AA = 16
    monkeypatch.setitem(sys.modules, "cv2", cv2)
    xy = np.zeros((17, 2), dtype=np.float32)
    conf = np.zeros(17, dtype=np.float32)
    arms, legs = oa._render_pose_layers(xy, conf, 48, 48, "#ff0000", "#00ff00")
    assert arms.shape == (48, 48, 3)
    assert legs.shape == (48, 48, 3)


def test_draw_pose_segment_skips_when_width_zero():
    overlay = np.zeros((20, 20, 3), dtype=np.uint8)
    oa._draw_pose_segment(overlay, (1, 1), (5, 5), 0, (1, 2, 3))


def test_draw_pose_segment_uses_cv2(monkeypatch):
    cv2 = MagicMock()
    cv2.LINE_AA = 16
    monkeypatch.setitem(sys.modules, "cv2", cv2)
    overlay = np.zeros((32, 32, 3), dtype=np.uint8)
    oa._draw_pose_segment(overlay, (2, 2), (10, 10), 3, (10, 20, 30))
    assert cv2.line.called and cv2.circle.call_count == 2


def test_draw_pose_circle_skips_invalid():
    overlay = np.zeros((10, 10, 3), dtype=np.uint8)
    oa._draw_pose_circle(overlay, None, 5, (1, 2, 3))
    oa._draw_pose_circle(overlay, (5, 5), 0, (1, 2, 3))


def test_render_pose_layers_minimal(monkeypatch):
    cv2 = MagicMock()
    cv2.LINE_AA = 16
    monkeypatch.setitem(sys.modules, "cv2", cv2)
    xy = np.zeros((17, 2), dtype=np.float32)
    xy[5] = [10, 10]
    xy[6] = [20, 10]
    xy[11] = [8, 40]
    xy[12] = [22, 40]
    conf = np.ones(17, dtype=np.float32)
    arms, legs = oa._render_pose_layers(xy, conf, 64, 64, "#ff0000", "#00ff00")
    assert arms.shape == (64, 64, 3) and legs.shape == (64, 64, 3)


def test_weights_path_ends_with_models():
    p = oa._weights_path("yolo26n-seg.pt")
    assert p.name == "yolo26n-seg.pt"
    assert "web-app" in p.parts and "models" in p.parts


def test_overlay_yolo_status_404(overlay_client):
    r = overlay_client.get("/api/overlay/yolo/status?job_id=missing")
    assert r.status_code == 404


def test_overlay_yolo_result_not_found(overlay_client):
    r = overlay_client.get("/api/overlay/yolo/result?job_id=missing")
    assert r.status_code == 404


def test_overlay_yolo_result_not_ready(overlay_client):
    jid = "job1"
    oa.OVERLAY_JOBS[jid] = {"status": "queued", "tmp_out": "/tmp/x", "tmp_in": "/tmp/in"}
    try:
        r = overlay_client.get(f"/api/overlay/yolo/result?job_id={jid}")
        assert r.status_code == 409
    finally:
        oa.OVERLAY_JOBS.pop(jid, None)


def test_overlay_yolo_result_missing_output(overlay_client):
    jid = "job2"
    oa.OVERLAY_JOBS[jid] = {"status": "done", "tmp_out": None, "tmp_in": None}
    try:
        r = overlay_client.get(f"/api/overlay/yolo/result?job_id={jid}")
        assert r.status_code == 500
    finally:
        oa.OVERLAY_JOBS.pop(jid, None)


def test_overlay_pose_status_404(overlay_client):
    assert overlay_client.get("/api/overlay/yolo-pose/status?job_id=x").status_code == 404


def test_overlay_pose_result_invalid_layer(overlay_client):
    jid = "pj"
    oa.POSE_JOBS[jid] = {
        "status": "done",
        "arms_out": "/a.webm",
        "legs_out": "/b.webm",
        "tmp_in": "/in.mp4",
        "served_layers": set(),
    }
    try:
        r = overlay_client.get(f"/api/overlay/yolo-pose/result?job_id={jid}&layer=torso")
        assert r.status_code == 400
    finally:
        oa.POSE_JOBS.pop(jid, None)


def test_overlay_bodypix_status_404(overlay_client):
    assert overlay_client.get("/api/overlay/bodypix/status?job_id=x").status_code == 404


def test_overlay_bodypix_result_paths(overlay_client):
    assert overlay_client.get("/api/overlay/bodypix/result?job_id=x").status_code == 404
    jid = "bj"
    oa.BODYPX_JOBS[jid] = {"status": "processing", "out_path": "/o.webm"}
    try:
        assert overlay_client.get(f"/api/overlay/bodypix/result?job_id={jid}").status_code == 409
    finally:
        oa.BODYPX_JOBS.pop(jid, None)
    oa.BODYPX_JOBS[jid] = {"status": "done", "out_path": None}
    try:
        assert overlay_client.get(f"/api/overlay/bodypix/result?job_id={jid}").status_code == 500
    finally:
        oa.BODYPX_JOBS.pop(jid, None)


@patch("src.overlay_api.save_upload", return_value="/tmp/in.mp4")
def test_overlay_yolo_start_returns_job_id(mock_save, overlay_client):
    vid = ("v.mp4", io.BytesIO(b"fake"), "video/mp4")
    r = overlay_client.post(
        "/api/overlay/yolo/start",
        data={"color": "#ff0000", "fps": 12, "session_id": "s", "side": "left", "backend": "wasm"},
        files={"video": vid},
    )
    assert r.status_code == 200
    assert "job_id" in r.json()


def test_run_yolo_overlay_job_missing_import(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def guard(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "cv2" or name.startswith("cv2."):
            raise ImportError("no cv2")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", guard)
    jid = "import_fail"
    oa.OVERLAY_JOBS[jid] = {"status": "queued"}
    oa._run_yolo_overlay_job(jid, "/in", "/out", "#fff", 12, None, None)
    assert oa.OVERLAY_JOBS[jid]["status"] == "error"
    assert "Missing overlay deps" in (oa.OVERLAY_JOBS[jid].get("error") or "")
    del oa.OVERLAY_JOBS[jid]
