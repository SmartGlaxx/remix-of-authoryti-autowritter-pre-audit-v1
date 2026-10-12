/** Profile inspiration only; old story history never travels to a fresh identity. */
export function reusablePersonaProfile(source: Record<string, any>, profile?: Record<string, any> | null) {
  return {
    displayName: source.display_name, aliases: [...(source.aliases ?? [])], kind: source.kind ?? "person",
    seedDetails: { reused_from_identity_id: source.id },
    profile: {
      category: profile?.category ?? "general", creation_mode: "promoted",
      birth_date: profile?.birth_date ?? null, death_date: profile?.death_date ?? null,
      psychology: structuredClone(profile?.psychology ?? {}), voice_sample: profile?.voice_sample ?? null,
      portrait_path: profile?.portrait_path ?? null, user_facts: structuredClone(profile?.user_facts ?? []),
      ai_expansions: [], milestones: [],
    },
  };
}