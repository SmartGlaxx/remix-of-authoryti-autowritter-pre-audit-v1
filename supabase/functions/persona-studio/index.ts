// Phase 2 — Persona Studio server. The only path that creates narrative identities,
// personas and relationships: authoritative identity resolution (never auto-merges),
// life-chronology back-check, author-fact protection, and the AI Generate/Hybrid contract.
// Phase 2 uses the deterministic mock model unless PERSONA_AI_ENGINE=live is set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText } from "../_shared/ai/client.ts";
import { createAIDeps } from "../_shared/ai/server.ts";
import { reusablePersonaProfile } from "../_shared/narrative/personaReuse.ts";
import { generateOpenAIImage, ImageError } from "../_shared/ai/openaiImage.ts";
import { personaLibraryState, portraitOptionCount } from "../_shared/narrative/personaControls.ts";
import { gateCreation, resolveIdentity, type KnownIdentity, type ResolutionDecision } from "../_shared/narrative/identityResolution.ts";
import {
  buildPersonaPrompt, checkLifeChronology, isDomain, isRole, mockPersonaModel, parsePersonaOutput,
  PERSONA_FIELDS, type AuthorFact, type PersonaGenerationRequest,
} from "../_shared/narrative/personaGeneration.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strArr = (v: unknown, max = 20) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, max) : []);
const LEVELS = ["seed", "mentioned", "story_character", "major_character", "independent_persona"];
const OPENAI_MODEL = "openai/gpt-5-mini";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userDb.auth.getClaims(authHeader.slice(7));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const raw = await req.text();
    if (raw.length > 100_000) return json({ error: "Payload too large" }, 413);
    let body: Record<string, any>; try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const action = String(body.action ?? "");

    const ownsUniverse = async (id: string | null) => {
      if (!id) return true;
      const { data } = await db.from("fictional_universes").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
      return !!data;
    };
    const known = async (universeId: string | null): Promise<KnownIdentity[]> => {
      let q = db.from("narrative_identities").select("id, display_name, aliases, universe_id").eq("user_id", userId).is("merged_into_id", null).limit(2000);
      q = universeId ? q.eq("universe_id", universeId) : q.is("universe_id", null);
      const { data } = await q;
      return (data ?? []).map((r: any) => ({ id: r.id, displayName: r.display_name, aliases: r.aliases ?? [], universeId: r.universe_id }));
    };
    // Resolve → gate → create or reuse. Returns null identityId when confirmation is required.
    const resolveAndCreate = async (p: { displayName: string; aliases: string[]; universeId: string | null; level: string; kind?: string; originBookId?: string | null; seedDetails?: unknown }) => {
      const resolution = resolveIdentity(await known(p.universeId), p);
      const gate = gateCreation(resolution, body.decision as ResolutionDecision | undefined, uuidOrNull(body.existingId) ?? undefined);
      if (gate.action === "confirm") return { needsConfirmation: true as const, resolution };
      if (gate.action === "use_existing") return { identityId: gate.id, reused: true, resolution };
      const { data, error } = await db.from("narrative_identities").insert({
        user_id: userId, universe_id: p.universeId, display_name: p.displayName, aliases: p.aliases,
        level: p.level, kind: p.kind ?? "person", origin_book_id: p.originBookId ?? null, seed_details: p.seedDetails ?? {},
      }).select("id").single();
      if (error) throw new Error(error.message);
      return { identityId: data.id as string, reused: false, resolution };
    };

    if (action === "resolve") {
      const universeId = uuidOrNull(body.universeId);
      if (!(await ownsUniverse(universeId))) return json({ error: "Universe not found" }, 404);
      const displayName = str(body.displayName);
      if (!displayName) return json({ error: "Name required" }, 400);
      return json(resolveIdentity(await known(universeId), { displayName, aliases: strArr(body.aliases), universeId }));
    }

    if (action === "create_identity" || action === "create_persona") {
      const universeId = uuidOrNull(body.universeId);
      if (!(await ownsUniverse(universeId))) return json({ error: "Universe not found" }, 404);
      const displayName = str(body.displayName);
      if (!displayName) return json({ error: "Name required" }, 400);
      const isPersona = action === "create_persona";
      const level = isPersona ? "independent_persona" : (LEVELS.includes(body.level) ? body.level : "story_character");
      if (isPersona) {
        if (body.domain !== undefined && !isDomain(body.domain)) return json({ error: "Invalid domain" }, 400);
        const findings = checkLifeChronology(body.birthDate ?? null, body.deathDate ?? null, Array.isArray(body.milestones) ? body.milestones : []);
        const violations = findings.filter((f) => f.verdict === "violation");
        if (violations.length) return json({ error: "CHRONOLOGY_VIOLATION", findings }, 422);
      }
      const r = await resolveAndCreate({ displayName, aliases: strArr(body.aliases), universeId, level, kind: body.kind, seedDetails: body.seedDetails });
      if ("needsConfirmation" in r) return json({ status: "needs_confirmation", resolution: r.resolution }, 409);
      if (!isPersona) return json({ status: "ok", identityId: r.identityId, reused: r.reused });
      const { data: existing } = await db.from("personas").select("id").eq("identity_id", r.identityId).maybeSingle();
      if (existing) return json({ error: "That character already has a persona profile", identityId: r.identityId }, 409);
      if (r.reused) await db.from("narrative_identities").update({ level: "independent_persona" }).eq("id", r.identityId).eq("user_id", userId);
      const mode = ["ai", "manual", "hybrid"].includes(body.creationMode) ? body.creationMode : "manual";
      const { data: persona, error } = await db.from("personas").insert({
        user_id: userId, identity_id: r.identityId, category: isDomain(body.domain) ? body.domain : "general", creation_mode: mode,
        birth_date: body.birthDate ?? null, death_date: body.deathDate ?? null,
        psychology: typeof body.psychology === "object" && body.psychology ? body.psychology : {},
        voice_sample: str(body.voiceSample, 4000) || null,
        user_facts: Array.isArray(body.userFacts) ? body.userFacts.slice(0, 100) : [],
        ai_expansions: Array.isArray(body.aiExpansions) ? body.aiExpansions.slice(0, 100) : [],
        milestones: Array.isArray(body.milestones) ? body.milestones.slice(0, 200) : [],
      }).select("id").single();
      if (error) return json({ error: error.message }, 400);
      return json({ status: "ok", identityId: r.identityId, personaId: persona.id, reused: r.reused });
    }

    if (action === "portrait") {
      if (body.testMode === true || req.headers.get("x-ai-test-mode") === "1") return json({ error: "test_mode_blocked" }, 403);
      if (!portraitOptionCount(body.optionCount)) return json({ error: "Choose between one and five pictures." }, 400);
      // A portrait can be made before the persona exists (new-persona form); if an id is given it must be the caller's.
      if (body.personaId) {
        const id = uuidOrNull(body.personaId);
        const { data: persona } = await db.from("personas").select("identity_id").eq("id", id).eq("user_id", userId).maybeSingle();
        if (!persona) return json({ error: "Persona not found" }, 404);
      }
      const prompt = str(body.prompt, 4000);
      if (!prompt) return json({ error: "Describe the character's appearance first." }, 400);
      const { data: allowed, error: rateError } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "persona_portrait", _max_per_hour: 30, _max_per_day: 100 });
      if (rateError || !allowed) return json({ error: "Too many portrait requests. Please try again later." }, 429);
      try {
        const imageUrl = await generateOpenAIImage({ admin: db, userId, prompt: `Create one character profile portrait. Head and shoulders, face clearly visible, no text. ${prompt}`, size: "1024x1024" });
        return json({ imageUrl });
      } catch (e) { if (e instanceof ImageError) return json({ error: e.message }, e.status); throw e; }
    }

    if (action === "demote") {
      const id = uuidOrNull(body.personaId);
      if (!id) return json({ error: "Invalid personaId" }, 400);
      const { data, error } = await db.from("personas").update(personaLibraryState(true)).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
      if (error) return json({ error: error.message }, 400);
      return data ? json({ status: "ok" }) : json({ error: "Persona not found" }, 404);
    }

    if (action === "reuse_deleted") {
      const id = uuidOrNull(body.identityId);
      if (!id) return json({ error: "Invalid identityId" }, 400);
      const { data: source } = await db.from("narrative_identities").select("*").eq("id", id).eq("user_id", userId).is("merged_into_id", null).maybeSingle();
      if (!source?.seed_details?.deleted_book_title) return json({ error: "Deleted-book character not found" }, 404);
      const bookId = uuidOrNull(body.bookId);
      if (body.bookId && !bookId) return json({ error: "Invalid bookId" }, 400);
      let universeId: string | null = null;
      if (bookId) {
        const { data: book } = await db.from("books").select("universe_id").eq("id", bookId).eq("user_id", userId).maybeSingle();
        if (!book) return json({ error: "Book not found" }, 404);
        universeId = book.universe_id ?? null;
      }
      const { data: profile } = await db.from("personas").select("*").eq("identity_id", id).eq("user_id", userId).maybeSingle();
      const copy = reusablePersonaProfile(source, profile);
      const newId = crypto.randomUUID();
      const { error: identityError } = await db.from("narrative_identities").insert({ id: newId, user_id: userId, universe_id: universeId,
        display_name: str(body.displayName) || copy.displayName, aliases: copy.aliases, kind: copy.kind,
        level: "independent_persona", origin_book_id: bookId, seed_details: copy.seedDetails });
      if (identityError) return json({ error: identityError.message }, 400);
      const { data: persona, error } = await db.from("personas").insert({ ...copy.profile, user_id: userId, identity_id: newId }).select("id").single();
      if (error) {
        await db.from("narrative_identities").delete().eq("id", newId).eq("user_id", userId);
        return json({ error: error.message }, 400);
      }
      return json({ status: "ok", identityId: newId, personaId: persona.id });
    }

    if (action === "promote") {
      const id = uuidOrNull(body.identityId);
      if (!id) return json({ error: "Invalid identityId" }, 400);
      const { data: ident } = await db.from("narrative_identities").select("id, level").eq("id", id).eq("user_id", userId).maybeSingle();
      if (!ident) return json({ error: "Not found" }, 404);
      await db.from("narrative_identities").update({ level: "independent_persona" }).eq("id", id).eq("user_id", userId);
      const { data: p } = await db.from("personas").select("id").eq("identity_id", id).maybeSingle();
      if (p) {
        const { error } = await db.from("personas").update(personaLibraryState(false)).eq("id", p.id).eq("user_id", userId);
        return error ? json({ error: error.message }, 400) : json({ status: "ok", identityId: id, personaId: p.id });
      }
      const { data: np, error } = await db.from("personas").insert({ user_id: userId, identity_id: id, creation_mode: "promoted", category: isDomain(body.domain) ? body.domain : "general" }).select("id").single();
      return error ? json({ error: error.message }, 400) : json({ status: "ok", identityId: id, personaId: np.id });
    }

    // Promote a book character: resolve in the book's universe, link, attach persona; ids stay stable.
    if (action === "promote_character") {
      const scId = uuidOrNull(body.storyCharacterId);
      if (!scId) return json({ error: "Invalid storyCharacterId" }, 400);
      const { data: sc } = await db.from("story_characters").select("id, book_id, name, aliases, narrative_identity_id").eq("id", scId).eq("user_id", userId).maybeSingle();
      if (!sc) return json({ error: "Not found" }, 404);
      const { data: book } = await db.from("books").select("universe_id").eq("id", sc.book_id).eq("user_id", userId).maybeSingle();
      if (!book) return json({ error: "Not found" }, 404);
      let identityId = sc.narrative_identity_id as string | null;
      if (!identityId) {
        const r = await resolveAndCreate({ displayName: sc.name, aliases: sc.aliases ?? [], universeId: book.universe_id ?? null, level: "independent_persona", originBookId: sc.book_id });
        if ("needsConfirmation" in r) return json({ status: "needs_confirmation", resolution: r.resolution }, 409);
        identityId = r.identityId;
        await db.from("story_characters").update({ narrative_identity_id: identityId }).eq("id", scId);
      }
      await db.from("narrative_identities").update({ level: "independent_persona" }).eq("id", identityId).eq("user_id", userId);
      const { data: p } = await db.from("personas").select("id").eq("identity_id", identityId).maybeSingle();
      if (p) {
        const { error } = await db.from("personas").update(personaLibraryState(false)).eq("id", p.id).eq("user_id", userId);
        return error ? json({ error: error.message }, 400) : json({ status: "ok", identityId, personaId: p.id });
      }
      const { data: np, error } = await db.from("personas").insert({ user_id: userId, identity_id: identityId, creation_mode: "promoted", category: isDomain(body.domain) ? body.domain : "general" }).select("id").single();
      return error ? json({ error: error.message }, 400) : json({ status: "ok", identityId, personaId: np.id });
    }

    if (action === "create_relationship") {
      const s = uuidOrNull(body.subjectId), t = uuidOrNull(body.targetId);
      const type = str(body.relationshipType, 60);
      if (!s || !t || s === t || !type) return json({ error: "Invalid relationship" }, 400);
      const { data: ids } = await db.from("narrative_identities").select("id, universe_id").eq("user_id", userId).in("id", [s, t]);
      if ((ids ?? []).length !== 2) return json({ error: "Not found" }, 404);
      const u = ids![0].universe_id;
      if (ids![1].universe_id !== u) return json({ error: "RELATIONSHIP_UNIVERSE_MISMATCH" }, 422);
      const { data: dup } = await db.from("narrative_relationships").select("id").eq("user_id", userId).eq("relationship_type", type)
        .or(`and(subject_identity_id.eq.${s},target_identity_id.eq.${t}),and(subject_identity_id.eq.${t},target_identity_id.eq.${s})`).limit(1);
      if (dup?.length) return json({ error: "That relationship already exists" }, 409);
      const { data, error } = await db.from("narrative_relationships").insert({
        user_id: userId, universe_id: u, subject_identity_id: s, target_identity_id: t, relationship_type: type,
        emotional_quality: str(body.emotionalQuality, 120) || null, status: str(body.status, 60) || null,
        established_date: body.establishedDate ?? null, ended_date: body.endedDate ?? null,
        shared_secrets: strArr(body.sharedSecrets), is_symmetrical: body.isSymmetrical !== false, notes: str(body.notes, 2000) || null,
      }).select("id").single();
      return error ? json({ error: error.message }, 400) : json({ status: "ok", id: data.id });
    }

    if (action === "set_book_role") {
      const bookId = uuidOrNull(body.bookId), identityId = uuidOrNull(body.identityId);
      if (!bookId || !identityId || !isRole(body.role)) return json({ error: "Invalid input" }, 400);
      const { error } = await userDb.from("book_identity_roles").upsert({ user_id: userId, book_id: bookId, identity_id: identityId, narrative_role: body.role }, { onConflict: "book_id,identity_id" });
      return error ? json({ error: error.message }, 400) : json({ status: "ok" });
    }

    if (action === "generate") {
      if (!["ai_generate", "hybrid"].includes(body.mode) || !isDomain(body.domain)) return json({ error: "Invalid input" }, 400);
      const authorFacts: AuthorFact[] = (Array.isArray(body.authorFacts) ? body.authorFacts : [])
        .filter((f: any) => f && (PERSONA_FIELDS as readonly string[]).includes(f.field) && f.value !== undefined && f.value !== "")
        .slice(0, 40);
      const request: PersonaGenerationRequest = { mode: body.mode, domain: body.domain, seed: str(body.seed, 2000), authorFacts };
      const live = Deno.env.get("PERSONA_AI_ENGINE") === "live";
      let rawOut: string;
      if (live) {
        const { system, user } = buildPersonaPrompt(request);
        const r = await generateAIText({ role: "planner", config: { mode: "single", singleModel: OPENAI_MODEL } as any, userId, bookId: null, request: { system, user, json: true, reasoning: "low" } } as any, createAIDeps(db, userId));
        rawOut = r.text;
      } else {
        rawOut = mockPersonaModel(request);
      }
      const parsed = parsePersonaOutput(rawOut, request);
      if (!parsed.ok) return json({ error: parsed.error }, 502);
      return json({ status: "ok", engine: live ? "live" : "mock", draft: parsed.draft });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("persona-studio", e);
    return json({ error: e instanceof Error ? e.message : "Server error" }, 500);
  }
});
