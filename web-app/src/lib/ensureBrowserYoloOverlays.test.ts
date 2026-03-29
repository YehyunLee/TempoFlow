import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBrowserYoloOverlays } from "./ensureBrowserYoloOverlays";
import { getSessionVideo } from "./videoStorage";

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionVideo).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("starts segmented reference and user seg/pose jobs in parallel", async () => {
    vi.mocked(getSessionVideo).mockImplementation(async (_sessionId, side) => {
      return new File([`${side}-video`], `${side}.mp4`, { type: "video/mp4" });
    });

    const fetchCalls: string[] = [];
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const videoResponse = () =>
      new Response(new Blob(["video"], { type: "video/webm" }), {
        status: 200,
        headers: { "content-type": "video/webm" },
      });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchCalls.push(url);

        if (url.endsWith("/api/overlay/yolo/start")) {
          return jsonResponse({ job_id: `seg-${fetchCalls.length}` });
        }
        if (url.endsWith("/api/overlay/yolo-pose/start")) {
          return jsonResponse({ job_id: `pose-${fetchCalls.length}` });
        }
        if (url.includes("/api/overlay/yolo/status")) {
          return jsonResponse({ status: "done", progress: 1 });
        }
        if (url.includes("/api/overlay/yolo-pose/status")) {
          return jsonResponse({ status: "done", progress: 1 });
        }
        if (url.includes("/api/overlay/yolo/result")) {
          return videoResponse();
        }
        if (url.includes("/api/overlay/yolo-pose/result")) {
          return videoResponse();
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await ensureBrowserYoloOverlays({
      sessionId: "session-1",
      referenceVideoUrl: "ref.mp4",
      userVideoUrl: "user.mp4",
      ebsData: {
        alignment: {
          clip_1_start_sec: 0,
          clip_2_start_sec: 0,
          shared_len_sec: 1,
        },
        segments: [
          {
            shared_start_sec: 0,
            shared_end_sec: 1,
          },
        ],
      },
      refVideo: { current: null },
      userVideo: { current: null },
      existingRef: null,
      existingUser: null,
      existingRefArms: null,
      existingRefLegs: null,
      existingUserArms: null,
      existingUserLegs: null,
      setRefArtifact: vi.fn(),
      setUserArtifact: vi.fn(),
      setRefArmsArtifact: vi.fn(),
      setRefLegsArtifact: vi.fn(),
      setUserArmsArtifact: vi.fn(),
      setUserLegsArtifact: vi.fn(),
      onStatus: vi.fn(),
      onSegmentProgress: vi.fn(),
      onSegmentComplete: vi.fn(),
    });

    expect(fetchCalls.slice(0, 4).every((url) => url.includes("/start"))).toBe(true);
    expect(fetchCalls.slice(0, 4).filter((url) => url.endsWith("/api/overlay/yolo/start"))).toHaveLength(2);
    expect(fetchCalls.slice(0, 4).filter((url) => url.endsWith("/api/overlay/yolo-pose/start"))).toHaveLength(2);
  });
});
