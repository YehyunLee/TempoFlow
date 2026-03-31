import { normalizeFocusedRetryEbs } from "./focusedRetryEbs";
import type { EbsData } from "../components/ebs/types";

describe("normalizeFocusedRetryEbs", () => {
  it("collapses a retry artifact down to one focused section", () => {
    const data: EbsData = {
      alignment: {
        clip_1_start_sec: 12,
        clip_1_end_sec: 18,
        clip_2_start_sec: 4,
        clip_2_end_sec: 10,
        shared_len_sec: 6,
      },
      beats_shared_sec: [0, 1, 2.5, 4, 6],
      segmentation_mode: "auto",
      segments: [
        { shared_start_sec: 0, shared_end_sec: 2, beat_idx_range: [0, 2] },
        { shared_start_sec: 2, shared_end_sec: 6, beat_idx_range: [2, 4] },
      ],
    };

    const normalized = normalizeFocusedRetryEbs(data, {
      scope: "segment",
      title: "Section 2",
      sourceSessionId: "source-session",
      sharedStartSec: 2.5,
      sharedEndSec: 5.5,
    });

    expect(normalized.segmentation_mode).toBe("focused-segment");
    expect(normalized.segments).toEqual([
      {
        seg_id: 0,
        shared_start_sec: 0,
        shared_end_sec: 6,
        beat_idx_range: [0, 4],
        clip_1_seg_start_sec: 12,
        clip_1_seg_end_sec: 18,
        clip_2_seg_start_sec: 4,
        clip_2_seg_end_sec: 10,
      },
    ]);
  });

  it("omits beat windows when the focused retry has fewer than two beats", () => {
    const data: EbsData = {
      alignment: {
        clip_1_start_sec: 1,
        clip_2_start_sec: 2,
        shared_len_sec: 0.8,
      },
      beats_shared_sec: [0.2],
      segments: [{ shared_start_sec: 0, shared_end_sec: 0.8 }],
    };

    const normalized = normalizeFocusedRetryEbs(data, {
      scope: "move",
      title: "Move 3",
      sourceSessionId: "source-session",
      sharedStartSec: 8.1,
      sharedEndSec: 8.9,
    });

    expect(normalized.segmentation_mode).toBe("focused-move");
    expect(normalized.segments[0]).toMatchObject({
      shared_start_sec: 0,
      shared_end_sec: 0.8,
      clip_1_seg_start_sec: 1,
      clip_1_seg_end_sec: 1.8,
      clip_2_seg_start_sec: 2,
      clip_2_seg_end_sec: 2.8,
    });
    expect(normalized.segments[0]?.beat_idx_range).toBeUndefined();
  });
});
