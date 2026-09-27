# Pass 3 — Model/Provider Abstraction, BYOK & Optimized Pipeline

## Current state (inspected)
| Operation | Function | Today |
|---|---|---|
| Prose writing | generate-content | DeepSeek `deepseek-reasoner` (server key) or Lovable AI gateway model from the picker |
| Intro | generate-intro | DeepSeek `deepseek-chat`, fallback gateway `gemini-2.5-pro` |
| Outline | generate-outline | gateway `gemini-2.5-flash` |
| Characters | generate-characters | gateway `gemini-2.5-flash` (+ image model for portraits) |
| Extraction | extract-narrative-state | gateway `gemini-2.5-flash` |
| Rewrite/guided | rewrite-paragraph | gateway `gemini-2.5-pro` |
| Summaries | summarize-content | gateway `gemini-2.5-flash-lite` |
| Covers/images | generate-cover, generate-image | gateway image models (out of scope, unchanged) |

Model choice today lives only in the browser (`localStorage` key) and only affects the writer. Only server-level keys exist (DEEPSEEK_API_KEY, LOVABLE_API_KEY); no per-user keys.

## What gets built

### 1. Shared AI layer (`supabase/functions/_shared/ai/`)
- `registry.ts` — one config table of models: provider, id, display name, supported roles, context/max output (or `unknown`), input/cached/output price per 1M tokens (or `null`), structured-output and reasoning flags. Includes GPT-6 Astra/Sol/Luna, Claude Fable 5.1 / Opus 5.5, DeepSeek Reasoner/Chat, the Gemini models already used.
- `providers/` — one adapter each: `lovableGateway` (default, no user key; Responses API for OpenAI models, Messages for Claude, chat for Gemini), `openai`, `anthropic`, `deepseek`, `gemini`. Each handles URL, auth, request shape, streaming, response/usage extraction, error normalization (keys scrubbed from every message), bounded retry on 429/5xx only. DeepSeek prefix caching stays inside its adapter.
- `roles.ts` — `resolveModelForRole(bookConfig, role)` for planner, writer, narrative_extractor, continuity_checker, editor, difficult_chapter, manuscript_auditor. Supports `optimized` preset, `custom` per-role map, `single` model, and a `legacy` default reproducing today's exact models.
- `client.ts` — `runAI({ role, bookConfig, userId, bookId, messages, stream })`: resolves model → picks credential (user key if the user saved one for that provider, else platform route) → calls adapter → records usage. Explicit fallback only if configured; otherwise a clear error, never a silent swap.
- `usage.ts` — writes one usage row per call; tokens left `null` when the provider doesn't report them; cost computed from the registry only.

### 2. Optimized — Recommended preset
Planner Sol, Writer Sol, Extractor Luna, Continuity (routine) Luna, Editor/serious pass Sol, Difficult chapter Astra, Manuscript audit Astra. Future roles are stored but never executed in Pass 3. Fallbacks are part of the config, not code.

### 3. Database (additive only)
- `book_model_configs` — per book: mode, role→model map, fallback map, updated_at. Owner RLS. Missing row = legacy default, so existing books behave exactly as today.
- `user_provider_keys` — provider, AES-GCM ciphertext + IV, last 4 chars, status, last_tested_at. **No client grants at all**; only the backend reads it. Encryption key is a generated server secret (`BYOK_ENCRYPTION_KEY`), never in the database.
- `ai_usage_records` — user, book, role, provider, model, input/output/cached tokens (nullable), estimated cost (nullable), success, error code, request id, timestamp. Owners read their own; backend writes. No prompts, no keys.

### 4. Backend functions
- New `provider-keys`: list (masked `sk-••••1234` only), save/replace, delete, test (tiny ~5-token request, success/fail only).
- New `model-config`: get/save/restore defaults for a book; returns resolved role map and a cost estimate for outline/chapter/audit from the registry.
- Migrate generate-content, generate-intro, generate-outline, generate-characters (text part), extract-narrative-state, rewrite-paragraph, summarize-content to `runAI`. Pass 2 story memory injection and post-section extraction are left untouched; prompts unchanged.

### 5. Settings UI
- Replace the current "AI Writing Model" card in book settings with: mode choice (Optimized — Recommended / Single model / Custom), per-role dropdowns showing "Provider · Model", "Not active yet" tag on future roles, optional fallback, Save and Restore defaults, estimated cost line.
- New "API Keys" section (user menu → settings): four providers, status, masked key, Add/Replace, Remove, Test connection. Keys are write-only from the browser.
- The old browser-stored model choice is migrated once into the book config, then no longer used.

### 6. Tests and verification
- Vitest for all 22 listed cases (registry, adapters, resolver, preset, legacy DeepSeek/Gemini defaults, missing/invalid key errors, key isolation, masking, log scrubbing, usage rows, null-token honesty, pricing, pipeline wiring for Guided/Assisted/Semi-Auto/Auto Draft).
- Typecheck, production build, then a controlled real run on a new throwaway test book: custom selection, preset resolution, one key test, one generation through the layer, story memory present, extraction ran, usage row written, no key in any response or log.
- Final report in the requested 15-point format ending with the PASS 3 STATUS line. Pass 4 not started.

## Technical notes
- Per-user key storage uses app-level AES-GCM in the backend because the platform secret store is project-wide, not per-user; this meets the "encrypted server-side" requirement. If you'd prefer I stop instead, say so before approving.
- Using the built-in route for GPT-6 and Claude models draws on workspace credits; Claude models are allowed under the current retention policy.
- The 19 older security warnings stay untouched.
