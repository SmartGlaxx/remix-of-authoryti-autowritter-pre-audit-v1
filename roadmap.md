# Roadmap — Pass 5 final acceptance
- [x] Share book-type-aware anti-throat-clearing opening guidance across writing, intro and Try Writer prompts.
- [x] Phase 2A: pure adaptive context engine and five configurable book-type profiles; run 10,000-word synthetic benchmark. Not connected to live generation; 
- [x] Phase 2B: pure identity & artifact integrity (evidence-based resolution, six-way classification, severity gate, versioned/reversible commits) + 15 acceptance scenarios. Not wired to live generation; 2C/2D await approval.
- [x] Step 1 UI walkthrough (browser)
- [x] Step 2 30k+ manuscript soak (existing 46,896-word book, no generation)
- [x] Step 3 Severity calibration + cross-stage dedup
- [~] Step 4 BYOK live run — OpenAI/Anthropic/DeepSeek keys work; Google key rejected (404) — user to replace it, then re-run audit
- [ ] Pass 5 Final Acceptance Report (draft written; finalize after Step 4)

# Next
- [x] Show genre when choosing a book type, with choices for that type
- [x] Rework Try Writer page and preview dialog: four modes/models on left, premise center, 15 values right, writer arrows
- [x] API keys moved to app-level Settings (user menu → Settings & API Keys)
- [x] Writer Personas (12 built-in writers, portraits, pick at creation, change in Book Settings)
- [ ] Custom writer creator — deferred by user (later)

# Writer Persona Engine (corrected spec)
- [x] 15-slider Expression Control Layer (shared module, creation UI, Book Settings, prompts)
- [x] Story Divergence: Strict / Controlled / Open (separate from sliders; legacy boolean mapped)
- [x] ±2 bound utility (boundToBaseline)
- [x] 15-slider baselines for 12 writers (±2 enforced server-side, Try Writer, Book Settings)
- [x] 48 fixed model profiles (IDs validated vs live catalogs; Sonnet 5.5→claude-sonnet-5, Haiku→claude-haiku-4-5, Gemini 3.1 Pro→gemini-3.1-pro-preview)
- [x] Book Voice Manifest (all 15 values; baselines filled when matrix arrives)
- [ ] Custom writers (same 15 sliders, ±2, cap 20)
- [x] provider_pricing_cache — signed-in read only, 24h refresh from gateway catalog
- [x] DeepSeek prices read from the official pricing page (peak rate), refreshed every 24h + manual
- [x] Thinking settings sent to all 4 providers — live-tested (OpenAI, Claude Opus adaptive + Haiku extended, Gemini, DeepSeek on/off)
- [x] Try a Writer page (/writers): writer, tier, locked models, 15 sliders, sample — saves nothing
- [x] New-book sliders limited to writer baseline ±2 in the UI
- [x] Whole-book cost by Draft/Revision/Continuity/Audit, per 1,000 words, with price source + date
- [x] Book Ideas generator (+ → Get book ideas; OpenAI only; accept/adjust modal; sliders ±2, models locked)
- [x] Fix: Claude rejects temperature (Test voice error)
- [x] Saved book ideas: quick list, select & save (full setup made only on save), Saved tab, remove, open → start book

- [x] Style Diversity layer: pattern families, opening planner, audit check, Try Writer rotation
- [ ] Cache on/off opening test (needs approved spend on your Claude key)
- [ ] Revise-once opening rewrite (streaming writer; needs design)

# Phase 2D
- [x] A/B memory switch (Standard vs Adaptive) in Book Settings, per-section measurements saved
- [x] First controlled runs: fiction, self-help, technical, earlier-section rewrite (both modes)
- [x] Separate ids for different full names sharing a first name; merges go to review
- [x] REPLACED — DO NOT USE tag in technical context + continuity guard for legacy names
- [x] Live technical chapter retest (DeepSeek Flash + GPT-6 Luna, Daniel/Balanced) — passed
- [x] 30k base novel built (32,951 words, DeepSeek Flash + GPT-6 Luna)
- [x] Fix: Standard mode kept only the last sentence of earlier text once a book passed ~100k characters
- [x] Deployed dry run (free): live build has all fixes, correct chapter position, Standard keeps ~100k chars of earlier prose
- [ ] Paid 30k A/B on [2D-V …] copies — waiting on author approval
- [x] Adaptive gates author-listed cast by planned first appearance
- [x] Standard mode sends the author's cast list before extraction (gated by first appearance)
- [ ] Name-only mention counts as a debut (Old Vey eligible from Ch2.3 because "Tomas Vey" is named there) — author decision
- [ ] Story-memory step sometimes hits the CPU limit on long books (2 of 45 sections; retry worked)
- [x] Identity commits from accepted text (skips uncertain names)
- [x] Different full names sharing a first name are separate people
- [x] Fix: writer profiles could not be saved (database rejected mode "profile")
- [x] Fix: browser always sent chapter 1 position to story memory (absoluteChapterIndex)
- [x] Fix: extraction now records artifacts/frameworks/definitions and "replaces" wording
- [ ] Place names like "Harbor office" vs "Harbor Office" held back as possible duplicates (case/wording variants) — review

## First-appearance setting (done 2026-10-09)
- CharacterReference.firstAppearance added; editable in ChapterView character detail (Auto = first mention).
- cast.ts already honored it; 4 new tests (Tomas Vey mention-vs-appearance case); 267 tests pass.
- Dry-run on live build (free): absChapter correct (9 and 1); Standard Ch2.5 retains 99,960 chars earlier prose; Petr Saul absent from both modes at Ch2.5, present at Ch10 (established); Adaptive context ~3,000 words vs Standard ~100k chars.

## Paid 30k A/B comparison (approved, ready to start)
- Books: [2D-V standard/adaptive] full copies; same manuscript, Daniel/Balanced, matched tasks.
- Record: context words, raw+cached input tokens, output tokens, provider cost, latency, retries, continuity outcomes, identity errors per matched section.
- Report continuity/identity separately from cost (manuscript uses Ruth et al. vs outline Mara — known mismatch).

# Progressive planning
- [x] Phase B: plan tables, immutability triggers, acceptance/extraction tracking, lifecycle tests
- [x] Phase B completion (0005): generation leases + fencing, exact-detail anchors, reconciliation logs; 14 unit + 28 live checks
- [x] Phase C: universal planning engine + 8 genre adapters (pure, not wired); 27 tests, 315 total
- [x] Phase D: AI planning services (alternatives 3/5/7/10, master, chapters, sections, beats), true-story planner, repair + checkpoints, owner approvals — built, not wired to writing
- [x] Phase E — planning-aware context assembly (pure, not wired)
- [x] Phase F — wire into generation with Phase B leases, anchors, reconciliation
- [ ] Before new workflow goes live: wire leases/fencing, anchors, reconciliation gate (blockingDiscrepancies) into generation

- [x] Phase F: opt-in progressive pipeline (gate, lease/fence commit, plan-aware Standard+Adaptive, actionable foreshadowing, exact-anchor enforcement, contradiction gate, staged acceptance) — 355 tests, free live preview verified
- [x] Phase F safeguards: lease heartbeat + fenced revisions, PLAN_REQUIRED in progressive mode, durable extraction-failure recovery — 365 tests
- [x] Phase G — Unified Validation (configurable vocab, contextual repetition, editorial vs canon routing, author-approved broad rewrites, validate-before-accept) — 385 tests
- [x] Phase G runtime completion + Phase H workflow (Planning Studio, held drafts, deferred canon activation, memory flagging) — 400 tests
- [x] Phase I zero-cost step: progressive-only opening diversity, configured-only bans, genre rubrics (advisory), timeout/no-duplicate guard — 408 tests
- [ ] Phase I Scale 2 — single paid section on a test copy (awaits approval)
- [ ] Controlled paid test of plan + prose quality on a [2D-V] copy (awaiting approval)
- [x] Browser UI for opt-in toggle and contradiction decisions (Planning Studio); a one-click 'regenerate accepted section' button is still not built

## Persona Studio
- [x] Phase 1: stable identities, pen names, universes, relationships, chronology engine, temporal knowledge, narrative vantage setting, tests
- [ ] Phase 2: Persona Studio UI + identity resolution (awaiting approval)
- [ ] Book Setup story options → narrator → character resolution (awaiting approval)
- [ ] Wire chronology/knowledge checks into pre-acceptance validation (awaiting approval)
- [ ] Comic-book & magazine layouts, then consolidated Phase I paid testing (postponed)

- [x] Phase 2: Persona Studio, pen names, universes, promotion, relationships, server identity resolution, AI contract (mock)
- [ ] Phase 2: live security run of server-side checks (waits on function deployment)
- [ ] Phase 3: chronology + knowledge into extraction and pre-acceptance validation

# Phase 4 — Book Setup & Persona Integration
- [x] Setup tab: story alternatives (3/5/7/10, regenerate one, skip, must-keep details), twists on/off with approve/edit/reveal chapter, cast (library, book-only, save to library with duplicate check, suggestions), POV/narrator/vantage/persona-led, single/multiple viewpoints, universe, pen name, save & resume, locks after writing
- [x] Setup feeds the existing master planner (no second pipeline)
- [x] Characters-to-confirm review in Planning Studio
- [x] 33 Phase 4 tests (504 total)
- [ ] Live security checks against the new planning service — blocked until the updated service finishes deploying

- [x] Phase 4 fail-closed AI test mode + deployment handshake (506/506 tests)
- [x] Viewpoints may share a chapter in separate sections
- [ ] Phase 4 live checks (`/tmp/sec/p4v.py`, 14 checks) — blocked until the updated planning service is deployed; handshake still reports the old build
- [ ] Later: consolidate the Plan tab's older story-options box with the Setup tab (both call the same `alternatives` service; keep both until then)

# Unified creation flow
- [x] Surprise me idea button
- [x] Visible/editable chapter + section summaries
- [x] New Book → Planning Studio → Start writing
- [x] Writer & settings / Personas links in Planning Studio
- [ ] Flexible summary lengths (150–700) + series mode in planner prompts
- [ ] Retire old Plan-tab concept box / CreateBookEngine duplication

## Single creation flow
- [x] Elastic summary lengths by book type; series mode (450–700 words per book)
- [x] Old story-options box removed from Plan tab (Setup is the one place to choose a story)
- [x] "Open in Planning Studio" in each book's menu; "Change setup & rewrite the book"
- [x] Approving the whole-book summary goes straight on to chapter/section summaries

# Phase 5
- [x] Stage A: Scene plan panel, inline held-draft review (save edit before checks, full fenced acceptance), plan cards + Start writing handoff
- [x] Stage A: click-through of setup reopen + writing-desk Plan tab (fixed crash on books with an incomplete plan)
- [x] Stage B: Plan tab follows scene chronology
- [ ] Stage B: held-draft card click-through, temp-book setup→plan→write→accept→memory run with mocks, shared-universe cross-book check
- [ ] Stage C: full regression, live checks, deployment check
