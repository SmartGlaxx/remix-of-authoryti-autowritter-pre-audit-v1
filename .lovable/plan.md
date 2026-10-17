# Audit: Why New Characters Appear, and How to Lock the Story to the Plan

This report covers the 9 questions in your brief. Nothing was changed, and no paid AI was used.

## Key finding first
Your "Characters to confirm" list has two separate causes.

1. **A matching bug.** In your real book, 156 entries are waiting. The ones checked are all "Kiera Vance", from Chapter 1, Section 2, listed again and again. Kiera Vance is already in the book's cast. She gets flagged because the step that records "who knows what" only looks up names in your shared persona/universe list. It never checks the book's own cast. So characters you planned get asked about as if they were new.
2. **Real invention.** The writing instructions allow and sometimes encourage new people (see 4). The chapter plans also don't say who is in each scene, so the writer fills the gaps.

Fixing cause 1 alone should clear most of that list. Cause 2 needs the blueprint work below.

## 1. Where unplanned characters enter
- The writer's pacing rules say to add a hook every few paragraphs, and "new character entrance" is one of the listed hooks.
- Other instructions demand "NEW events, NEW developments" in every section.
- After acceptance, story memory reads the prose. Any name it can't match becomes a review entry or a new story record.

## 2. How chapter plans look today
- Whole-book summary: 300–500 words (unchanged by this work).
- Chapter: objective, stakes, focus, and a list of sections with objectives.
- Section: entry, focus, outcome, and optional reveal setup.
- Beats: 2–8 per section, each just a type plus a one-line note.
- No step lists the cast, places or events per chapter, section or beat, and there is nothing like one sentence per paragraph.

## 3. Where detail is lost
Between the whole-book summary and the section plan. Characters in the book's cast are passed to the writer as a general cast list (with future debuts held back). No plan level says who is present in this scene, where it happens, or which events happen.

## 4. Do the writing instructions allow invention?
Yes. Nothing forbids new named people, places or major events, and the hook rule actively suggests new characters. The quality checks catch contradictions, but not "this person was never planned".

## 5. What can be reused (no duplicate systems)
- The planning chain (master plan, chapters, sections, beats) gets richer beats and a chapter blueprint.
- The book's cast and story records are the single list of characters, places and events.
- The name matcher already handles nicknames, aliases and full names, and is not fooled by capital letters.
- Debut timing and secret-reveal protection stay as they are.
- The pre-acceptance check, held drafts, the contradiction cards and protected acceptance are where an unplanned person is caught.

## 6. Removing post-writing confirmation safely
- First, fix the lookup so the book's own cast counts as known, and clear the duplicate entries.
- For planned books, an unknown name found after writing becomes a held-draft finding with three choices: rewrite without it, add it to the plan, or keep it as an approved plan change. It never becomes a silent new character.
- The "Characters to confirm" panel is hidden for planned books. It stays for older books until they're migrated.

## 7. Data changes
- New optional fields inside chapter and section plans: a readable synopsis, a cast list, places, events, and detailed microbeats. Each beat lists its characters, place, events, purpose and handoff to the next beat, all linked to the book's existing records. These go inside the existing plan records, with a version bump.
- A per-book "blueprint mode" switch.
- One clean-up of the duplicate review entries. This is only done with your approval.

## 8. Existing books
- Accepted text, the six [2D] books, Standard writing and the 48 writer profiles are untouched.
- Older planned books keep working. They get a "Build blueprint" option, and the strict rules apply only after you approve a blueprint.

## 9. Staged plan
- **Stage 1 (quick win):** fix the cast lookup, remove duplicate review entries (with your OK), and drop "new character entrance" from hooks for planned books.
- **Stage 2:** chapter blueprint plus microbeats in planning, with no word limit on the synopsis. Anyone the plan needs who isn't in the cast yet is added and approved during planning.
- **Stage 3:** the writer gets the blueprint and the instruction "expand the approved story; do not create new story facts". If something essential is missing, writing stops and asks for a plan update.
- **Stage 4:** the pre-acceptance check flags unplanned people, important places and major events. Harmless detail is allowed.
- **Stage 5:** plan changes are versioned and mark affected later chapters. Accepted chapters are never rewritten silently.

Each stage gets free simulated-AI tests from your 12-point list, and the full existing suite must pass.

## Technical details
- Bug: `knowledgeRepo.loadIdentitiesFor` reads only `narrative_identities` (universe/persona level). Book-level `story_characters` / `identity_entities` are ignored, so `planKnowledgeWrites` returns `no_identity` reviews (156 pending for book 7324…, `0:1`). Fix: merge book cast and identity entities into `KnownIdentity[]`, then dedupe reviews by book + name + reason.
- Invention sources: `generate-content/index.ts:185` (hook list), lines 290 and 336 (NEW events mandate); no closed-world rule in `planningContext.ts`.
- Planning: `aiPlanning.ts` Service 3 (chapter: objective/stakes/focus/sections), Service 4 (entry/focus/outcome), Service 5 (beats `{kind, note, weight}`). Extend Service 3/5 with `synopsis`, `cast[]`, `locations[]`, `events[]`, microbeats `{id, text, characterIds, locationId, eventIds, purpose, transition}`, plus a reference/coverage validator (repair limited to 2 rounds).
- Gate: a new material category `unplanned_entity` in `validation.ts`/`evaluator.ts` via `identity.ts` `resolveReference`, routed to `canon_reconciliation_logs` and `book_candidate_drafts`. `identitySync` NEW_ENTITY becomes a finding in blueprint mode.
- Standard prompts stay byte-identical: all prompt changes apply only when `planning_pipeline = "progressive"`.
