import { describe, expect, it } from "vitest";
import { allIssuesDismissed, hasUnfinishedRepair, displayWritingStatus } from "@/lib/reviewDisplay";
const issue = { explanation: "Both rhythms differ", excerpt: "nine beats, pause, nine beats" };
const log = { chapter_index: 1, subsection_index: 0, decision: "DISMISS", description: issue.explanation, newer: { summary: issue.excerpt } };
describe("resolved review display", () => {
  it("recognizes dismissal only for the exact finding and section", () => {
    expect(allIssuesDismissed([issue], [log], 1, 0)).toBe(true);
    expect(allIssuesDismissed([issue], [log], 0, 0)).toBe(false);
  });
  it("retains review when another finding is unresolved or repair is incomplete", () => {
    expect(allIssuesDismissed([issue, { explanation: "Different age", excerpt: "a child" }], [log], 1, 0)).toBe(false);
    expect(allIssuesDismissed([issue], [{ ...log, decision: "KEEP_CANON_REVISE_PROSE" }], 1, 0)).toBe(false);
  });
  it("keeps a dismissed conflict separate from an unrelated held draft", () => {
    expect(hasUnfinishedRepair({ decision: "DISMISS", candidate: { id: "held" }, application_status: "PENDING_APPLICATION" })).toBe(false);
    expect(hasUnfinishedRepair({ decision: "KEEP_CANON_REVISE_PROSE", candidate: { id: "held" }, application_status: "PENDING_APPLICATION" })).toBe(true);
  });
  it("clears paused writing indicators without changing completed sections", () => {
    expect(displayWritingStatus("writing", "paused")).toBe("pending");
    expect(displayWritingStatus("writing", "writing")).toBe("writing");
    expect(displayWritingStatus("completed", "paused")).toBe("completed");
  });
});
