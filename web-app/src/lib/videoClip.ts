"use client";

type CaptureVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
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

export async function extractVideoSegment(params: {
  file: File;
  startSec: number;
  endSec: number;
  fileName: string;
}): Promise<File> {
  const { file, fileName } = params;
  const startSec = Math.max(0, params.startSec);
  const endSec = Math.max(startSec + 0.05, params.endSec);
  const mimeType = getSupportedRecordingMimeType();
  if (mimeType === null) {
    throw new Error("This browser cannot create retry clips.");
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video") as CaptureVideoElement;
  video.src = objectUrl;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = false;
  video.playsInline = true;

  try {
    await waitForEvent(video, "loadedmetadata");
    video.currentTime = startSec;
    await waitForEvent(video, "seeked");

    const stream = video.captureStream?.() ?? video.mozCaptureStream?.();
    if (!stream) {
      throw new Error("This browser cannot clip guide sections yet.");
    }

    const chunks: Blob[] = [];
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    const result = new Promise<File>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        const recorderError =
          "error" in event && event.error instanceof DOMException ? event.error : undefined;
        reject(recorderError ?? new Error("Failed while clipping the guide section."));
      };
      recorder.onstop = () => {
        const blobType = recorder.mimeType || "video/webm";
        const extension = blobType.includes("mp4") ? "mp4" : "webm";
        const clippedBlob = new Blob(chunks, { type: blobType });
        resolve(
          new File([clippedBlob], `${fileName}.${extension}`, {
            type: blobType,
          }),
        );
      };
    });

    recorder.start();
    const stopAt = endSec;
    const stopRecording = () => {
      video.pause();
      video.removeEventListener("timeupdate", handleTimeUpdate);
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    };
    const handleTimeUpdate = () => {
      if (video.currentTime >= stopAt) {
        stopRecording();
      }
    };
    video.addEventListener("timeupdate", handleTimeUpdate);
    await video.play();
    return await result;
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.pause();
    video.src = "";
  }
}
