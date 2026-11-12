import { describe, expect, it } from "vitest";
import { eligibleForRepair, prepareAuditRepair, chooseRepairOption, repairValidationPassed, MAX_AUDIT_REPAIR_ROUNDS, AUDIT_REPAIR_EDIT_LIMIT } from "../../supabase/functions/_shared/narrative/auditRepair";
import { buildManuscriptSections } from "../../supabase/functions/_shared/narrative/audit";
const text = "Mara waited beside the door. " + "She could hear the crowd outside and refused to leave her brother behind. ".repeat(20);
const sections = buildManuscriptSections({ chapters: [{ subsections: [{ status: "completed", content: text }] }, { subsections: [{ status: "completed", content: text.replace("Mara", "Jonas") }] }] });
const option = { id: "a", readerAppeal: 90, believable: true, economy: 40, rationale: "Stronger emotional consequence" };
const proposal = (edits: unknown[], extras = {}) => JSON.stringify({ options: [option], selected: "a", rationale: "Reconcile both passages", edits, ...extras });
const edit = { chapterIndex: 0, subsectionIndex: 0, find: "Mara waited beside the door.", replace: "Mara waited beside her brother." };
const finding = { id: "f", status: "OPEN", verification: "VERIFIED", user_canon_protected: false, category: "timeline", title: "Conflicting elapsed time", evidence_excerpt: "Mara waited" };
describe("Full audit autonomous repair", () => {
  it("keeps at most two repair rounds", () => expect(MAX_AUDIT_REPAIR_ROUNDS).toBe(2));
  it("keeps cumulative edit limit at 20%", () => expect(AUDIT_REPAIR_EDIT_LIMIT).toBe(0.2));
  it("reader appeal beats substantially cheaper rewriting", () => expect(chooseRepairOption([option, { ...option, id: "cheap", readerAppeal: 79, economy: 100 }])).toBe("a"));
  it("economy breaks close reader-appeal ties", () => expect(chooseRepairOption([option, { ...option, id: "cheap", readerAppeal: 85, economy: 100 }])).toBe("cheap"));
  it("unbelievable popular turns cannot win", () => expect(chooseRepairOption([option, { ...option, id: "unreal", readerAppeal: 100, believable: false }])).toBe("a"));
  it("allows both backward and forward section patches", () => {
    const result = prepareAuditRepair(proposal([edit, { ...edit, chapterIndex: 1, find: "Jonas waited beside the door.", replace: "Jonas waited beside his sister." }]), sections);
    expect(result.changes.map(c => c.chapterIndex)).toEqual([0, 1]);
    expect(sections[0].content).toBe(text);
  });
  it("holds changes above the original-relative 20% cap", () => expect(() => prepareAuditRepair(proposal([{ ...edit, find: text, replace: "Mara left." }]), sections)).toThrow("20%"));
  it("rejects ambiguous exact quotations", () => expect(() => prepareAuditRepair(proposal([{ ...edit, find: "She could hear the crowd outside", replace: "She heard them" }]), sections)).toThrow("ambiguous"));
  it("rejects fabricated excerpts", () => expect(() => prepareAuditRepair(proposal([{ ...edit, find: "A fabricated passage" }]), sections)).toThrow("absent"));
  it("protects author evidence and exact anchors", () => expect(() => prepareAuditRepair(proposal([edit]), sections, sections, [edit.find])).toThrow("protected"));
  it("rejects unaccepted prose", () => expect(() => prepareAuditRepair(proposal([edit]), sections.map(s => ({ ...s, status: "pending" })))).toThrow("unaccepted"));
  it("rejects a model selecting rewrite economy over reader appeal", () => expect(() => prepareAuditRepair(proposal([edit], { options: [option, { ...option, id: "cheap", readerAppeal: 70, economy: 100 }], selected: "cheap" }), sections)).toThrow("priority"));
  it("only verified open conflicts are eligible", () => { expect(eligibleForRepair(finding)).toBe(true); expect(eligibleForRepair({ ...finding, verification: "UNCERTAIN" })).toBe(false); });
  it("protects explicit author canon", () => expect(eligibleForRepair({ ...finding, user_canon_protected: true })).toBe(false));
  it("does not auto-rewrite advisory repetition", () => expect(eligibleForRepair({ ...finding, category: "redundancy" })).toBe(false));
  it("does not reopen dismissed author decisions", () => expect(eligibleForRepair({ ...finding, status: "DISMISSED" })).toBe(false));
  it("requires independent complete regression-free validation", () => {
    const v = { resolved: true, protectedIntact: true, coverageComplete: true, regressions: [] };
    expect(repairValidationPassed(JSON.stringify(v))).toBe(true);
    expect(repairValidationPassed(JSON.stringify({ ...v, coverageComplete: false }))).toBe(false);
    expect(repairValidationPassed(JSON.stringify({ ...v, regressions: [{ excerpt: "Jonas", reason: "Identity changed" }] }))).toBe(false);
  });
  it("missing validation cannot pass", () => expect(() => repairValidationPassed("{}")).toThrow());
});