# Closed-World Writing: Every Character Planned Before Prose

## Goal
The writer should carry out the approved story, not invent it. Every named character, important place and major event must exist in the chapter plan before any prose is written. The "Characters to confirm" step goes away, because nothing new should need confirming.

## What the first look found (to confirm in Stage 0)
- The writing instructions say to add a hook every few paragraphs. One allowed hook is a "new character entrance", so the writer is told to invent people.
- Section plans break into short beats (kind + one note), but they have no list of who is present, where it happens, or what events occur. The writer fills those gaps.
- After a section is accepted, story memory reads the prose. Any unknown name becomes a "new entity", which then appears in the review panel in Planning Studio. That is the confirmation step you saw.
- Chapter summaries are short goal statements, not a paragraph-by-paragraph account.

## Stage 0 — Audit report (free, no changes)
A written report covering the 9 questions in your brief: where invented characters come from, how detailed chapter summaries are, where detail is lost, which prompts allow invention, what can be reused, how to remove confirmation safely, data changes, how existing books are handled, and the staged plan. You review it before Stage 1.

## Stage 1 — Chapter Blueprint (planning)
- Each chapter plan gets two forms:
  - **Readable synopsis**: a full account of the chapter, about one sentence per planned paragraph, naming people, places and events. No word limit for this part. Your 300–500 word whole-book summary stays as it is.
  - **Structured blueprint**: cast, places, events, opening state, ending, continuity duties and what may be revealed, each linked to a known story entry.
- Microbeats replace the current thin beats. Each one says who is present, where, what happens, why, and how it leads to the next.
- Anyone the blueprint needs who isn't in the cast yet gets added during planning, and you approve them there. This is the only way a new character enters.
- Check: if a chapter's beats leave gaps, or name someone with no entry, the plan can't be approved.

## Stage 2 — Writer obeys the blueprint
- The writer receives the synopsis plus only that chapter's allowed cast, places and events, with the instruction: "Expand the approved story; do not create new story facts."
- "New character entrance" is removed from the hook list for planned books. Gestures, sensory detail, atmosphere and dialogue wording stay free.
- Secrets and future reveals keep the current protections. Characters who haven't debuted yet are still held back.
- If the plan is missing something essential, writing stops and asks for a plan update. It does not invent.

## Stage 3 — Catch inventions before acceptance
- The pre-acceptance check compares the draft against the blueprint. Names are matched to known characters, nicknames and pronouns, never just to capital letters.
- An unplanned named person, important place or major event is a serious finding. The draft is held for you with three choices: rewrite without it, amend the plan, or accept it as a planning change. Harmless detail is never flagged.
- The "Characters to confirm" panel is removed for planned books. Story memory only links to planned entries; anything unknown is reported as a problem, never quietly added.

## Stage 4 — Plan changes
- Changing a plan creates a new version. Affected beats and later chapters are marked for update, and accepted chapters are never rewritten silently.

## Existing books
- Books already written and the six [2D] books are untouched. Standard writing is unchanged.
- Older planned books keep working. They get a "Build blueprint" button, and the new rules apply only after their blueprint is approved.

## Tests (free, simulated AI only)
All 12 checks from your brief, including: a character can't be invented and then confirmed afterward, nicknames and pronouns resolve correctly, hidden identities stay hidden, harmless detail passes, a plan change can add a character, an old manuscript is unaffected. The full existing suite must still pass. No paid AI calls.

## Technical details
- Extend `book_progressive_plans` content (schema version bump) with `synopsis`, `cast[]`, `locations[]`, `events[]`, and microbeats `{id, objective, text, characterIds, locationId, eventIds, transition}`. All IDs resolve to existing identity entities; no new registry.
- `aiPlanning.ts`: new blueprint service plus parser/validator, with a coverage and reference check and bounded repair of 2 or fewer. `planningContext.ts` / `proseWriterPlanView` pass the blueprint while keeping reveal filtering. `cast.ts` debut gating stays.
- `generate-content` hook rules: drop "new character entrance" only when a progressive plan is in use, so Standard prompts stay byte-identical.
- `validation.ts` / `evaluator.ts`: new material category `unplanned_entity` using the identity resolver (`identity.ts`, aliases, knownNames). Routed to `canon_reconciliation_logs` and held via `book_candidate_drafts`.
- `identitySync.ts`: in blueprint mode, NEW_ENTITY produces a finding, not a proposal. Hide `IdentityReviewPanel` for those books.
- Migration: only new JSON fields and a mode flag. Accepted prose and the 48 profiles are untouched.
