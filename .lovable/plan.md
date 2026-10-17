# Fix the change measurement (no paid AI calls)

## What is wrong
The app has two "how much changed?" measures, and both overcount:

1. **Naturalness rewriting** counts everything from the first edit to the last edit. Two tiny fixes at opposite ends of a section count as about 97.5% changed. This is why both GPT-6 Sol revisions in the paid test were rejected.
2. **Continuity repairs and held-draft acceptance** count any paragraph that changed at all as 100% changed. Changing one word in each of 3 paragraphs out of 7 reads as about 43% changed. This likely explains earlier held drafts, such as the one reported as 44%.

## What we will build
One shared word-level comparison that counts only the words actually added, removed or replaced, measured against the original draft. Both features will use it.

- Unchanged text between separate edits never counts.
- The comparison is always against the original. Two rewrite attempts can't each use 20% and together pass 40%.
- Moving a passage counts as removing it and adding it again, so reordering can't slip through as "small".
- The 20% limit itself stays the same. Every other safeguard stays as is: at most two rewrite attempts; protected dialogue, names, dates and numbers; full continuity checks; no automatic changes to accepted prose; no skipping fenced acceptance.

## Tests (free)
Small edits at opposite ends of a long section; many small edits spread through a section; one large block rewrite over 20%; insertions; deletions; a reordered passage; changes adding up across two attempts; edits to protected content (still refused); an unchanged candidate (0%). Plus the full regression suite.

## The two rejected Sol revisions
The test saved only how many edits each revision had (12 and 11), not their wording. Their percentages can't be recalculated without asking GPT-6 Sol again, which costs money. From now on the experiment will save every proposed edit and the resulting text, so this information is never lost again.

The report will include texts A and B (already saved) and the corrected rejection reasons. It will say plainly that the two old revisions can't be re-scored.

## Rollout
Run all free tests, then update the naturalness rewrite, held-draft review, story-writing and continuity-check services. Make no paid calls and don't re-run the experiment until you approve.

## Authorization for the $0.031 already spent
I ran it because of your message "run the $0.10 test". That followed my report asking you to reply with exactly that phrase. No other paid run has happened since.

## Technical details
- New pure `_shared/writers/textDiff.ts`: tokenize words and punctuation (layout and whitespace ignored); LCS / Myers diff; ratio = (deleted + inserted tokens) / (2 × original tokens), capped at 1. Pure and deterministic; size guard for very long inputs (fall back to paragraph-anchored diff).
- `naturalnessRewrite.charChangeRatio` and `validation.revisionChangeRatio` both use it. `runNaturalnessRewrite` already compares against the original `draft`; add a test proving it.
- `abExperiment` report gains `proposals[]` (raw model edits, applied text, ratio, rejection reason).
- Redeploy `generate-content`, `candidate-review`, `check-continuity`, `naturalness-experiment`. Update AGENTS.md (one rule).
