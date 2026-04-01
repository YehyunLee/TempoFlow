import type { EbsData, EbsSegment } from "../components/ebs/types";
import type { FocusedRetryContext } from "./sessionStorage";

function buildFocusedBeatRange(beats: number[] | undefined): [number, number] | undefined {
  if (!Array.isArray(beats) || beats.length < 2) return undefined;
  return [0, beats.length - 1];
}

function buildFocusedSegment(data: EbsData): EbsSegment {
  const sharedDurationSec = Math.max(0, data.alignment.shared_len_sec ?? 0);
  const refStartSec = Math.max(0, data.alignment.clip_1_start_sec ?? 0);
  const userStartSec = Math.max(0, data.alignment.clip_2_start_sec ?? 0);
  const refEndSec =
    data.alignment.clip_1_end_sec ?? Math.max(refStartSec, refStartSec + sharedDurationSec);
  const userEndSec =
    data.alignment.clip_2_end_sec ?? Math.max(userStartSec, userStartSec + sharedDurationSec);

  return {
    seg_id: 0,
    shared_start_sec: 0,
    shared_end_sec: sharedDurationSec,
    beat_idx_range: buildFocusedBeatRange(data.beats_shared_sec),
    clip_1_seg_start_sec: refStartSec,
    clip_1_seg_end_sec: refEndSec,
    clip_2_seg_start_sec: userStartSec,
    clip_2_seg_end_sec: userEndSec,
  };
}

export function normalizeFocusedRetryEbs(data: EbsData, retryContext: FocusedRetryContext): EbsData {
  return {
    ...data,
    segments: [buildFocusedSegment(data)],
    segmentation_mode: `focused-${retryContext.scope}`,
  };
}
