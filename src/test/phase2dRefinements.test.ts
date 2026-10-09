import { describe, expect, it } from "vitest";
import { resolveReference, reviewMerge, type RegistryEntity } from "../../supabase/functions/_shared/narrative/identity.ts";
import { planIdentitySync } from "../../supabase/functions/_shared/narrative/identitySync.ts";
import { findDeprecatedUses, parseReplacements, replacementTag } from "../../supabase/functions/_shared/narrative/deprecations.ts";
import { buildAdaptiveContext } from "../../supabase/functions/_shared/narrative/adaptiveCandidates.ts";
import type { NarrativeRows } from "../../supabase/functions/_shared/narrative/context.ts";

const person = (id: string, name: string): RegistryEntity => ({ id, kind: "person", name, aliases: [], introducedAt: { chapterIndex: 0, subsectionIndex: 0 }, history: {} });
const at = { chapterIndex: 2, subsectionIndex: 0 };

describe("Different full names sharing a first name", () => {
  it("John Reyes is a new person next to John Hale, not a duplicate", () => {
    const r = resolveReference([person("hale", "John Hale")], { surface: "John Reyes", kind: "person", material: true }, at);
    expect(r.classification).toBe("NEW_ENTITY");
    expect(r.severity).toBe("OK");
  });

  it("both persist with separate ids and neither is skipped", () => {
    const plan = planIdentitySync([person("hale", "John Hale")], [
      { key: "reyes", name: "John Reyes", kind: "person", attribute: "role", value: "harbor pilot", evidence: "John Reyes, the harbor pilot", outline: false },
    ], at);
    expect(plan.create.map((c) => c.name)).toEqual(["John Reyes"]);
    expect(plan.skipped).toEqual([]);
    expect(plan.changes[0].entity_key).toBe("new:reyes");
  });

  it("a bare 'John' with both present is still never guessed", () => {
    const r = resolveReference([person("hale", "John Hale"), person("reyes", "John Reyes")], { surface: "John", kind: "person", material: true }, at);
    expect(r.entityId).toBeNull();
  });

  it("later same-person evidence requires review, never auto-merge", () => {
    const m = reviewMerge(person("hale", "John Hale"), person("reyes", "John Reyes"), "Reyes was the name Hale used at sea");
    expect(m.autoMerge).toBe(false);
    expect(m.severity).toBe("NEEDS_REVIEW");
  });
});

describe("Replaced technical artifacts", () => {
  const reps = parseReplacements([{ name: "fetchUser()", description: "Async user loader; replaces getUser() from chapter 1." }]);

  it("reads the replacement and renders the tag", () => {
    expect(reps).toEqual([expect.objectContaining({ legacy: "getUser", active: "fetchUser" })]);
    expect(replacementTag(reps[0])).toBe("[REPLACED — DO NOT USE: getUser()] (Active replacement: fetchUser())");
  });

  it("continuity flags reuse of the old name as a repairable HIGH issue", () => {
    const issues = findDeprecatedUses("Now call getUser(id) to load the profile.", reps);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("HIGH");
    expect(issues[0].repairable).toBe(true);
  });

  it("passes text that uses the active name, or mentions the old one as history", () => {
    expect(findDeprecatedUses("Call fetchUser(id) to load the profile.", reps)).toEqual([]);
    expect(findDeprecatedUses("fetchUser() replaced getUser() in chapter 3.", reps)).toEqual([]);
  });

  it("adaptive technical context carries the tag next to the active API", () => {
    const rows: NarrativeRows = { characters: [], states: [], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], snapshots: [],
      entities: [{ id: "e1", name: "fetchUser()", entity_type: "api", description: "Async user loader; replaces getUser().", first_chapter_index: 1, first_subsection_index: 0 }] };
    const { context } = buildAdaptiveContext({ bookType: "programming", position: { chapterIndex: 3, subsectionIndex: 0 }, objective: "Continue", outline: { characters: [], chapters: [] }, rows });
    expect(context.text).toContain("[REPLACED — DO NOT USE: getUser()] (Active replacement: fetchUser())");
  });
});

describe("Extraction records technical artifacts and replacements", () => {
  it("keeps artifact type and the 'replaces' wording so the tag can be built", async () => {
    const { buildExtractionPrompt, validateExtraction, ENTITY_TYPES } = await import("../../supabase/functions/_shared/narrative/extraction.ts") as any;
    expect(ENTITY_TYPES).toContain("artifact");
    const p = buildExtractionPrompt({ text: "x", position: { chapterIndex: 0, subsectionIndex: 1 }, characters: [], threads: [] });
    expect(p.system).toContain('"replaces <old name>"');
    const reps = parseReplacements([{ name: "`fetchUser`", description: "Canonical client function; replaces `getUser(userId)`." }]);
    expect(reps).toEqual([{ legacy: "getUser", active: "fetchUser", source: "`fetchUser`" }]);
    void validateExtraction;
  });
});

describe("Replacement parsing direction", () => {
  it("'replaced by' on the old artifact never inverts legacy and active", () => {
    const reps = parseReplacements([
      { name: "getUser(userId)", description: "Deprecated v1 function; replaced by fetchUser." },
      { name: "fetchUser", description: "Canonical client; replaces getUser(userId)." },
    ]);
    expect(reps).toEqual([{ legacy: "getUser", active: "fetchUser", source: "fetchUser" }]);
    expect(findDeprecatedUses("Key on the id alone and the caller gets the cached payload.", reps)).toEqual([]);
    expect(findDeprecatedUses("const u = await getUser(id);", reps)).toHaveLength(1);
    expect(findDeprecatedUses("In v1 this was getUser, which has been replaced by fetchUser.", reps)).toEqual([]);
  });
});
