# Stage D — Continuous Writer Learning (plan, not built)

## Stage C live verification (done)
- Updated writing services deployed. Free live checks on a temporary book, deleted afterwards:
  - Someone who isn't signed in is refused (401).
  - A book set to the old "advise" setting is treated as Analyze Only.
  - Held-draft rewrite request in test mode: no paid AI reached, draft unchanged, no new version, nothing accepted.
  - Unknown or closed drafts are refused (409).
- 585/585 free tests pass. Live mode separation during real writing would need a paid generation, so the free tests cover it.

## What Stage D adds
1. **Recurring weakness tracker** — rolls up advisory findings per section, chapter, book and writer. A weakness counts as "recurring" only after it shows up in at least 3 sections across at least 2 chapters. One-off flags never become rules.
2. **Learning signals** — only two kinds count:
   - corrections the author approved (an edit saved and then accepted, or a held-draft rewrite that was accepted);
   - proven improvements (a rewrite that passed full checks and lowered the naturalness score).
   Rejected, discarded or reverted changes count as negative evidence.
3. **Recommendations** — per writer and genre, e.g. "Sophia + literary: opening-pattern repeats in 4 of 9 sections; tested fix: vary the first beat". Each one shows its evidence count and confidence.
4. **Sharing a technique with another writer** — a proven technique can be suggested to a compatible writer (same family/genre fit). It's re-expressed through that writer's own voice and slider limits, and is never a copy of the source writer's text.
5. **Reversible versioned overlays** — approved improvements are stored as new versions on top of a writer. Base profiles and the 15 slider limits are never touched, and any overlay that would push past a slider limit is cut back to fit.
6. **Author approval** — recommendations stay "proposed" until the author approves them. Only "active" overlays reach future writing, and only in the changing tail of the writing instructions, so prompt caching stays intact.
7. **Book-level pinning** — each book records which overlay versions it writes with. Approving a new version doesn't change existing books unless the author opts in.
8. **Per-user isolation** — all learning data belongs to its owner; there is no learning across users.
9. **Reliability gates** — signals from AI detectors or heuristics are marked low-weight and can never create a recommendation on their own. A recommendation needs repeat evidence plus at least one author-approved or proven signal. Automatic expiry follows if later evidence contradicts it.
10. **Author DNA Studio compatibility** — overlays use a neutral `dimension + adjustment` format with a schema version, owned by the user (optionally by writer or book), so a future Author DNA profile can use the same records.

## Safeguards
- No paid AI calls: learning is deterministic and works from stored findings and outcomes.
- No changes to accepted manuscripts or Standard writing. Naturalness modes Off and Analyze Only never apply overlays.
- No Stage E interface. Everything is exposed only through owner-only backend actions.

## Technical details
- Pure module `_shared/writers/learning.ts`: `aggregateWeaknesses`, `scoreSignals`, `proposeRecommendations`, `transferTechnique`, `clampOverlayToSliders`, `renderActiveOverlays`.
- Database migration (additive, owner-scoped, read-only to owners, written by the server only):
  - `writer_learning_signals` (user, writer, book, category, kind, weight, source ref, content hash; one row per source);
  - extend `writer_style_adaptations` with `schema_version`, `evidence` (jsonb), `confidence`, `scope` (writer|writer_genre|transfer), `source_writer_id`, `expires_at`, `proposed`→`active`→`reverted` lifecycle trigger (active content frozen; changes create new version);
  - `books.controls.adaptationPins` (writer overlay version ids).
- Signals recorded after `commit_candidate_draft` / `commit_fenced_section` (best-effort, never blocks acceptance) and on discard/revert.
- Owner-only actions on a new `writer-learning` function: `recommendations`, `approve`, `revert`, `pin`. Any approve/revert creates a new version.
- `generate-content` renders active, pinned overlays into the dynamic tail, only in `analyze_and_rewrite` mode.
- Zero-cost tests: thresholds, false-positive rejection, detector-only rejection, slider clamping, base-profile immutability, isolation, pinning, transfer keeps the target voice, and full regression.
