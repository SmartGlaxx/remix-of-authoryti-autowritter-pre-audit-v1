import { describe, it, expect } from "vitest";
import { renderActiveOverlays } from "../../supabase/functions/_shared/writers/learning";
import { lockModeOf } from "@/components/WriterVersionLockCard";

const rows = [
  { id: "a", writer_id: "w", dimension: "rhythm", status: "active", version: 1, adjustment: { directive: "Vary rhythm." } },
  { id: "b", writer_id: "w", dimension: "openings", status: "active", version: 1, adjustment: { directive: "Vary openings." } },
] as never[];

describe("Book-level improvement version lock", () => {
  it("no pins follows every latest active improvement", () => {
    expect(lockModeOf(undefined)).toBe("latest");
    expect(renderActiveOverlays(rows, "w", null)).toContain("Vary openings.");
  });
  it("empty pin list means original voice only", () => {
    expect(lockModeOf([])).toBe("base");
    expect(renderActiveOverlays(rows, "w", [])).toBe("");
  });
  it("pinned versions use only the chosen improvements", () => {
    expect(lockModeOf(["a"])).toBe("pinned");
    const out = renderActiveOverlays(rows, "w", ["a"]);
    expect(out).toContain("Vary rhythm.");
    expect(out).not.toContain("Vary openings.");
  });
});
