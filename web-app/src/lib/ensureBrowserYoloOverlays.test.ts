import { describe, expect, it, vi } from "vitest";
import { ensureBrowserYoloOverlays } from "./ensureBrowserYoloOverlays";

vi.mock("./ebsProcessorUrl", () => ({
  getPublicEbsProcessorUrl: vi.fn(() => "http://127.0.0.1:8787/api/process"),
}));

vi.mock("./videoStorage", () => ({
  getSessionVideo: vi.fn(),
}));

vi.mock("./overlayStorage", () => ({
  buildOverlayKey: vi.fn(() => "overlay-key"),
  storeSessionOverlay: vi.fn().mockResolvedValue(undefined),
}));

describe("ensureBrowserYoloOverlays", () => {
  it("does not throw when called with no segment plans", async () => {
    await expect(
      ensureBrowserYoloOverlays({
        sessionId: "session-1",
        referenceVideoUrl: "ref.mp4",
        userVideoUrl: "user.mp4",
        ebsData: { alignment: {} as any, segments: [] },
        refVideo: { current: null },
        userVideo: { current: null },
        existingRef: null,
        existingUser: null,
        setRefArtifact: vi.fn(),
        setUserArtifact: vi.fn(),
        onStatus: vi.fn(),
      }),
    ).rejects.toThrow("Missing session videos for YOLO overlay generation.");
  });
});
