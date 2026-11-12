import { describe, expect, it, vi } from "vitest";
import { buildAllBlueprints } from "@/lib/buildAllBlueprints";

const defaults = () => ({ bookId: "book", masterPlanId: "master", chapters: [2, 0, 1], plans: [], call: vi.fn().mockResolvedValue({ ok: true, data: {} }), onProgress: vi.fn(), shouldStop: () => false });

describe("all-chapter detailed blueprints", () => {
  it("chains all chapters in order with one request at a time", async () => {
    const options = defaults();
    let active = 0;
    options.call.mockImplementation(async () => {
      expect(++active).toBe(1);
      await Promise.resolve();
      active--;
      return { ok: true, data: {} };
    });
    expect(await buildAllBlueprints(options)).toEqual({ done: 3, total: 3 });
    expect(options.call.mock.calls.map(([body]) => body.chapter)).toEqual([0, 1, 2]);
    expect(options.call.mock.calls.every(([body]) => body.action === "blueprint" && body.bookId === "book" && body.masterPlanId === "master")).toBe(true);
  });
  it("preserves both drafted and approved blueprints without approving anything", async () => {
    const options = { ...defaults(), plans: [
      { plan_level: "BLUEPRINT", chapter_index: 0, plan_status: "READY" },
      { plan_level: "BLUEPRINT", chapter_index: 1, plan_status: "PLANNED" },
      { plan_level: "BLUEPRINT", chapter_index: 2, plan_status: "RETIRED" },
    ] };
    await buildAllBlueprints(options);
    expect(options.call).toHaveBeenCalledTimes(1);
    expect(options.call.mock.calls[0][0]).toMatchObject({ action: "blueprint", chapter: 2 });
  });
  it("stops on failure, preserving completed chapters for resume", async () => {
    const options = defaults();
    options.call.mockResolvedValueOnce({ ok: true, data: {} }).mockResolvedValueOnce({ ok: false, data: { error: "Needs attention" } });
    await expect(buildAllBlueprints(options)).rejects.toThrow("Chapter 2: Needs attention");
    expect(options.call).toHaveBeenCalledTimes(2);
    expect(options.onProgress).toHaveBeenCalledWith(1, 3, 0);
  });
  it("honors stop after the current chapter completes", async () => {
    const options = defaults();
    options.shouldStop = () => options.call.mock.calls.length > 0;
    expect(await buildAllBlueprints(options)).toEqual({ done: 1, total: 3 });
    expect(options.call).toHaveBeenCalledTimes(1);
  });
});