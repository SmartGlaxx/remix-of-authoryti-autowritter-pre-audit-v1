// Live self-test for Phase B safeguards against the real database functions.
// Owner-only, runs only on "[2D-V" test books at chapter 990+, and deletes its
// own lease/anchor rows afterwards. Never touches manuscript text or story memory.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const user = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: c } = await user.auth.getClaims(auth.slice(7));
  const uid = c?.claims?.sub as string | undefined;
  if (!uid) return json({ error: "Unauthorized" }, 401);
  const { bookId } = await req.json().catch(() => ({}));
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: book } = await db.from("books").select("id,user_id,title").eq("id", bookId).maybeSingle();
  if (!book || book.user_id !== uid || !String(book.title).startsWith("[2D-V")) return json({ error: "test book only" }, 403);

  const R: Record<string, unknown> = {};
  const ok = (name: string, pass: boolean, detail?: unknown) => { R[name] = pass ? "PASS" : { FAIL: detail ?? true }; };
  const CH = 990;
  const rpc = (fn: string, args: Record<string, unknown>) => db.rpc(fn, args);
  const acq = (sub: number, w: string, ttl = 60, u = uid) => rpc("acquire_generation_lease", { p_book_id: bookId, p_user_id: u, p_chapter: CH, p_sub: sub, p_worker: w, p_ttl_seconds: ttl });
  try {
    await db.from("book_generation_leases").delete().eq("book_id", bookId).gte("chapter_index", CH);

    // Concurrency: 8 workers race in parallel; exactly one wins.
    const race = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => acq(0, `w${i}`)));
    const winners = race.filter((r) => r.data?.acquired).length;
    ok("concurrency_single_winner", winners === 1, { winners, errors: race.map((r) => r.error?.message).filter(Boolean) });

    const foreign = await acq(1, "x", 60, "00000000-0000-0000-0000-000000000001");
    ok("foreign_owner_rejected", !!foreign.error, foreign.data);
    const badTtl = await acq(1, "x", 1);
    ok("ttl_bounds_enforced", !!badTtl.error);

    const a = await acq(2, "old");
    await db.from("book_generation_leases").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", a.data.lease_id);
    const fence = (w: string, t: number) => rpc("assert_generation_fence", { p_book_id: bookId, p_chapter: CH, p_sub: 2, p_worker: w, p_token: t });
    const expiredSelf = await fence("old", a.data.fencing_token);
    ok("expired_holder_cannot_commit", !!expiredSelf.error && /STALE_GENERATION_LEASE_REJECTED/.test(expiredSelf.error.message));
    const b = await acq(2, "new");
    ok("takeover_bumps_token", b.data?.took_over === true && b.data.fencing_token === a.data.fencing_token + 1, b.data);
    const stale = await fence("old", a.data.fencing_token);
    ok("stale_worker_commit_rejected", !!stale.error && /STALE_GENERATION_LEASE_REJECTED/.test(stale.error.message), stale.error?.message);
    const sr = await rpc("renew_generation_lease", { p_lease_id: b.data.lease_id, p_worker: "old", p_token: a.data.fencing_token, p_ttl_seconds: 60 });
    ok("stale_renew_rejected", sr.data?.renewed === false, sr.data);
    const srel = await rpc("release_generation_lease", { p_lease_id: b.data.lease_id, p_worker: "old", p_token: a.data.fencing_token });
    ok("stale_release_rejected", srel.data === false, srel.data);
    const cur = await fence("new", b.data.fencing_token);
    ok("current_holder_can_commit", !cur.error, cur.error?.message);
    const rn = await rpc("renew_generation_lease", { p_lease_id: b.data.lease_id, p_worker: "new", p_token: b.data.fencing_token, p_ttl_seconds: 60 });
    ok("heartbeat_renews", rn.data?.renewed === true, rn.data);
    const held = await acq(2, "intruder");
    ok("live_lease_blocks_others", held.data?.acquired === false, held.data);
    const re = await acq(2, "new");
    ok("same_holder_reacquire_idempotent", re.data?.reentrant === true && re.data.fencing_token === b.data.fencing_token, re.data);
    const dec = await db.from("book_generation_leases").update({ fencing_token: 1 }).eq("id", b.data.lease_id);
    ok("token_cannot_decrease", !!dec.error);
    await rpc("release_generation_lease", { p_lease_id: b.data.lease_id, p_worker: "new", p_token: b.data.fencing_token });
    const c3 = await acq(2, "third");
    ok("release_then_reacquire_increments", c3.data?.fencing_token === b.data.fencing_token + 1, c3.data);

    // Anchors
    const key = `selftest_${crypto.randomUUID()}`;
    const up = (text: string, ch = 0, u = uid) => rpc("upsert_exact_anchor", { p_book_id: bookId, p_user_id: u, p_key: key, p_type: "CODE", p_text: text, p_match: "EXACT", p_source_type: "USER", p_source_ref: {}, p_chapter: ch });
    const u1 = await up("7-4-1-9"); const u2 = await up("7-4-1-9"); const u3 = await up("7-4-1-8", 3);
    ok("anchor_create_idempotent_version", u1.data?.status === "created" && u2.data?.status === "unchanged" && u3.data?.status === "versioned", [u1.data, u2.data, u3.data]);
    const rows = (await db.from("narrative_exact_anchors").select("version,is_active,exact_text").eq("book_id", bookId).eq("anchor_key", key).order("version")).data ?? [];
    ok("anchor_history_preserved", rows.length === 2 && !rows[0].is_active && rows[1].is_active && rows[1].version === 2, rows);
    const mut = await db.from("narrative_exact_anchors").update({ exact_text: "x" }).eq("book_id", bookId).eq("anchor_key", key).eq("version", 1);
    ok("anchor_text_immutable", !!mut.error);
    const react = await db.from("narrative_exact_anchors").update({ is_active: true }).eq("book_id", bookId).eq("anchor_key", key).eq("version", 1);
    ok("retired_anchor_not_reactivated", !!react.error);
    const fa = await up("1", 0, "00000000-0000-0000-0000-000000000001");
    ok("anchor_foreign_owner_rejected", !!fa.error);
    const authedAnchor = await user.rpc("upsert_exact_anchor", { p_book_id: bookId, p_user_id: uid, p_key: key, p_type: "CODE", p_text: "hack", p_match: "EXACT", p_source_type: "USER", p_source_ref: {}, p_chapter: 0 });
    ok("browser_cannot_write_anchors", !!authedAnchor.error);
    const authedLease = await user.rpc("acquire_generation_lease", { p_book_id: bookId, p_user_id: uid, p_chapter: CH, p_sub: 9, p_worker: "hack", p_ttl_seconds: 60 });
    ok("browser_cannot_take_leases", !!authedLease.error);

    // Reconciliation (logs are append-only, so the self-test leaves one decided record per run on the test book).
    const dk = `selftest_${crypto.randomUUID()}`;
    const rec = () => rpc("record_canon_discrepancy", { p_book_id: bookId, p_user_id: uid, p_chapter: CH, p_sub: 0, p_severity: "CRITICAL", p_type: "CANON_CONFLICT", p_description: "Self-test: eye colour conflict", p_excerpt: "green eyes", p_canon_ref: { fact: "brown eyes" }, p_content_hash: "selftest", p_dedup_key: dk });
    const r1 = await rec(); const r2 = await rec();
    ok("discrepancy_idempotent", r1.data?.status === "recorded" && r2.data?.status === "duplicate" && r1.data.log_id === r2.data.log_id, [r1.data, r2.data]);
    const logId = r1.data.log_id;
    const directUpd = await user.from("canon_reconciliation_logs").update({ decision: "DISMISS" }).eq("id", logId).select();
    ok("browser_cannot_update_directly", !!directUpd.error || (directUpd.data ?? []).length === 0);
    const noRat = await user.rpc("decide_canon_reconciliation", { p_log_id: logId, p_decision: "DISMISS", p_rationale: "  " });
    ok("rationale_required", !!noRat.error);
    const svcDecide = await db.rpc("decide_canon_reconciliation", { p_log_id: logId, p_decision: "DISMISS", p_rationale: "server" });
    ok("decision_requires_signed_in_author", !!svcDecide.error);
    const d1 = await user.rpc("decide_canon_reconciliation", { p_log_id: logId, p_decision: "ACCEPT_PROSE_UPDATE_CANON", p_rationale: "Self-test: prose is better", p_resulting_changes: [{ fact: "eyes", to: "green" }] });
    const d2 = await user.rpc("decide_canon_reconciliation", { p_log_id: logId, p_decision: "DISMISS", p_rationale: "again" });
    const after = (await db.from("canon_reconciliation_logs").select("decision,replan_required,decided_by,rationale").eq("id", logId).single()).data;
    ok("owner_decides_once_with_replan", d1.data?.status === "decided" && d2.data?.status === "already_decided" && after?.decision === "ACCEPT_PROSE_UPDATE_CANON" && after.replan_required === true && after.decided_by === uid, { d1: d1.data ?? d1.error, d2: d2.data ?? d2.error, after });
    const evid = await db.from("canon_reconciliation_logs").update({ rationale: "edited" }).eq("id", logId);
    ok("decided_log_immutable", !!evid.error);
    const del = await db.from("canon_reconciliation_logs").delete().eq("id", logId);
    ok("log_append_only", !!del.error);
  } catch (e) {
    R.crash = String(e);
  } finally {
    await db.from("book_generation_leases").delete().eq("book_id", bookId).gte("chapter_index", CH);
    await db.from("narrative_exact_anchors").delete().eq("book_id", bookId).like("anchor_key", "selftest_%");
  }
  const failed = Object.entries(R).filter(([, v]) => v !== "PASS").map(([k]) => k);
  return json({ passed: Object.keys(R).length - failed.length, failed, results: R });
});
