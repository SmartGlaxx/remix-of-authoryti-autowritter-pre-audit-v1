import { describe, it, expect } from "vitest";
import {
  acquireLease, renewLease, releaseLease, canCommitWithFence, type Lease,
  containsVerbatim, validateAnchors, anchorsInScope, nextAnchorVersions, type ExactAnchor,
  decideReconciliation, reconciliationGate, type ReconciliationLog,
} from "../../supabase/functions/_shared/narrative/planning/safeguards";

const T0 = 1_000_000;

describe("generation leases", () => {
  it("only one of several racing workers gets the lease", () => {
    let cur: Lease | null = null;
    const wins = ["w1", "w2", "w3", "w4", "w5"].filter((w) => {
      const r = acquireLease(cur, w, 60, T0);
      if (r.acquired && !r.reentrant) { cur = r.lease; return true; }
      return false;
    });
    expect(wins).toEqual(["w1"]);
  });
  it("expired lease is taken over with a higher fencing token", () => {
    const a = acquireLease(null, "old", 60, T0);
    if (!a.acquired) throw new Error();
    const b = acquireLease(a.lease, "new", 60, T0 + 61_000);
    expect(b).toMatchObject({ acquired: true, tookOver: true, lease: { fencingToken: 2, workerId: "new" } });
  });
  it("stale worker cannot commit, renew or release after takeover", () => {
    const a = acquireLease(null, "old", 60, T0); if (!a.acquired) throw new Error();
    const b = acquireLease(a.lease, "new", 60, T0 + 61_000); if (!b.acquired) throw new Error();
    const now = T0 + 62_000;
    expect(canCommitWithFence(b.lease, "old", 1, now)).toBe(false);
    expect(renewLease(b.lease, "old", 1, 60, now)).toBeNull();
    expect(releaseLease(b.lease, "old", 1)).toBeNull();
    expect(canCommitWithFence(b.lease, "new", 2, now)).toBe(true);
  });
  it("holder cannot commit after its own lease expires without renewal", () => {
    const a = acquireLease(null, "w", 10, T0); if (!a.acquired) throw new Error();
    expect(canCommitWithFence(a.lease, "w", 1, T0 + 11_000)).toBe(false);
  });
  it("heartbeat extends expiry; released lease is reacquired with a new token", () => {
    const a = acquireLease(null, "w", 10, T0); if (!a.acquired) throw new Error();
    const r = renewLease(a.lease, "w", 1, 10, T0 + 8_000)!;
    expect(canCommitWithFence(r, "w", 1, T0 + 15_000)).toBe(true);
    const rel = releaseLease(r, "w", 1)!;
    expect(acquireLease(rel, "w2", 10, T0 + 16_000)).toMatchObject({ acquired: true, lease: { fencingToken: 2 } });
  });
  it("rejects out-of-range TTL", () => {
    expect(() => acquireLease(null, "w", 1, T0)).toThrow();
  });
});

describe("exact-detail anchors", () => {
  const code: ExactAnchor = { key: "vault", exactText: "7-4-1-9", matchMode: "EXACT", effectiveChapterIndex: 0, version: 1, isActive: true };
  it("verbatim match is boundary-aware and case-sensitive by default", () => {
    expect(containsVerbatim("The code was 7-4-1-9.", "7-4-1-9", "EXACT")).toBe(true);
    expect(containsVerbatim("The code was 7-4-1-90.", "7-4-1-9", "EXACT")).toBe(false);
    expect(containsVerbatim("mara quell", "Mara Quell", "EXACT")).toBe(false);
    expect(containsVerbatim("mara quell", "Mara Quell", "CASE_INSENSITIVE")).toBe(true);
  });
  it("validation is conditional: only required anchors are checked", () => {
    expect(validateAnchors("No code here.", [code], [], 3)).toEqual([]);
    expect(validateAnchors("He typed 7-4-1-8.", [code], ["vault"], 3).map((a) => a.key)).toEqual(["vault"]);
  });
  it("future anchors are withheld until their chapter", () => {
    const later = { ...code, key: "twist", effectiveChapterIndex: 9 };
    expect(anchorsInScope([code, later], 2).map((a) => a.key)).toEqual(["vault"]);
  });
  it("same text is idempotent; changed text retires old and creates version 2", () => {
    expect(nextAnchorVersions([code], "vault", "7-4-1-9", "EXACT", 0).status).toBe("unchanged");
    const r = nextAnchorVersions([code], "vault", "7-4-1-8", "EXACT", 3);
    expect(r.status).toBe("versioned");
    expect(r.anchors.filter((a) => a.isActive)).toEqual([expect.objectContaining({ version: 2, exactText: "7-4-1-8" })]);
    expect(r.anchors.find((a) => a.version === 1)?.isActive).toBe(false);
  });
});

describe("canon reconciliation", () => {
  const log: ReconciliationLog = { ownerId: "u1", severity: "CRITICAL", chapterIndex: 2, decision: "PENDING", replanRequired: false };
  it("only the owner may decide", () => {
    expect(decideReconciliation(log, "intruder", "DISMISS", "x")).toEqual({ ok: false, reason: "not_found" });
    expect(decideReconciliation(log, null, "DISMISS", "x")).toEqual({ ok: false, reason: "not_authenticated" });
  });
  it("a rationale is required", () => {
    expect(decideReconciliation(log, "u1", "DISMISS", "   ")).toEqual({ ok: false, reason: "rationale_required" });
  });
  it("accepting prose over canon schedules re-planning; decisions are final", () => {
    const r = decideReconciliation(log, "u1", "ACCEPT_PROSE_UPDATE_CANON", "Prose is better");
    expect(r).toMatchObject({ ok: true, log: { replanRequired: true } });
    if (!r.ok) throw new Error();
    expect(decideReconciliation(r.log, "u1", "DISMISS", "again")).toEqual({ ok: false, reason: "already_decided" });
  });
  it("pending critical contradictions block later generation", () => {
    expect(reconciliationGate([log], 3)).toEqual({ ok: false, pending: 1 });
    expect(reconciliationGate([{ ...log, severity: "MINOR" }], 3)).toEqual({ ok: true });
    expect(reconciliationGate([{ ...log, decision: "DISMISS" }], 3)).toEqual({ ok: true });
  });
});
