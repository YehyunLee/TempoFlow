import { describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const summary = {
  scores: { overall: 80, timing: 75, positioning: 82, smoothness: 79, energy: 84 },
  strongestArea: "energy",
  focusArea: "timing",
  timingOffsetMs: 120,
  durationSec: 10,
  segments: [{ id: "s1", label: "seg0", startSec: 0, endSec: 2, focusArea: "timing", score: 72 }],
  insights: [{ id: "i1", tone: "tip", title: "Timing", body: "Hit accents cleaner." }],
  generatedAt: new Date().toISOString(),
};

describe("api/coach route", () => {
  it("returns 400 when summary is missing", async () => {
    const req = new Request("http://localhost/api/coach", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns local fallback when OPENAI_API_KEY is missing", async () => {
    vi.unstubAllEnvs();
    const req = new Request("http://localhost/api/coach", {
      method: "POST",
      body: JSON.stringify({ summary }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ source: "local-fallback" });
  });

  it("returns openai source when upstream returns parseable insights", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("OPENAI_MODEL", "gpt-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ output_text: JSON.stringify({ insights: ["a", "b", "c"] }) }), {
          status: 200,
        }),
      ),
    );

    const req = new Request("http://localhost/api/coach", {
      method: "POST",
      body: JSON.stringify({ summary }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      source: "openai",
      insights: ["a", "b", "c"],
    });
  });
});

