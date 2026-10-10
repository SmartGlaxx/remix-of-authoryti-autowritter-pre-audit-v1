import { describe, expect, it } from "vitest";
import {
  createLeaseHeartbeat, extractionStatusFor, LEASE_HEARTBEAT_MS, LEASE_TTL_SECONDS, progressiveGate, requireApprovedPlan,
} from "../../supabase/functions/_shared/narrative/planning/pipeline.ts";
import { acquireLease, canCommitWithFence } from "../../supabase/functions/_shared/narrative/planning/safeguards.ts";

// Manual timer so heartbeats are driven deterministically.
const fakeTimer = () => {
  let fn: (() => void) | null = null; let cleared = false;
  return {
    setInterval: ((f: () => void) => { fn = f; return 1; }) as unknown as typeof setInterval,
    clearInterval: (() => { cleared = true; }) as unknown as typeof clearInterval,
    tick: () => fn?.(), cleared: () => cleared,
  };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Safeguard 1: lease heartbeat", () => {
  it("renews well inside the lease lifetime", () => {
    expect(LEASE_HEARTBEAT_MS / 1000).toBeLessThan(LEASE_TTL_SECONDS / 3);
  });
  it("keeps renewing while work is active and stays alive", async () => {
    const t = fakeTimer(); let renewals = 0;
    const hb = createLeaseHeartbeat(async () => { renewals++; return true; }, t);
    t.tick(); t.tick(); t.tick(); await flush();
    expect(renewals).toBe(3);
    expect(hb.lost()).toBe(false);
    expect(await hb.beat()).toBe(true);
  });
  it("a failed or thrown renewal marks the worker lost permanently and stops renewing", async () => {
    const t = fakeTimer(); let n = 0; let lostCalls = 0;
    const hb = createLeaseHeartbeat(async () => { n++; if (n === 2) throw new Error("network"); return true; }, { ...t, onLost: () => lostCalls++ });
    t.tick(); await flush(); expect(hb.lost()).toBe(false);
    t.tick(); await flush();
    expect(hb.lost()).toBe(true);
    expect(lostCalls).toBe(1);
    expect(t.cleared()).toBe(true);
    expect(await hb.beat()).toBe(false); // final pre-commit check refuses
    expect(n).toBe(2);
  });
  it("a superseded worker (renew returns false) never commits, even if its token was once valid", async () => {
    const t = fakeTimer();
    const hb = createLeaseHeartbeat(async () => false, t);
    expect(await hb.beat()).toBe(false);
    const now = 1_000_000;
    const a = acquireLease(null, "old", 120, now); if (!a.acquired) throw new Error();
    const b = acquireLease(a.lease, "new", 120, now + 121_000); if (!b.acquired) throw new Error();
    expect(canCommitWithFence(b.lease, "old", a.lease.fencingToken, now + 122_000)).toBe(false);
  });
  it("stopping after commit does not mark the worker lost", async () => {
    const t = fakeTimer();
    const hb = createLeaseHeartbeat(async () => false, t);
    hb.stop(); t.tick(); await flush();
    expect(hb.lost()).toBe(false);
  });
});

describe("Safeguard 2: progressive mode never silently downgrades", () => {
  it("stops with a clear PLAN_REQUIRED error for every unusable plan reason", () => {
    for (const reason of ["no_master", "not_approved", "schema_incompatible", "book_type_mismatch", "no_section"]) {
      const r = requireApprovedPlan({ usable: false, reason });
      expect(r).toMatchObject({ ok: false, code: "PLAN_REQUIRED" });
      if (!r.ok) expect((r as { reason: string }).reason).toContain(reason);
    }
  });
  it("proceeds only with a usable approved plan", () => {
    expect(requireApprovedPlan({ usable: true })).toEqual({ ok: true });
  });
});

describe("Safeguard 3: extraction failure after acceptance", () => {
  const pos = { chapterIndex: 3, subsectionIndex: 0 };
  it("maps outcomes to memory-sync status; unknown outcomes stay pending", () => {
    expect(extractionStatusFor({ status: "completed" })).toBe("EXTRACTED");
    expect(extractionStatusFor({ status: "skipped", reason: "already_processed" })).toBe("EXTRACTED");
    expect(extractionStatusFor({ status: "failed" })).toBe("FAILED");
    expect(extractionStatusFor(null)).toBe("FAILED");
    expect(extractionStatusFor({ status: "no_prose" })).toBeNull();
    expect(extractionStatusFor({ status: "skipped", reason: "other" })).toBeNull();
  });
  it("accepted prose with failed or pending memory blocks the next section", () => {
    expect(progressiveGate({ manuscript: "ACCEPTED", extraction: "FAILED" }, [], pos)).toMatchObject({ ok: false, code: "RECOVER_EXTRACTION" });
    expect(progressiveGate({ manuscript: "ACCEPTED", extraction: "PENDING_EXTRACTION" }, [], pos)).toMatchObject({ ok: false, code: "RECOVER_EXTRACTION" });
  });
  it("a successful retry unblocks; repeating it is idempotent", () => {
    const after = { manuscript: "ESTABLISHED", extraction: extractionStatusFor({ status: "completed" })! } as const;
    expect(progressiveGate(after, [], pos)).toEqual({ ok: true });
    const again = { manuscript: "ESTABLISHED", extraction: extractionStatusFor({ status: "skipped", reason: "already_processed" })! } as const;
    expect(progressiveGate(again, [], pos)).toEqual({ ok: true });
  });
});
