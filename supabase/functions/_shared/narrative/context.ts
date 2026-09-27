// Deterministic, point-in-time-safe narrative context builder (pure, no I/O).
// Given all narrative rows for a book and the position about to be written,
// it selects only what was true strictly BEFORE that position and renders a
// compact, structured block for the writer prompt.
import { AUTHORITY_RANK, toPosition, type Authority, type StoryPosition } from "./rules.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export interface NarrativeRows {
  characters: Row[];      // story_characters
  states: Row[];          // character_states
  events: Row[];          // narrative_events
  participants: Row[];    // event_participants
  threads: Row[];         // plot_threads
  threadEvents: Row[];    // plot_thread_events
  facts: Row[];           // canonical_facts
  timeline: Row[];        // story_timeline
  entities: Row[];        // story_entities
  snapshots: Row[];       // story_state_snapshots
}

export interface OutlineCharacter { id?: string; name?: string; role?: string; description?: string; personality?: string; appearance?: string }

export interface MergedCharacterState {
  location: string | null; physical: string | null; emotional: string | null;
  goals: string[]; motivations: string | null; knowledge: string[]; secrets: string[];
  beliefs: Record<string, unknown>; relationships: Record<string, unknown>; inventory: string[];
  lastChange: string | null; asOf: StoryPosition | null;
}

export interface SelectedNarrativeState {
  position: StoryPosition;
  characters: { id: string; name: string; role: string | null; baseline: OutlineCharacter | null; state: MergedCharacterState | null }[];
  activeThreads: { id: string; title: string; description: string | null; setupPromise: string | null; requiredResolution: string | null; status: "OPEN" | "DEVELOPING"; importance: string; clues: string[]; developments: string[]; characters: string[] }[];
  facts: Row[];
  disputedFacts: Row[];
  recentEvents: { title: string; summary: string; location: string | null; participants: string[]; causes: string[]; consequences: string[]; revealed: string[]; pos: StoryPosition }[];
  earlierEvents: { title: string; summary: string; pos: StoryPosition }[];
  timeline: Row | null;
  entities: Row[];
  snapshot: Row | null;
}

const LIMITS = { recentEvents: 6, earlierEvents: 6, facts: 40, disputed: 10, entities: 15, characters: 12, maxChars: 9000 };

const posOf = (ch: unknown, sub: unknown): number | null =>
  typeof ch === "number" ? toPosition({ chapterIndex: ch, subsectionIndex: typeof sub === "number" ? sub : 0 }) : null;
const fromPos = (p: number): StoryPosition => ({ chapterIndex: Math.floor(p / 10000), subsectionIndex: p % 10000 });
const rowPos = (r: Row): number | null => (typeof r.position === "number" ? r.position : posOf(r.chapter_index, r.subsection_index));
const nonEmpty = (a: unknown): a is unknown[] => Array.isArray(a) && a.length > 0;
const uniq = (a: string[]) => Array.from(new Set(a.filter((s) => typeof s === "string" && s.trim())));

/** Merge sparse state records (ordered oldest → newest). Unknown stays unknown. */
export function mergeCharacterStates(states: Row[]): MergedCharacterState | null {
  if (!states.length) return null;
  const m: MergedCharacterState = { location: null, physical: null, emotional: null, goals: [], motivations: null, knowledge: [], secrets: [], beliefs: {}, relationships: {}, inventory: [], lastChange: null, asOf: null };
  for (const s of states) {
    if (s.location_text) m.location = s.location_text;
    if (s.physical_condition) m.physical = s.physical_condition;
    if (s.emotional_state) m.emotional = s.emotional_state;
    if (nonEmpty(s.current_goals)) m.goals = s.current_goals;
    if (s.current_motivations) m.motivations = s.current_motivations;
    if (nonEmpty(s.knowledge)) m.knowledge = uniq([...m.knowledge, ...s.knowledge]);
    if (nonEmpty(s.secrets_known)) m.secrets = uniq([...m.secrets, ...s.secrets_known]);
    if (s.beliefs && typeof s.beliefs === "object") m.beliefs = { ...m.beliefs, ...s.beliefs };
    if (s.relationships && typeof s.relationships === "object") m.relationships = { ...m.relationships, ...s.relationships };
    if (nonEmpty(s.inventory)) m.inventory = s.inventory;
    if (s.key_changes) m.lastChange = s.key_changes;
    const p = rowPos(s);
    if (p != null) m.asOf = fromPos(p);
  }
  return m;
}

/** Position at which a closed thread closed; null = unknown. */
function closurePosition(t: Row, eventPos: Map<string, number>): number | null {
  if (t.resolution_event_id && eventPos.has(t.resolution_event_id)) return eventPos.get(t.resolution_event_id)!;
  if (typeof t.resolved_chapter_index === "number") {
    // Unknown subsection → conservatively treat as the end of that chapter.
    return toPosition({ chapterIndex: t.resolved_chapter_index, subsectionIndex: 9999 });
  }
  return null;
}

export function selectNarrativeState(rows: NarrativeRows, position: StoryPosition, outlineCharacters: OutlineCharacter[] = []): SelectedNarrativeState {
  const p = toPosition(position);
  const before = (x: number | null) => x == null || x < p; // strictly before current position

  const charName = new Map<string, string>(rows.characters.map((c) => [c.id, c.name]));
  const eventPos = new Map<string, number>();
  for (const e of rows.events) { const ep = rowPos(e); if (ep != null) eventPos.set(e.id, ep); }

  // Events strictly before p (never future, never a prior attempt at this same section)
  const pastEvents = rows.events
    .filter((e) => e.is_canonical !== false && (rowPos(e) ?? Infinity) < p)
    .sort((a, b) => (rowPos(a)! - rowPos(b)!) || (Number(a.chronological_order ?? 0) - Number(b.chronological_order ?? 0)));
  const pastEventIds = new Set(pastEvents.map((e) => e.id));
  const participantsOf = (id: string) => rows.participants.filter((x) => x.event_id === id).map((x) => charName.get(x.character_id)).filter(Boolean) as string[];

  // Characters: baseline profile + merged temporal state before p
  const characters = rows.characters.filter((c) => c.is_active !== false).map((c) => {
    const states = rows.states
      .filter((s) => s.character_id === c.id && (rowPos(s) ?? Infinity) < p)
      .filter((s) => {
        // among versions at the same position keep only the current one
        const samePos = rows.states.filter((o) => o.character_id === c.id && rowPos(o) === rowPos(s));
        return samePos.length === 1 || s.is_current === true;
      })
      .sort((a, b) => (rowPos(a)! - rowPos(b)!) || ((a.version ?? 1) - (b.version ?? 1)));
    const baseline = outlineCharacters.find((o) => (c.source_key && o.id === c.source_key) || (o.name && o.name === c.name)) ?? null;
    return { id: c.id, name: c.name, role: c.role ?? null, baseline, state: mergeCharacterStates(states) };
  });
  // Characters with state or recent participation first
  const recentParticipantIds = new Set(rows.participants.filter((x) => pastEventIds.has(x.event_id)).map((x) => x.character_id));
  characters.sort((a, b) => Number(!!b.state || recentParticipantIds.has(b.id)) - Number(!!a.state || recentParticipantIds.has(a.id)));

  // Threads active at p
  const activeThreads: SelectedNarrativeState["activeThreads"] = [];
  for (const t of rows.threads) {
    const introduced = posOf(t.introduced_chapter_index, t.introduced_subsection_index);
    if (!before(introduced)) continue; // introduced in the future
    if (t.status === "RESOLVED" || t.status === "ABANDONED" || t.status === "SUPERSEDED") {
      const closed = closurePosition(t, eventPos);
      if (closed == null || closed < p) continue; // already closed (or closure time unknown) → not active
      // closed in the future → present as still open, without resolution details
    }
    const links = rows.threadEvents.filter((l) => l.thread_id === t.id && pastEventIds.has(l.event_id) && l.relation !== "resolves");
    const ev = (id: string) => pastEvents.find((e) => e.id === id);
    const clues = links.filter((l) => l.relation === "clue").map((l) => ev(l.event_id)?.summary).filter(Boolean) as string[];
    const developments = links.filter((l) => l.relation !== "clue").map((l) => ev(l.event_id)?.title).filter(Boolean) as string[];
    const chars = uniq(links.flatMap((l) => participantsOf(l.event_id)));
    activeThreads.push({
      id: t.id, title: t.title, description: t.description ?? null, setupPromise: t.setup_promise ?? null,
      requiredResolution: t.required_resolution ?? null, importance: t.importance ?? "major",
      status: links.length ? "DEVELOPING" : "OPEN", clues: clues.slice(-5), developments: developments.slice(-4), characters: chars,
    });
  }
  activeThreads.sort((a, b) => Number(b.importance === "major") - Number(a.importance === "major"));

  // Facts known before p
  const factsBefore = rows.facts.filter((f) => before(posOf(f.source_chapter_index, f.source_subsection_index)));
  const byAuthority = (a: Row, b: Row) => (AUTHORITY_RANK[b.authority as Authority] ?? 0) - (AUTHORITY_RANK[a.authority as Authority] ?? 0);
  const facts = factsBefore.filter((f) => f.is_canonical === true && f.conflict_status === "clean").sort(byAuthority);
  const disputedFacts = factsBefore.filter((f) => f.conflict_status === "disputed").sort(byAuthority);

  // Events: most recent detailed + important earlier ones linked to active threads
  const recent = pastEvents.slice(-LIMITS.recentEvents);
  const recentIds = new Set(recent.map((e) => e.id));
  const activeIds = new Set(activeThreads.map((t) => t.id));
  const linkedEarlier = new Set(rows.threadEvents.filter((l) => activeIds.has(l.thread_id)).map((l) => l.event_id));
  const earlier = pastEvents.filter((e) => !recentIds.has(e.id) && linkedEarlier.has(e.id)).slice(-LIMITS.earlierEvents);

  const timeline = rows.timeline
    .filter((t) => { const tp = posOf(t.chapter_index, t.subsection_index); return tp != null && tp < p; })
    .sort((a, b) => Number(a.relative_order) - Number(b.relative_order)).slice(-1)[0] ?? null;

  const entities = rows.entities
    .filter((e) => e.is_active !== false && before(posOf(e.first_chapter_index, e.first_subsection_index)))
    .slice(0, LIMITS.entities);

  const snapshot = rows.snapshots
    .filter((s) => (posOf(s.chapter_index, s.subsection_index) ?? Infinity) < p)
    .sort((a, b) => posOf(a.chapter_index, a.subsection_index)! - posOf(b.chapter_index, b.subsection_index)!).slice(-1)[0] ?? null;

  return {
    position,
    characters: characters.slice(0, LIMITS.characters),
    activeThreads,
    facts: facts.slice(0, LIMITS.facts),
    disputedFacts: disputedFacts.slice(0, LIMITS.disputed),
    recentEvents: recent.map((e) => ({
      title: e.title, summary: e.summary, location: e.location_text ?? null, participants: participantsOf(e.id),
      causes: e.causes ?? [], consequences: e.consequences ?? [], revealed: e.information_revealed ?? [], pos: fromPos(rowPos(e)!),
    })),
    earlierEvents: earlier.map((e) => ({ title: e.title, summary: e.summary, pos: fromPos(rowPos(e)!) })),
    timeline, entities, snapshot,
  };
}

const at = (p: StoryPosition) => `Ch${p.chapterIndex + 1}.${p.subsectionIndex + 1}`;
const list = (a: string[]) => a.filter(Boolean).join("; ");

/** Renders the selected state. Returns "" when there is nothing useful (prompt stays unchanged). */
export function renderNarrativeContext(s: SelectedNarrativeState): string {
  const out: string[] = [];
  const chars = s.characters.filter((c) => c.state || c.baseline);
  if (chars.length) {
    out.push("CHARACTERS (baseline identity | state as of the latest recorded point; unknown = not yet established):");
    for (const c of chars) {
      const b = c.baseline;
      const base = [c.role || b?.role, b?.description || b?.personality].filter(Boolean).join(" — ");
      out.push(`- ${c.name}${base ? `: ${base.slice(0, 200)}` : ""}`);
      const st = c.state;
      if (st) {
        const parts = [
          st.location && `location: ${st.location}`, st.physical && `physical: ${st.physical}`,
          st.emotional && `emotional: ${st.emotional}`, st.goals.length && `goals: ${list(st.goals)}`,
          st.motivations && `motivation: ${st.motivations}`, st.knowledge.length && `knows: ${list(st.knowledge.slice(-6))}`,
          st.secrets.length && `secrets known: ${list(st.secrets.slice(-4))}`, st.inventory.length && `carrying: ${list(st.inventory)}`,
          Object.keys(st.relationships).length && `relationships: ${Object.entries(st.relationships).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ")}`,
        ].filter(Boolean);
        if (parts.length) out.push(`  current (as of ${st.asOf ? at(st.asOf) : "?"}): ${parts.join(" | ")}`);
      }
    }
  }
  if (s.activeThreads.length) {
    out.push("", "OPEN PLOT THREADS (unresolved promises — keep them alive; do not resolve without clear cause):");
    for (const t of s.activeThreads) {
      out.push(`- [${t.status}] ${t.title}${t.description ? ` — ${t.description}` : ""}`);
      if (t.setupPromise && t.setupPromise !== t.title) out.push(`  promise: ${t.setupPromise}`);
      if (t.requiredResolution) out.push(`  must eventually: ${t.requiredResolution}`);
      if (t.clues.length) out.push(`  clues so far: ${list(t.clues)}`);
      if (t.developments.length) out.push(`  developments: ${list(t.developments)}`);
      if (t.characters.length) out.push(`  involves: ${t.characters.join(", ")}`);
    }
  }
  if (s.facts.length) {
    out.push("", "ESTABLISHED FACTS (canon — do not contradict):");
    for (const f of s.facts) out.push(`- ${f.subject} ${f.predicate}: ${f.value}`);
  }
  if (s.disputedFacts.length) {
    out.push("", "DISPUTED — NOT CANON (conflicting claims; do not state either version as established truth):");
    for (const f of s.disputedFacts) out.push(`- (disputed) ${f.subject} ${f.predicate}: ${f.value}`);
  }
  if (s.earlierEvents.length) {
    out.push("", "IMPORTANT EARLIER EVENTS:");
    for (const e of s.earlierEvents) out.push(`- ${at(e.pos)} ${e.title}: ${e.summary}`);
  }
  if (s.recentEvents.length) {
    out.push("", "RECENT EVENTS (oldest → newest; the last one just happened):");
    for (const e of s.recentEvents) {
      const extra = [e.location && `at ${e.location}`, e.participants.length && `with ${e.participants.join(", ")}`,
        e.consequences.length && `→ ${list(e.consequences)}`, e.revealed.length && `revealed: ${list(e.revealed)}`].filter(Boolean);
      out.push(`- ${at(e.pos)} ${e.title}: ${e.summary}${extra.length ? ` (${extra.join("; ")})` : ""}`);
    }
  }
  if (s.timeline) {
    const t = s.timeline;
    const when = [t.story_date, t.story_time].filter(Boolean).join(" ");
    out.push("", `TIMELINE: last recorded moment${when ? ` ${when}` : ""}${t.location_text ? ` at ${t.location_text}` : ""}${t.is_flashback ? " (that scene was a flashback)" : ""}.`);
  }
  if (s.entities.length) {
    out.push("", "KNOWN PLACES & THINGS:");
    for (const e of s.entities) out.push(`- ${e.name} (${e.entity_type})${e.description ? `: ${String(e.description).slice(0, 160)}` : ""}`);
  }
  if (s.snapshot?.narrative_summary) out.push("", `STORY SO FAR (as of ${at({ chapterIndex: s.snapshot.chapter_index, subsectionIndex: s.snapshot.subsection_index })}): ${String(s.snapshot.narrative_summary).slice(0, 800)}`);

  if (!out.length) return "";
  let body = out.join("\n");
  if (body.length > LIMITS.maxChars) body = body.slice(0, LIMITS.maxChars).replace(/\n[^\n]*$/, "") + "\n[…truncated]";
  return `[NARRATIVE_MEMORY] Structured story state strictly before ${at(s.position)}. Use it for continuity; never mention it.\n${body}\n[/NARRATIVE_MEMORY]`;
}

export function buildNarrativeContext(rows: NarrativeRows, position: StoryPosition, outlineCharacters: OutlineCharacter[] = []): string {
  return renderNarrativeContext(selectNarrativeState(rows, position, outlineCharacters));
}
