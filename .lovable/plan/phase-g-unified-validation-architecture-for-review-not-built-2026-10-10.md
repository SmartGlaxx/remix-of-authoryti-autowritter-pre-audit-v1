# Phase G — Unified Validation (architecture for review, not built)

## Goal
One validation stage between "prose drafted" and "prose accepted" for progressive books. It replaces the scattered checks with one ordered pass and one decision: accept, auto-revise, or ask the author. Books without Progressive Planning keep today's Pass 4 flow unchanged.

## Order of checks (cheapest and most certain first)
1. **Deterministic checks (free, no AI)** — required exact details (anchors), replaced-name reuse, spoiler leak of future secrets, forbidden words ("magic"), markdown, meta-labels, debut gating (a character appearing before their planned first appearance).
2. **Plan fulfillment (AI checker)** — did the section achieve its section goal and planned beats; were setup directives shown without explanation; no premature reveal; no events that belong to later sections.
3. **Canon consistency (existing Pass 4 checker)** — contradictions with established story memory, timeline, character state, identity.
4. **Factual integrity (nonfiction / narrative nonfiction only)** — claims match the plan's evidence tier; nothing presented as documented without a source; no invented biographical facts.
5. **Writing quality** — repetition (4+ word repeats, repeated similes), opening-strategy reuse, throat-clearing, pacing against the beat plan (rushed or stalled), voice drift from the writer persona.

## One finding format
Every check emits the same record: check, severity (minor / moderate / material), confidence, excerpt, evidence, suggested fix, repairable yes/no. Findings are stored append-only per section and content version.

## Triage — minor vs material
- **Minor or moderate and repairable** → bounded targeted revision.
- **Material** (canon contradiction, required detail still wrong, spoiler leak, plan goal missed, unsupported factual claim) → author decision through the existing reconciliation log. Blocks only later sections, never the accepted text.
- **Warnings and ambiguity** → recorded, never block, never trigger revision.

## Bounded revision loop
- One combined revision prompt per round covering all repairable findings, smallest possible edits.
- Maximum 2 rounds. A revision that changes too much text, introduces a new material finding, or breaks a required detail is discarded.
- After each round only the failed checks are re-run (deterministic ones always).
- All writes go through the fenced save path with heartbeat-renewed leases.

## Acceptance
Accept only when no material finding remains undecided. Then staged acceptance and memory sync exactly as Phase F (extraction must succeed before the next section).

## Cost controls
- Deterministic checks run first and skip AI checks when they already force a revision.
- Plan fulfillment and canon checks share one AI call where the model supports structured output.
- Quality checks run on cheaper checker models from the existing profile role map; no new models or providers.
- Per-section validation cost logged next to writing cost.

## Testing
- Pure triage, loop and scoring logic with fixed findings (no AI).
- One test per rule: material vs minor routing, 2-round limit, over-rewrite rejection, spoiler leak always material, warnings never block.
- Live quality evaluation only in the approved paid test.

## Out of scope
No UI in Phase G beyond what exists; no change to Standard (non-progressive) books; no paid runs without approval.
