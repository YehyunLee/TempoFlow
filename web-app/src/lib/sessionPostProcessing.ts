import type { EbsData } from "../components/ebs/types";
import type { EbsSessionMeta, TempoFlowSession } from "./sessionStorage";

export function getGeminiProcessableSegmentCount(ebsData: EbsData | null | undefined) {
  return (ebsData?.segments ?? []).filter((segment) => {
    const range = segment.beat_idx_range;
    return range != null && range[1] > range[0];
  }).length;
}

export function mergePostProcessMeta(
  meta: EbsSessionMeta | undefined,
  updates: Partial<EbsSessionMeta>,
): EbsSessionMeta {
  return {
    segmentCount: meta?.segmentCount ?? 0,
    sharedDurationSec: meta?.sharedDurationSec ?? 0,
    generatedAt: meta?.generatedAt ?? new Date().toISOString(),
    ...meta,
    ...updates,
  };
}

export function isSessionPostProcessComplete(session: TempoFlowSession | null | undefined) {
  if (!session) return false;
  if (session.ebsStatus === "ready") return true;
  return session.ebsMeta?.finalScore != null && (session.ebsMeta?.segmentCount ?? 0) > 0;
}

export function shouldTreatSessionAsInProcess(session: TempoFlowSession | null | undefined) {
  if (!session) return false;
  if (session.ebsStatus === "paused" || session.ebsStatus === "error") return false;
  if (session.ebsStatus === "processing") return true;
  if (session.status === "analyzing") return true;
  return false;
}
