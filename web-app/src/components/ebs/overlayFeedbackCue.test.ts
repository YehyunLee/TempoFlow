import { describe, expect, it } from "vitest";

import type { DanceFeedback, SampledPoseFrame } from "../../lib/bodyPix";
import type { OverlayArtifact } from "../../lib/overlayStorage";
import { buildOverlayVisualCue } from "./overlayFeedbackCue";

function createSample(params: { x: number; y: number; score?: number }): SampledPoseFrame {
  const keypoints = Array.from({ length: 17 }, () => ({
    x: 320,
    y: 640,
    score: 0.99,
  }));
  keypoints[8] = {
    x: params.x,
    y: params.y,
    score: params.score ?? 0.99,
  };

  return {
    timestamp: 0.1,
    segmentIndex: 0,
    frameWidth: 640,
    frameHeight: 1280,
    keypoints,
    partCoverage: {
      head: 1,
      arms: 1,
      torso: 1,
      legs: 1,
      full_body: 1,
    },
  };
}

function createArtifact(): OverlayArtifact {
  return {
    version: 1,
    type: "yolo",
    side: "practice",
    fps: 6,
    width: 640,
    height: 1280,
    frameCount: 1,
    createdAt: "2026-03-31T00:00:00.000Z",
    segments: [
      {
        index: 0,
        startSec: 0,
        endSec: 1,
        fps: 6,
        width: 640,
        height: 1280,
        frameCount: 1,
        createdAt: "2026-03-31T00:00:00.000Z",
        meta: {
          segSummary: {
            union: {
              anchor_x: 0.5,
              anchor_y: 0.88,
              center_x: 0.5,
              center_y: 0.5,
              width: 0.3,
              height: 0.8,
              min_x: 0.35,
              max_x: 0.65,
              min_y: 0.08,
              max_y: 0.88,
            },
          },
        },
      },
    ],
  };
}

const feedback: DanceFeedback = {
  timestamp: 0.1,
  segmentIndex: 0,
  bodyRegion: "arms",
  severity: "major",
  message: "Right elbow angle differs by 167° from the guide.",
  deviation: 167,
  jointName: "right elbow",
  signalType: "angle_delta",
  angleDeltaDeg: 167,
  angleDeltaPct: 140,
};

describe("buildOverlayVisualCue", () => {
  it("falls back to a stable body anchor when the sampled joint is far outside the dancer bounds", () => {
    const cue = buildOverlayVisualCue({
      feedback,
      practiceArtifact: createArtifact(),
      practiceSample: createSample({ x: 620, y: 80 }),
    });

    expect(cue).not.toBeNull();
    expect(cue?.xPct).toBeCloseTo(0.5, 5);
    expect(cue?.yPct).toBeCloseTo(0.352, 3);
  });

  it("keeps a sampled joint anchor when it stays on-body", () => {
    const cue = buildOverlayVisualCue({
      feedback,
      practiceArtifact: createArtifact(),
      practiceSample: createSample({ x: 390, y: 470 }),
    });

    expect(cue).not.toBeNull();
    expect(cue?.xPct).toBeCloseTo(390 / 640, 5);
    expect(cue?.yPct).toBeCloseTo(470 / 1280, 5);
  });
});
