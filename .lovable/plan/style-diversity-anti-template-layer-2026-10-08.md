# Style Diversity / Anti-Template Layer

Goal: stop books and writers from falling into repeated opening and phrasing habits. The fix targets patterns, not just individual banned phrases, and does not depend on the model checking itself.

## What the author will notice
- Section openings in a book cycle through different approaches (anecdote, contrarian claim, case study, question, and so on) instead of all starting with "There's a particular kind of..." or a close variant.
- Each writer leans toward the opening approaches that suit them. For example, Claire (finance) favours statistics and problem statements, while fiction writers favour scenes and dialogue.
- Phrases repeated across a book ("The truth is...", "But here's the thing...", "Imagine...", three-item lists, identical endings) get flagged. If an opening matches a template the book has already used, it is automatically rewritten once before acceptance.
- Try Writer samples rotate approaches, so two writers on the same model no longer open the same way.

## Steps
1. **Cache control test (first, no code change to caching).** Run identical Test Voice prompts with Anthropic caching on and off (5 runs each, 2 writers). Record the openings and compare template rates. Step 1 caching stays untouched whatever the result. Report the findings.
2. **Pattern detector (pure, deterministic).** Detects pattern families, not single strings:
   - general-observation openers ("There's a particular/certain kind of", "Some X have a way of", "We've all...", "There's a moment in every", "Few things are more", "One of the most common")
   - stock transitions ("The truth is", "But here's the thing", "Let's take a closer look", "In today's world", "Imagine")
   - repeated three-item lists, rhetorical-question runs, and repeated closing shapes
   - classifies each opening into one of the 15 strategies, or "general_observation"
3. **Opening-strategy planner.** Uses the 15 strategies from the advisor. Selection is deterministic and depends on the book type's allowed set, the writer's preferred set, the section objective, and a ledger of recent strategies (no reuse within the last 3 sections, and no family above roughly 20% of the book). The chosen strategy goes into the per-section prompt, not the cached system prefix.
4. **Per-book rhetorical ledger.** Stores each accepted section's opening strategy, detected pattern families and stock phrases. It is appended only after acceptance and undone when a section is regenerated, matching the extraction model.
5. **Generate → analyze → revise once.** After the draft and before Pass 4, run the detector. If the opening matches a template the book has already used, or misses its assigned strategy badly, make one targeted rewrite of the opening paragraph only, using the writer's own Draft model. If it still matches, accept the text and log a warning. Generation never blocks.
6. **Pass 5 audit check.** Add a read-only "Rhetorical repetition" stage that reports book-wide frequencies (openings, transitions, endings, metaphors, lists). The audit stays audit-only.
7. **Try Writer.** Each sample is assigned a rotating strategy so writers can be compared fairly. Still preview-only.

## Unchanged
Step 1 caching and the static prefix, all 48 locked profiles, the ±2 sliders, Passes 1–5, Phase 2A/2B (not wired in), and Pass 6 (still not authorized). The existing opening guidance stays as the base layer.

## Technical details
- New pure module `_shared/writers/rhetoric.ts`: `detectPatterns(text)`, `classifyOpening(text)`, `planOpeningStrategy({bookType, writerId, objective, ledger})`, and per-type and per-writer strategy tables. It is shared by the browser, the backend and tests.
- New table `rhetorical_ledger` (book_id, section_id, strategy, families jsonb, phrases jsonb, content_hash). Owner read access, service-role writes, RLS and grants, and no anon access. Undo happens on regeneration.
- `generate-content`: injects `OPENING STRATEGY: <x> — <instruction>` into the dynamic tail and adds a post-draft check plus one optional opening rewrite (role `writer`, the same profile slot). Usage is recorded through `_shared/ai`.
- `run-manuscript-audit`: adds a new deterministic stage. Findings use the existing schema.
- Tests: family detection across variants, strategy rotation with no reuse in the window, per-type allowed sets (drama/comic/cookbook format-safe, no invented statistics for finance), ledger idempotency and undo, and verification that the cached prefix stays byte-identical.
- Cost: at most one short extra call per flagged section. This stays unquoted until measured.
