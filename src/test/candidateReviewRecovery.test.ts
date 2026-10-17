import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
import { callReview } from "@/lib/candidateReview";

afterEach(() => vi.unstubAllGlobals());
describe("story review recovery", () => {
  it("returns a recoverable refusal for an outdated service without retrying a write", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const result = await callReview({ action: "prepare_conflict", bookId: "temporary" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("returns a recoverable refusal when the connection fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await callReview({ action: "conflicts", bookId: "temporary" })).toMatchObject({ ok: false, status: 503 });
  });
});