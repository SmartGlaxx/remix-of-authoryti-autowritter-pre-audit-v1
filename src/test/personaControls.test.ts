import { describe, expect, it } from "vitest";
import { portraitOptionCount, personaLibraryState } from "../../supabase/functions/_shared/narrative/personaControls";
describe("persona controls", () => {
  it("allows one to five portrait choices, never six", () => {
    expect(portraitOptionCount(1)).toBe(1);
    expect(portraitOptionCount(5)).toBe(5);
    expect(portraitOptionCount(6)).toBeNull();
    expect(portraitOptionCount(0)).toBeNull();
    expect(portraitOptionCount(1.5)).toBeNull();
  });
  it("demotes without deleting profile data or book links", () => {
    const profile = { voice_sample: "Stay close.", psychology: { fear: "Loss" }, portrait_path: "owner/photo.png" };
    expect({ ...profile, ...personaLibraryState(true) }).toEqual({ ...profile, is_archived: true });
  });
  it("restores a demoted profile through promotion", () => {
    expect(personaLibraryState(false)).toEqual({ is_archived: false });
  });
});