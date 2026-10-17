import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));
import { saveThenAccept } from "@/lib/candidateReview";

const calls: any[] = [];
beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = vi.fn(async (_u: any, init: any) => {
    const body = JSON.parse(init.body); calls.push(body);
    const data = body.action === "save_edit" ? { status: "saved", candidate_id: "new-id" } : { status: "held" };
    return new Response(JSON.stringify(data), { status: 200 });
  }) as any;
});

describe("held draft acceptance", () => {
  it("saves an edit before checks and validates the saved version", async () => {
    await saveThenAccept("b", "old-id", "original", "edited");
    expect(calls.map((c) => c.action)).toEqual(["save_edit", "accept"]);
    expect(calls[1].candidateId).toBe("new-id");
    expect(calls[1].editedText).toBeUndefined();
  });
  it("without edits, validates the stored candidate directly", async () => {
    await saveThenAccept("b", "old-id", "original", "original");
    expect(calls.map((c) => c.action)).toEqual(["accept"]);
    expect(calls[0].candidateId).toBe("old-id");
  });
});

import { needsReplaceConfirmation } from "@/lib/candidateReview";
describe("accepted section protection", () => {
  it("asks keep-or-replace for both the new status and the old error", () => {
    expect(needsReplaceConfirmation({ status: "needs_replace_confirmation" })).toBe(true);
    expect(needsReplaceConfirmation({ error: "ACCEPTED_SECTION_PROTECTED" })).toBe(true);
    expect(needsReplaceConfirmation({ status: "held" })).toBe(false);
  });
});
