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
- [ ] Long-book runs (30k+ words) to measure savings; technical name-drift check
- [x] Identity commits from accepted text (skips uncertain names)
- [ ] Same-surname/first-name people (e.g. two Johns) held back as possible duplicates — decide whether full names should count as distinct
