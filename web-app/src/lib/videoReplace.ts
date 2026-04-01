"use client";

type CaptureCanvasElement = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream;
};

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

async function waitForEvent(target: EventTarget, eventName: string) {
  await new Promise<void>((resolve, reject) => {
    const handleResolve = () => {
      cleanup();
      resolve();
    };
    const handleReject = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${eventName}.`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, handleResolve);
      target.removeEventListener("error", handleReject);
    };
    target.addEventListener(eventName, handleResolve, { once: true });
    target.addEventListener("error", handleReject, { once: true });
  });
}

async function loadVideo(objectUrl: string) {
  const video = document.createElement("video");
  video.src = objectUrl;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  await waitForEvent(video, "loadedmetadata");
  return video;
}

async function seekVideo(video: HTMLVideoElement, timeSec: number) {
  const normalizedTime = Number.isFinite(timeSec) ? timeSec : 0;
  const maxDuration = Number.isFinite(video.duration) ? video.duration : normalizedTime;
  const safeTime = Math.max(0, Math.min(maxDuration, normalizedTime));
  video.currentTime = safeTime;
  await waitForEvent(video, "seeked");
}

async function playSegment(params: {
  video: HTMLVideoElement;
  startSec: number;
  endSec: number;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
}) {
  const { video, ctx, canvas } = params;
  const startSec = Math.max(0, Number.isFinite(params.startSec) ? params.startSec : 0);
  const endSec = Math.max(startSec, Number.isFinite(params.endSec) ? params.endSec : startSec);
  if (endSec - startSec <= 0.01) return;

  await seekVideo(video, startSec);

  await new Promise<void>((resolve, reject) => {
    let rafId = 0;
    let done = false;

    const cleanup = () => {
      done = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      video.pause();
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
    };

    const handleEnded = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Failed while rebuilding the retry video."));
    };

    const drawFrame = () => {
      if (done) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (video.currentTime >= endSec - 0.02) {
        cleanup();
        resolve();
        return;
      }
      rafId = window.requestAnimationFrame(drawFrame);
    };

    video.addEventListener("ended", handleEnded, { once: true });
    video.addEventListener("error", handleError, { once: true });
    void video.play().then(() => {
      drawFrame();
    }).catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

export async function replaceVideoSegment(params: {
  originalFile: File;
  replacementFile: File;
  startSec: number;
  endSec: number;
  fileName: string;
}): Promise<File> {
  const mimeType = getSupportedRecordingMimeType();
  if (mimeType === null) {
    throw new Error("This browser cannot rebuild retry videos.");
  }

  const originalUrl = URL.createObjectURL(params.originalFile);
  const replacementUrl = URL.createObjectURL(params.replacementFile);

  try {
    const [originalVideo, replacementVideo] = await Promise.all([
      loadVideo(originalUrl),
      loadVideo(replacementUrl),
    ]);

    const originalDuration = originalVideo.duration;
    if (!Number.isFinite(originalDuration) || originalDuration <= 0) {
      throw new Error("Original practice clip duration is unavailable.");
    }

    const width = originalVideo.videoWidth || replacementVideo.videoWidth || 720;
    const height = originalVideo.videoHeight || replacementVideo.videoHeight || 1280;
    const canvas = document.createElement("canvas") as CaptureCanvasElement;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not create retry composition canvas.");
    }
    const stream = canvas.captureStream?.(30);
    if (!stream) {
      throw new Error("This browser cannot capture retry composition video.");
    }

    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const result = new Promise<File>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        const recorderError =
          "error" in event && event.error instanceof DOMException ? event.error : undefined;
        reject(recorderError ?? new Error("Failed while rebuilding the retry video."));
      };
      recorder.onstop = () => {
        const blobType = recorder.mimeType || "video/webm";
        const extension = blobType.includes("mp4") ? "mp4" : "webm";
        resolve(new File([new Blob(chunks, { type: blobType })], `${params.fileName}.${extension}`, { type: blobType }));
      };
    });

    const replaceStartInput = Number.isFinite(params.startSec) ? params.startSec : 0;
    const replaceEndInput = Number.isFinite(params.endSec) ? params.endSec : replaceStartInput;
    const replaceStartSec = Math.max(0, Math.min(originalDuration, replaceStartInput));
    const replaceEndSec = Math.max(replaceStartSec, Math.min(originalDuration, replaceEndInput));

    recorder.start();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    await playSegment({
      video: originalVideo,
      startSec: 0,
      endSec: replaceStartSec,
      ctx,
      canvas,
    });
    await playSegment({
      video: replacementVideo,
      startSec: 0,
      endSec: Number.isFinite(replacementVideo.duration) ? replacementVideo.duration : replaceEndSec - replaceStartSec,
      ctx,
      canvas,
    });
    await playSegment({
      video: originalVideo,
      startSec: replaceEndSec,
      endSec: originalDuration,
      ctx,
      canvas,
    });

    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    return await result;
  } finally {
    URL.revokeObjectURL(originalUrl);
    URL.revokeObjectURL(replacementUrl);
  }
}
