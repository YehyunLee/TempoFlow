"use client";

import type { EbsData } from "../components/ebs/types";
import { getPublicEbsProcessorUrl } from "./ebsProcessorUrl";
import { getSessionVideo } from "./videoStorage";
import { buildOverlayKey, storeSessionOverlay, type OverlayArtifact } from "./overlayStorage";
import {
  buildOverlaySegmentPlans,
  createSegmentedOverlayArtifact,
  getOverlaySegmentByIndex,
  isOverlayArtifactComplete,
  upsertOverlaySegment,
  type OverlaySegmentPlan,
} from "./overlaySegments";

export const BROWSER_YOLO_OVERLAY_FPS = 12;
export const BROWSER_YOLO_VARIANT = "yolo26n-python-dev-v2";

function getOverlayBaseUrl() {
  return getPublicEbsProcessorUrl().replace(/\/api\/process\/?$/, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function startPythonYoloJob(form: FormData) {
  const res = await fetch(`${getOverlayBaseUrl()}/api/overlay/yolo/start`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`YOLO overlay start error (${res.status}): ${txt || res.statusText}`);
  }
  const json = (await res.json()) as { job_id?: string };
  if (!json.job_id) {
    throw new Error("Missing job_id from YOLO overlay start");
  }
  return json.job_id;
}

async function waitForPythonYoloJob(jobId: string, reportProgress: (progress: number) => void) {
  while (true) {
    const stRes = await fetch(
      `${getOverlayBaseUrl()}/api/overlay/yolo/status?job_id=${encodeURIComponent(jobId)}`,
    );
    if (!stRes.ok) {
      const txt = await stRes.text().catch(() => "");
      throw new Error(`YOLO overlay status error (${stRes.status}): ${txt || stRes.statusText}`);
    }

    const st = (await stRes.json()) as {
      status: string;
      progress?: number;
      error?: string;
    };
    reportProgress(typeof st.progress === "number" ? st.progress : 0);

    if (st.status === "done") {
      const outRes = await fetch(
        `${getOverlayBaseUrl()}/api/overlay/yolo/result?job_id=${encodeURIComponent(jobId)}`,
      );
      if (!outRes.ok) {
        const txt = await outRes.text().catch(() => "");
        throw new Error(`YOLO overlay result error (${outRes.status}): ${txt || outRes.statusText}`);
      }
      const blob = await outRes.blob();
      return {
        blob,
        mime: outRes.headers.get("content-type") || "video/webm",
      };
    }

    if (st.status === "error") {
      throw new Error(st.error || "YOLO overlay job failed");
    }

    await sleep(400);
  }
}

async function runSegmentedBrowserYoloPipeline(params: {
  sessionId: string;
  overlaySegmentPlans: OverlaySegmentPlan[];
  getVideoSize: (side: "reference" | "practice") => { width: number; height: number };
  existingReference: OverlayArtifact | null;
  existingPractice: OverlayArtifact | null;
  setReferenceArtifact: (artifact: OverlayArtifact) => void;
  setPracticeArtifact: (artifact: OverlayArtifact) => void;
  onStatus: (msg: string) => void;
}) {
  const {
    sessionId,
    overlaySegmentPlans,
    getVideoSize,
    existingReference,
    existingPractice,
    setReferenceArtifact,
    setPracticeArtifact,
    onStatus,
  } = params;

  if (!overlaySegmentPlans.length) {
    return false;
  }

  if (
    isOverlayArtifactComplete(existingReference, overlaySegmentPlans.length) &&
    isOverlayArtifactComplete(existingPractice, overlaySegmentPlans.length)
  ) {
    onStatus("YOLO overlays already ready.");
    return true;
  }

  let referenceArtifact = createSegmentedOverlayArtifact({
    existing: existingReference,
    type: "yolo",
    side: "reference",
    fps: BROWSER_YOLO_OVERLAY_FPS,
    ...getVideoSize("reference"),
    meta: { generator: "python" },
  });
  let practiceArtifact = createSegmentedOverlayArtifact({
    existing: existingPractice,
    type: "yolo",
    side: "practice",
    fps: BROWSER_YOLO_OVERLAY_FPS,
    ...getVideoSize("practice"),
    meta: { generator: "python" },
  });

  const referenceKey = buildOverlayKey({
    sessionId,
    type: "yolo",
    side: "reference",
    fps: BROWSER_YOLO_OVERLAY_FPS,
    variant: BROWSER_YOLO_VARIANT,
  });
  const practiceKey = buildOverlayKey({
    sessionId,
    type: "yolo",
    side: "practice",
    fps: BROWSER_YOLO_OVERLAY_FPS,
    variant: BROWSER_YOLO_VARIANT,
  });

  for (let idx = 0; idx < overlaySegmentPlans.length; idx += 1) {
    const plan = overlaySegmentPlans[idx];
    const ordinal = idx + 1;
    const existingReferenceSegment = getOverlaySegmentByIndex(referenceArtifact, plan.index);
    const existingPracticeSegment = getOverlaySegmentByIndex(practiceArtifact, plan.index);

    if (existingReferenceSegment && existingPracticeSegment) {
      continue;
    }

    let referenceProgress = existingReferenceSegment ? 1 : 0;
    let practiceProgress = existingPracticeSegment ? 1 : 0;

    const updateSegmentStatus = () => {
      const avgProgress = (referenceProgress + practiceProgress) / 2;
      const pct = Math.max(0, Math.min(100, Math.round(avgProgress * 100)));
      onStatus(`YOLO segment ${ordinal}/${overlaySegmentPlans.length} processing… ${pct}%`);
    };

    updateSegmentStatus();

    const nextReferenceSegment = existingReferenceSegment
      ? existingReferenceSegment
      : await (async () => {
          const file = await getSessionVideo(sessionId, "reference");
          if (!file) throw new Error("Missing reference video for this session");
          const form = new FormData();
          form.append("video", file, file.name);
          form.append("color", "#38bdf8");
          form.append("fps", String(BROWSER_YOLO_OVERLAY_FPS));
          form.append("session_id", sessionId);
          form.append("side", "reference");
          form.append("backend", "wasm");
          form.append("start_sec", String(plan.reference.startSec));
          form.append("end_sec", String(plan.reference.endSec));
          const jobId = await startPythonYoloJob(form);
          const result = await waitForPythonYoloJob(jobId, (progress) => {
            referenceProgress = progress;
            updateSegmentStatus();
          });
          const size = getVideoSize("reference");
          return {
            index: plan.index,
            startSec: plan.reference.startSec,
            endSec: plan.reference.endSec,
            fps: BROWSER_YOLO_OVERLAY_FPS,
            width: size.width,
            height: size.height,
            frameCount: Math.max(
              1,
              Math.ceil((plan.reference.endSec - plan.reference.startSec) * BROWSER_YOLO_OVERLAY_FPS),
            ),
            createdAt: new Date().toISOString(),
            video: result.blob,
            videoMime: result.mime,
            meta: { generator: "python", segmentIndex: plan.index },
          };
        })();

    const nextPracticeSegment = existingPracticeSegment
      ? existingPracticeSegment
      : await (async () => {
          const file = await getSessionVideo(sessionId, "practice");
          if (!file) throw new Error("Missing practice video for this session");
          const form = new FormData();
          form.append("video", file, file.name);
          form.append("color", "#22c55e");
          form.append("fps", String(BROWSER_YOLO_OVERLAY_FPS));
          form.append("session_id", sessionId);
          form.append("side", "practice");
          form.append("backend", "wasm");
          form.append("start_sec", String(plan.practice.startSec));
          form.append("end_sec", String(plan.practice.endSec));
          const jobId = await startPythonYoloJob(form);
          const result = await waitForPythonYoloJob(jobId, (progress) => {
            practiceProgress = progress;
            updateSegmentStatus();
          });
          const size = getVideoSize("practice");
          return {
            index: plan.index,
            startSec: plan.practice.startSec,
            endSec: plan.practice.endSec,
            fps: BROWSER_YOLO_OVERLAY_FPS,
            width: size.width,
            height: size.height,
            frameCount: Math.max(
              1,
              Math.ceil((plan.practice.endSec - plan.practice.startSec) * BROWSER_YOLO_OVERLAY_FPS),
            ),
            createdAt: new Date().toISOString(),
            video: result.blob,
            videoMime: result.mime,
            meta: { generator: "python", segmentIndex: plan.index },
          };
        })();

    referenceArtifact = upsertOverlaySegment(referenceArtifact, nextReferenceSegment);
    practiceArtifact = upsertOverlaySegment(practiceArtifact, nextPracticeSegment);

    await Promise.all([
      storeSessionOverlay(referenceKey, referenceArtifact),
      storeSessionOverlay(practiceKey, practiceArtifact),
    ]);

    setReferenceArtifact(referenceArtifact);
    setPracticeArtifact(practiceArtifact);

    const nextPendingIndex = overlaySegmentPlans.findIndex(
      (candidate) =>
        !getOverlaySegmentByIndex(referenceArtifact, candidate.index) ||
        !getOverlaySegmentByIndex(practiceArtifact, candidate.index),
    );

    if (nextPendingIndex >= 0) {
      onStatus(
        `YOLO segment ${ordinal}/${overlaySegmentPlans.length} ready. ` +
          `Segment ${nextPendingIndex + 1}/${overlaySegmentPlans.length} is processing in the background…`,
      );
    }
  }

  onStatus(
    `YOLO overlays ready. ${overlaySegmentPlans.length}/${overlaySegmentPlans.length} segments processed.`,
  );
  return true;
}

export async function ensureBrowserYoloOverlays(params: {
  sessionId: string;
  referenceVideoUrl: string;
  userVideoUrl: string;
  ebsData: EbsData | null;
  refVideo: { current: HTMLVideoElement | null };
  userVideo: { current: HTMLVideoElement | null };
  existingRef: OverlayArtifact | null;
  existingUser: OverlayArtifact | null;
  setRefArtifact: (artifact: OverlayArtifact) => void;
  setUserArtifact: (artifact: OverlayArtifact) => void;
  onStatus: (msg: string | null) => void;
}) {
  const {
    sessionId,
    referenceVideoUrl,
    userVideoUrl,
    ebsData,
    refVideo,
    userVideo,
    existingRef,
    existingUser,
    setRefArtifact,
    setUserArtifact,
    onStatus,
  } = params;

  const getVideoSize = (side: "reference" | "practice") => {
    const video = side === "reference" ? refVideo.current : userVideo.current;
    return {
      width: video?.videoWidth || 640,
      height: video?.videoHeight || 480,
    };
  };

  const overlaySegmentPlans = buildOverlaySegmentPlans(ebsData);
  const usedSegmented = await runSegmentedBrowserYoloPipeline({
    sessionId,
    overlaySegmentPlans,
    getVideoSize,
    existingReference: existingRef,
    existingPractice: existingUser,
    setReferenceArtifact: setRefArtifact,
    setPracticeArtifact: setUserArtifact,
    onStatus: (msg) => onStatus(msg),
  });

  if (usedSegmented) {
    return;
  }

  const [referenceFile, practiceFile] = await Promise.all([
    getSessionVideo(sessionId, "reference"),
    getSessionVideo(sessionId, "practice"),
  ]);
  if (!referenceFile || !practiceFile) {
    throw new Error("Missing session videos for YOLO overlay generation.");
  }

  onStatus("YOLO (reference)…");
  const referenceForm = new FormData();
  referenceForm.append("video", referenceFile, referenceFile.name);
  referenceForm.append("color", "#38bdf8");
  referenceForm.append("fps", String(BROWSER_YOLO_OVERLAY_FPS));
  referenceForm.append("session_id", sessionId);
  referenceForm.append("side", "reference");
  referenceForm.append("backend", "wasm");
  const referenceJobId = await startPythonYoloJob(referenceForm);
  const referenceResult = await waitForPythonYoloJob(referenceJobId, (progress) =>
    onStatus(`YOLO (reference) ${Math.round(progress * 100)}%`),
  );

  onStatus("YOLO (user)…");
  const practiceForm = new FormData();
  practiceForm.append("video", practiceFile, practiceFile.name);
  practiceForm.append("color", "#22c55e");
  practiceForm.append("fps", String(BROWSER_YOLO_OVERLAY_FPS));
  practiceForm.append("session_id", sessionId);
  practiceForm.append("side", "practice");
  practiceForm.append("backend", "wasm");
  const practiceJobId = await startPythonYoloJob(practiceForm);
  const practiceResult = await waitForPythonYoloJob(practiceJobId, (progress) =>
    onStatus(`YOLO (user) ${Math.round(progress * 100)}%`),
  );

  const refArtifact: OverlayArtifact = {
    version: 1,
    type: "yolo",
    side: "reference",
    fps: BROWSER_YOLO_OVERLAY_FPS,
    ...getVideoSize("reference"),
    frameCount: 0,
    createdAt: new Date().toISOString(),
    video: referenceResult.blob,
    videoMime: referenceResult.mime,
    meta: { generator: "python" },
  };
  const userArtifact: OverlayArtifact = {
    version: 1,
    type: "yolo",
    side: "practice",
    fps: BROWSER_YOLO_OVERLAY_FPS,
    ...getVideoSize("practice"),
    frameCount: 0,
    createdAt: new Date().toISOString(),
    video: practiceResult.blob,
    videoMime: practiceResult.mime,
    meta: { generator: "python" },
  };

  await Promise.all([
    storeSessionOverlay(
      buildOverlayKey({
        sessionId,
        type: "yolo",
        side: "reference",
        fps: BROWSER_YOLO_OVERLAY_FPS,
        variant: BROWSER_YOLO_VARIANT,
      }),
      refArtifact,
    ),
    storeSessionOverlay(
      buildOverlayKey({
        sessionId,
        type: "yolo",
        side: "practice",
        fps: BROWSER_YOLO_OVERLAY_FPS,
        variant: BROWSER_YOLO_VARIANT,
      }),
      userArtifact,
    ),
  ]);

  setRefArtifact(refArtifact);
  setUserArtifact(userArtifact);
  onStatus("YOLO overlays ready.");
}
