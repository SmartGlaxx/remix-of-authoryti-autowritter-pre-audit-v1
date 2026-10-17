// Stage D — owner-only Continuous Writer Learning. Deterministic (no AI). Recommendations are computed
// from the caller's own signals; approving creates a new ACTIVE overlay version; reverting is permanent
// for that version. Base writer profiles and slider bounds are never modified.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aggregateWeaknesses, proposeRecommendations, transferTechnique, clampOverlayToSliders, shouldExpire, LEARNING_SCHEMA_VERSION, type LearningSignal } from "../_shared/writers/learning.ts";
import { getWriter } from "../_shared/writers/personas.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userDb.auth.getClaims(authHeader.slice(7));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const raw = await req.text();
    if (raw.length > 20_000) return json({ error: "Payload too large" }, 413);
    let body: Record<string, any>; try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
    const action = String(body.action ?? "");
    if (action === "version") return json({ version: "writer-learning-2026-10-17", schemaVersion: LEARNING_SCHEMA_VERSION, paidAI: false });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const loadSignals = async (writerId?: string): Promise<LearningSignal[]> => {
      let q = db.from("writer_learning_signals").select("*").eq("user_id", userId).limit(5000);
      if (writerId) q = q.eq("writer_id", writerId);
      const { data } = await q;
      return (data ?? []).map((r: any) => ({ userId: r.user_id, writerId: r.writer_id, bookId: r.book_id, genre: r.genre, category: r.category, kind: r.kind, chapterIndex: r.chapter_index, subsectionIndex: r.subsection_index, sourceRef: r.source_ref }));
    };

    if (action === "recommendations") {
      const writerId = body.writerId ? String(body.writerId) : undefined;
      if (writerId && !getWriter(writerId)) return json({ error: "Unknown writer" }, 400);
      const signals = await loadSignals(writerId);
      const recs = proposeRecommendations(signals, userId);
      const transfers = body.includeTransfers === true && body.targetWriterId && getWriter(body.targetWriterId)
        ? recs.map((r) => transferTechnique(r, String(body.targetWriterId))).filter(Boolean) : [];
      const { data: overlays } = await db.from("writer_style_adaptations").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      return json({ weaknesses: aggregateWeaknesses(signals, userId), recommendations: recs, transfers, overlays: overlays ?? [] });
    }

    if (action === "approve") {
      // Recompute server-side; the client cannot inject an arbitrary overlay.
      const writerId = String(body.writerId ?? ""), category = String(body.category ?? "");
      if (!getWriter(writerId)) return json({ error: "Unknown writer" }, 400);
      const source = body.sourceWriterId ? String(body.sourceWriterId) : writerId;
      if (!getWriter(source)) return json({ error: "Unknown writer" }, 400);
      const genre = body.genre == null ? null : String(body.genre);
      const base = proposeRecommendations(await loadSignals(source), userId).find((r) => r.category === category && r.genre === genre);
      if (!base) return json({ error: "NOT_QUALIFIED", message: "Not enough reliable evidence for this improvement." }, 409);
      const rec = source === writerId ? base : transferTechnique(base, writerId);
      if (!rec) return json({ error: "NOT_COMPATIBLE" }, 409);
      const { data: prev } = await db.from("writer_style_adaptations").select("id, version, status").eq("user_id", userId).eq("writer_id", writerId).eq("dimension", rec.dimension).order("version", { ascending: false }).limit(1);
      const slider = clampOverlayToSliders(rec.adjustment.slider);
      const { data, error } = await db.from("writer_style_adaptations").insert({
        user_id: userId, writer_id: writerId, book_id: null, dimension: rec.dimension, adjustment: { directive: rec.adjustment.directive, ...(slider ? { slider } : {}) },
        source: "author", status: "active", version: (prev?.[0]?.version ?? 0) + 1, schema_version: rec.schemaVersion, evidence: rec.evidence,
        confidence: rec.confidence, scope: rec.scope, genre: rec.genre, source_writer_id: rec.sourceWriterId ?? null, parent_id: prev?.[0]?.id ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 400);
      // Older active version of the same dimension is retired (reverted), never edited.
      if (prev?.[0]?.status === "active") await db.from("writer_style_adaptations").update({ status: "reverted", reverted_at: new Date().toISOString() }).eq("id", prev[0].id);
      return json({ status: "approved", overlay: data });
    }

    if (action === "revert") {
      if (!UUID.test(String(body.overlayId))) return json({ error: "Invalid overlayId" }, 400);
      const { data, error } = await db.from("writer_style_adaptations").update({ status: "reverted", reverted_at: new Date().toISOString() }).eq("id", body.overlayId).eq("user_id", userId).in("status", ["proposed", "active"]).select().maybeSingle();
      if (error) return json({ error: error.message }, 400);
      return data ? json({ status: "reverted", overlay: data }) : json({ error: "Overlay not found" }, 404);
    }

    if (action === "pin") {
      if (!UUID.test(String(body.bookId))) return json({ error: "Invalid bookId" }, 400);
      const ids = Array.isArray(body.overlayIds) ? body.overlayIds.filter((x: unknown) => UUID.test(String(x))).slice(0, 50) : null;
      const { data: bk } = await db.from("books").select("controls").eq("id", body.bookId).eq("user_id", userId).maybeSingle();
      if (!bk) return json({ error: "Book not found" }, 404);
      if (ids?.length) {
        const { data: own } = await db.from("writer_style_adaptations").select("id").eq("user_id", userId).in("id", ids);
        if ((own ?? []).length !== ids.length) return json({ error: "Unknown overlay" }, 400);
      }
      const controls = { ...(bk.controls ?? {}), adaptationPins: ids }; // null = follow latest active
      const { error } = await db.from("books").update({ controls }).eq("id", body.bookId).eq("user_id", userId);
      return error ? json({ error: error.message }, 400) : json({ status: "pinned", adaptationPins: ids });
    }

    if (action === "expire_stale") {
      const signals = await loadSignals();
      const stale = aggregateWeaknesses(signals, userId).filter(shouldExpire);
      let expired = 0;
      for (const w of stale) {
        const { data } = await db.from("writer_style_adaptations").update({ status: "reverted", reverted_at: new Date().toISOString() }).eq("user_id", userId).eq("writer_id", w.writerId).eq("status", "active").eq("evidence->>category", w.category).select("id");
        expired += (data ?? []).length;
      }
      return json({ status: "ok", expired });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    console.error("writer-learning error:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
