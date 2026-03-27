import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setBackendMock = vi.fn(async () => {});
const readyMock = vi.fn(async () => {});
const createDetectorMock = vi.fn(async () => ({
  estimatePoses: vi.fn(async () => []),
}));

vi.mock("@tensorflow/tfjs-core", () => ({
  setBackend: setBackendMock,
  ready: readyMock,
}));

vi.mock("@tensorflow/tfjs-backend-webgl", () => ({}));

vi.mock("@tensorflow-models/pose-detection", () => ({
  SupportedModels: { MoveNet: "MoveNet" },
  movenet: { modelType: { SINGLEPOSE_LIGHTNING: "singlepose" } },
  createDetector: createDetectorMock,
}));

import PoseOverlay from "./PoseOverlay";

describe("PoseOverlay", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("renders canvas when detector setup succeeds", async () => {
    const videoRef = { current: null };
    const { container } = render(<PoseOverlay videoRef={videoRef} />);

    await waitFor(() => {
      expect(createDetectorMock).toHaveBeenCalled();
      expect(container.querySelector("canvas")).toBeTruthy();
    });
  });

  it("shows error status when detector setup fails", async () => {
    setBackendMock.mockRejectedValueOnce(new Error("tf backend failed"));
    const videoRef = { current: null };
    render(<PoseOverlay videoRef={videoRef} />);

    await waitFor(() => {
      expect(screen.getByText(/Pose overlay unavailable:/)).toBeInTheDocument();
    });
  });
});

