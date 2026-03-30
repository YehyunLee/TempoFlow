"use client";

import type { EbsData } from "../components/ebs/types";
import { getSessionEbs, storeSessionEbs } from "./ebsStorage";
import { buildEbsMeta } from "./ebsSessionMeta";
import {
  getSession,
  type TempoFlowSession,
  updateSession,
} from "./sessionStorage";
import { getSessionVideo } from "./videoStorage";
import {
  getProcessorBaseUrl,
  getPublicEbsProcessorUrl,
  isLocalDevProcessorUrl,
} from "./ebsProcessorUrl";

const MAX_EBS_PROCESSING_SECONDS = 5 * 60;
const PROCESSING_POLL_MS = 1200;

type ProcessorStatusPayload = {
  status?: string;
  has_result?: boolean;
};

type RuntimeMode = "upload" | "poll";

type SessionProcessingRuntime = {
  sessionId: string;
  mode: RuntimeMode;
  controller: AbortController | null;
  intervalId: number | null;
  timeoutId: number | null;
  promise: Promise<void> | null;
  stopped: boolean;
};

const runtimes = new Map<string, SessionProcessingRuntime>();

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function clearRuntime(runtime: SessionProcessingRuntime) {
  runtime.stopped = true;
  if (runtime.intervalId != null) {
    window.clearInterval(runtime.intervalId);
    runtime.intervalId = null;
  }
  if (runtime.timeoutId != null) {
    window.clearTimeout(runtime.timeoutId);
    runtime.timeoutId = null;
  }
  runtime.controller = null;
  runtime.promise = null;
  const current = runtimes.get(runtime.sessionId);
  if (current === runtime) {
    runtimes.delete(runtime.sessionId);
  }
}

function markProcessing(sessionId: string, session?: TempoFlowSession | null) {
  const currentSession = session ?? getSession(sessionId);
  if (!currentSession) return null;

  return updateSession(sessionId, {
    status: "analyzing",
    ebsStatus: "processing",
    ebsErrorMessage: undefined,
    errorMessage: undefined,
    ebsMeta: {
      ...(currentSession.ebsMeta ?? {
        segmentCount: 0,
        sharedDurationSec: 0,
        generatedAt: new Date().toISOString(),
      }),
      processingStartedAt: currentSession.ebsMeta?.processingStartedAt ?? new Date().toISOString(),
      finalScore: currentSession.ebsMeta?.finalScore,
    },
  });
}

function getFriendlyProcessorError(message: string, processorUrl: string) {
  const isChromeIoSuspended = message.includes("ERR_NETWORK_IO_SUSPENDED");
  const isFetchFailed = message.includes("Failed to fetch") || message.includes("NetworkError");
  const hostedHint = isLocalDevProcessorUrl(processorUrl)
    ? "Couldn't reach the clip processor. Make sure the local service is running, then retry."
    : "Couldn't reach the clip processor right now. Please retry in a moment.";

  if (isChromeIoSuspended) {
    return "The upload paused when the browser backgrounded the tab. Resume processing to reconnect.";
  }
  if (isFetchFailed) {
    return hostedHint;
  }
  return message;
}

async function adoptArtifact(sessionId: string, data: EbsData) {
  const currentSession = getSession(sessionId);
  await storeSessionEbs(sessionId, data);
  updateSession(sessionId, {
    status: "analyzed",
    ebsStatus: "ready",
    ebsErrorMessage: undefined,
    errorMessage: undefined,
    ebsMeta: buildEbsMeta(data, currentSession?.ebsMeta),
  });
}

async function fetchProcessorStatus(sessionId: string): Promise<ProcessorStatusPayload | null> {
  const statusUrl = `${getProcessorBaseUrl()}/api/status?session=${encodeURIComponent(sessionId)}`;
  try {
    const response = await fetch(statusUrl, { method: "GET", cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as ProcessorStatusPayload;
  } catch {
    return null;
  }
}

async function fetchProcessorResult(sessionId: string): Promise<EbsData | null> {
  const resultUrl = `${getProcessorBaseUrl()}/api/result?session=${encodeURIComponent(sessionId)}`;
  try {
    const response = await fetch(resultUrl, { method: "GET", cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as EbsData;
  } catch {
    return null;
  }
}

async function adoptExistingArtifact(sessionId: string): Promise<boolean> {
  const cached = await getSessionEbs(sessionId);
  if (cached) {
    await adoptArtifact(sessionId, cached);
    return true;
  }

  const status = await fetchProcessorStatus(sessionId);
  if (status?.status === "done" && status.has_result) {
    const result = await fetchProcessorResult(sessionId);
    if (result) {
      await adoptArtifact(sessionId, result);
      return true;
    }
  }

  return false;
}

function createRuntime(sessionId: string, mode: RuntimeMode): SessionProcessingRuntime {
  const runtime: SessionProcessingRuntime = {
    sessionId,
    mode,
    controller: null,
    intervalId: null,
    timeoutId: null,
    promise: null,
    stopped: false,
  };
  runtimes.set(sessionId, runtime);
  return runtime;
}

function startPolling(sessionId: string) {
  const existing = runtimes.get(sessionId);
  if (existing?.mode === "poll" && existing.promise) {
    return existing.promise;
  }
  if (existing) {
    clearRuntime(existing);
  }

  const runtime = createRuntime(sessionId, "poll");
  markProcessing(sessionId);

  runtime.promise = new Promise<void>((resolve) => {
    const check = async () => {
      if (runtime.stopped) return;
      const session = getSession(sessionId);
      if (!session || session.ebsStatus === "paused") {
        clearRuntime(runtime);
        resolve();
        return;
      }

      const status = await fetchProcessorStatus(sessionId);
      if (runtime.stopped) return;
      if (!status) return;

      if (status.status === "done" && status.has_result) {
        const result = await fetchProcessorResult(sessionId);
        if (result) {
          await adoptArtifact(sessionId, result);
        }
        clearRuntime(runtime);
        resolve();
        return;
      }

      if (status.status === "error") {
        updateSession(sessionId, {
          status: "error",
          ebsStatus: "error",
          ebsErrorMessage: "The background processor reported an error. Resume processing to retry.",
          errorMessage: "The background processor reported an error. Resume processing to retry.",
        });
        clearRuntime(runtime);
        resolve();
      }
    };

    runtime.intervalId = window.setInterval(() => {
      void check();
    }, PROCESSING_POLL_MS);
    void check();
  });

  return runtime.promise;
}

async function startUpload(sessionId: string, session: TempoFlowSession) {
  const existing = runtimes.get(sessionId);
  if (existing?.mode === "upload" && existing.promise) {
    return existing.promise;
  }
  if (existing) {
    clearRuntime(existing);
  }

  const [referenceFile, practiceFile] = await Promise.all([
    getSessionVideo(sessionId, "reference"),
    getSessionVideo(sessionId, "practice"),
  ]);

  if (!referenceFile || !practiceFile) {
    updateSession(sessionId, {
      status: "error",
      ebsStatus: "error",
      ebsErrorMessage: "The saved source videos for this session were not found.",
      errorMessage: "The saved source videos for this session were not found.",
    });
    return;
  }

  const processorUrl = getPublicEbsProcessorUrl();
  const runtime = createRuntime(sessionId, "upload");
  runtime.controller = new AbortController();
  runtime.timeoutId = window.setTimeout(() => {
    runtime.controller?.abort();
  }, MAX_EBS_PROCESSING_SECONDS * 1000);
  markProcessing(sessionId, session);

  runtime.promise = (async () => {
    try {
      const formData = new FormData();
      formData.append("ref_video", referenceFile, referenceFile.name);
      formData.append("user_video", practiceFile, practiceFile.name);
      formData.append("session_id", sessionId);

      const response = await fetch(processorUrl, {
        method: "POST",
        body: formData,
        signal: runtime.controller?.signal,
      });
      const payload = (await response.json()) as EbsData & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to generate EBS data for this session.");
      }

      await adoptArtifact(sessionId, payload);
    } catch (error) {
      const currentSession = getSession(sessionId);
      if (runtime.controller?.signal.aborted && currentSession?.ebsStatus === "paused") {
        clearRuntime(runtime);
        return;
      }

      if (isAbortError(error)) {
        clearRuntime(runtime);
        void startPolling(sessionId);
        return;
      }

      const message = error instanceof Error ? error.message : "Failed to generate EBS data for this session.";
      updateSession(sessionId, {
        status: "error",
        ebsStatus: "error",
        ebsErrorMessage: getFriendlyProcessorError(message, processorUrl),
        errorMessage: getFriendlyProcessorError(message, processorUrl),
      });
    } finally {
      clearRuntime(runtime);
    }
  })();

  return runtime.promise;
}

export async function ensureSessionProcessing(sessionId: string, options?: { respectPaused?: boolean }) {
  const session = getSession(sessionId);
  if (!session) return;
  if (session.ebsStatus === "ready") return;
  if (session.ebsStatus === "paused" && options?.respectPaused !== false) return;

  if (await adoptExistingArtifact(sessionId)) return;

  const remoteStatus = await fetchProcessorStatus(sessionId);
  if (remoteStatus?.status === "processing") {
    await startPolling(sessionId);
    return;
  }

  await startUpload(sessionId, session);
}

export function pauseSessionProcessing(sessionId: string) {
  const runtime = runtimes.get(sessionId);
  if (runtime) {
    runtime.stopped = true;
    runtime.controller?.abort();
    if (runtime.intervalId != null) {
      window.clearInterval(runtime.intervalId);
      runtime.intervalId = null;
    }
    if (runtime.timeoutId != null) {
      window.clearTimeout(runtime.timeoutId);
      runtime.timeoutId = null;
    }
    runtimes.delete(sessionId);
  }

  const session = getSession(sessionId);
  if (!session) return;

  updateSession(sessionId, {
    status: "analyzing",
    ebsStatus: "paused",
    ebsErrorMessage: undefined,
    errorMessage: undefined,
    ebsMeta: {
      ...(session.ebsMeta ?? {
        segmentCount: 0,
        sharedDurationSec: 0,
        generatedAt: new Date().toISOString(),
      }),
      processingStartedAt: session.ebsMeta?.processingStartedAt ?? new Date().toISOString(),
      finalScore: session.ebsMeta?.finalScore,
    },
  });
}

export function resumeSessionProcessing(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return Promise.resolve();
  markProcessing(sessionId, session);
  return ensureSessionProcessing(sessionId, { respectPaused: false });
}
