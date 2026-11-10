# Roadmap — Closed-world writing

## Character references and whole-book memory — progress
Green checked boxes mean verified complete; orange unchecked boxes mean still open.

| Progress | Work item |
| --- | --- |
| 🟩 [x] | Recover and save the approved character, timeline and paragraph-memory requirements |
| 🟩 [x] | Pure character lock rules: 4–10 tells, exact designed biometrics, five views, re-entry cue counts |
| 🟩 [x] | Pure paragraph/viewpoint parsing, verbatim/order checks, listener/witness index and hash/position filtering |
| 🟩 [x] | Final local regression suite: 68 files / 764 tests passed; preview build OK |
| 🟧 [ ] | Five-view private reference + vision extraction + planned-cast preparation: implemented, needs real image verification |
| 🟧 [ ] | Story memory / character card screen: implemented, needs populated signed-in flow verification |
| 🟧 [ ] | Accepted extraction and writer-memory integration: implemented, needs saved-data end-to-end verification |
| 🟩 [x] | Emergent characters: flagged names → "Add person to plan" → new plan version + cast proposal, same-universe name clash warning |
| 🟩 [x] | Appearance contradictions against locked cards block acceptance; re-entry cue counter wired into draft prompts (per-character counts from accepted past appearances) |
| 🟩 [x] | Section/paragraph chronology: per-paragraph relative/raw anchors, non-linear frames, deterministic clock checks, proportional 4–8 chapter time mix (784 tests) |
| 🟩 [x] | Thread deadlines checked against the scene date (live drafted-section run still unverified) |
| 🟩 [x] | Title + chosen premise locked into every planning step after ideation |
| 🟧 [ ] | Deployment checks and paid image/vision verification (not performed; separate permission needed) |

- [x] Use Astra for initial ideation only; Professional default for writers; saved selections preserved; 733 tests passed; deployed plan-book and signed-in 3/5/7/10 dry-runs verified; no paid AI calls
- [x] Carry selected Book Approach and full details into Master Plan; signed-in live dry-run verified, 721 tests passed, no paid AI or manuscript changes
- [x] Restore Book Ideas in the library and saved-idea selection in book setup; verified signed-in with a temporary draft, no paid AI or manuscript changes
- [x] Stage 1: planned cast counted as known; pending duplicates auto-resolve; no "new character" hooks in planned books
- [x] Stage 2: chapter blueprint + microbeats; proposed people need separate cast approval; blueprints never bulk-approved; required-blueprint gate (opt-in for older progressive books)
- [ ] Stage 2 browser check of blueprint screen with safe test data
- [x] Stage 3: writer gets the section's approved blueprint beats, allowed people/places; missing info is written around, never invented
- [x] Stage 4: pre-acceptance flags repeated names not in blueprint, cast or story memory
- [x] Stage 5: versioned plan amendments (approved blueprint kept until the new version is approved)

- [x] Correct instructional example roles in blueprint approval; live affected blueprint approved and read back READY, 725 tests passed, no paid AI or manuscript changes

- [x] Upfront writer picker in Book Variants (tone-matched, tier, voice in variants)

- [x] Just-in-time chapter blueprints (auto build + approve when writing reaches a chapter; stops only for new named people)
- [x] Book-type drafting model: drama → Sol, all prose → Sonnet 5 (locked premier pipeline)
- [x] Book tone from Book Variants applied to every drafted section via writer lens
- [x] In-progress books switcher in Planning Studio header
- [x] Tone in master plan, chapter, section, beat, blueprint prompts and paragraph rewrites
- [x] Cache-aware cost estimator (cached context discount, no thinking surcharge on checks, optional audit excluded)

## Live test (The Salt Ledger) — open
- [x] Only Sonnet 5 + Sol; Sonnet/Sol toggle; cheapest image model
- [x] Make the 4 missing character pictures
- [x] Write Chapter 1 sections 2–4 on Sonnet 5
- [ ] Save section 4 into story memory (~$0.05; paused at the $0.50 cap)
- [x] Time plan cascade: book timeframe in fiction master plans; 4–8 chapter time refs (40–60% relative / 10–30% raw / 20–40% combined, scattered across sections); section summaries must quote assigned phrases verbatim; blueprint microbeats must carry them; writer brief lists the section's approved refs; 783 tests passed; plan-book + generate-content deployed; signed-in chapter dry-run verified (no AI cost)
- [ ] Generate a new chapter with the time plan live (paid AI — awaiting explicit go-ahead)

- [x] Chapter/section with no stored status renders as Pending instead of crashing the page (ChapterView + BookCard guarded; 777 tests passed; Clockwork Rose loads signed-in)
