import { describe, it, expect } from "vitest";
import { isBlueprintExampleRole as r } from "../../supabase/functions/_shared/narrative/planning/blueprint";
describe("instructional example roles", () => {
  it("generic roles are example participants", () => {
    for (const n of ["Report writer", "Colleague", "Bill payer", "Reader", "A new manager"]) expect(r(n, "self_help")).toBe(true);
  });
  it("named people still need approval", () => {
    for (const n of ["Omar Reyes", "Dr Lee", "Omar", "Kiera Vance"]) expect(r(n, "self_help")).toBe(false);
  });
  it("fiction never bypasses", () => expect(r("Colleague", "fiction")).toBe(false));
});
