# One model pair for every writer: Sonnet 5 + Sol

## What changes for you
- The app will only use two writing models: **Claude Sonnet 5** and **OpenAI Sol**. Astra, Opus, Fable (and the small Luna helper model) will be removed from every screen, setting and background job.
- Every writer works the same way underneath. Writers will differ only in **personality and sliders**, not in which model they use. No tiers, just one level.
- Each writer gets one **toggle: "Write with Sol instead of Sonnet."** Sonnet is the default. Drama/screenplay books still default to Sol (you can switch them back).
- Pictures use the **cheapest option**: OpenAI's basic image model at low quality, for character references, covers and illustrations. If it fails, the app won't quietly switch to a pricier model.

## Who does which job
```text
Job                                   Model
Writing prose (default)               Sonnet 5   (toggle -> Sol)
Drama / screenplay (default)          Sol        (toggle -> Sonnet 5)
Planning, book ideas, variants        Sol (low effort)
Character cards + reading pictures    Sol (low effort)
Continuity checks, memory, summaries  Sol (low effort)
Repairs and literary polish           Sol
Pictures                              Cheapest OpenAI image model, low quality
```
Expected effect: a character card drops from about $0.15–0.42 to about $0.03–0.05. Checks and memory cost a little more than with Luna (roughly +$0.01 per section).

## Then finish the live test (needs your OK on spend, about $0.50)
1. Make the 4 missing character pictures on the new setup.
2. Write Chapter 1 sections 2–4 on Sonnet 5, approving each one.
3. Confirm the costs and models used, and that every section is accepted and saved to story memory.

## Technical details
- `_shared/writers/profiles.ts`: replace `PREMIER_PROFILE` with one Sonnet/Sol profile; remove the Luna/Astra constants; add `controls.draftModel: "sonnet" | "sol"` (missing = Sonnet for prose, Sol for drama) resolved in `roles.ts` (`resolveModelForRole`, `defaultBookConfig`), replacing `SCRIPT_DRAFT_MODEL` special-casing.
- `ai/registry.ts`: remove the Astra, Fable, Opus and Luna entries; `ideation.ts`, `book-ideas`, `characterReferenceServer.ts`, `literaryReviser.ts` (model choice becomes Sol only), `abExperiment.ts`, `naturalness-experiment`, `provider-keys`, `ModelConfigCard.tsx`: point to Sol or remove the option. Development books get no compatibility shims (they can be reset).
- Writer UI (WriterStudio / Book Variants writer picker / book settings): add the Sonnet↔Sol toggle; remove any remaining tier wording.
- `openaiImage.ts` + `generate-cover`, `generate-image`, `persona-studio`: one image model (`gpt-image-2`, quality low, no fallback).
- Update tests that assert Astra/Luna routing; add tests: default prose = Sonnet 5, toggle = Sol, drama default = Sol, planner/checker = Sol, no removed model in the registry. Update `AGENTS.md` rules about models; redeploy affected functions.
