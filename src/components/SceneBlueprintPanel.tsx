// Phase 5 Stage A — writing-desk views for progressive books. Read-only blueprint (plan, locked
// details, viewpoint knowledge, author-only directives) and inline review of held drafts.
// Acceptance always goes through the server's full validation + fenced commit (saveThenAccept).
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Eye, KeyRound, Loader2, Lock, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { callReview, saveThenAccept } from "@/lib/candidateReview";
import { runNarrativeExtraction } from "@/lib/narrativeExtraction";
import { sceneKnowledge } from "../../supabase/functions/_shared/narrative/sceneKnowledge";

type Row = Record<string, any>;
const txt = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as Row).text ?? (v as Row).description ?? (v as Row).goal ?? (v as Row).kind ?? "") : "");

function Section({ icon: Icon, title, note, children }: { icon: typeof Target; title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-primary" />{title}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
      {children}
    </div>
  );
}

export function SceneBlueprintPanel({ bookId, chapterIndex, subsectionIndex }: { bookId: string; chapterIndex: number; subsectionIndex: number }) {
  const [data, setData] = useState<{ plan: Row | null; beats: Row | null; anchors: Row[]; knowledge: Row[] } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const [p, a, k] = await Promise.all([
        supabase.from("book_progressive_plans").select("plan_level, plan_status, subsection_index, content").eq("book_id", bookId).eq("chapter_index", chapterIndex).in("plan_level", ["SECTION", "BEATS"]).eq("subsection_index", subsectionIndex).order("version", { ascending: false }),
        supabase.from("narrative_exact_anchors").select("anchor_key, anchor_type, exact_text, effective_chapter_index").eq("book_id", bookId).eq("is_active", true).eq("canon_status", "ESTABLISHED").lte("effective_chapter_index", chapterIndex).limit(60),
        supabase.from("books").select("narrator_identity_id, narrative_vantage, narrator_telling_date").eq("id", bookId).maybeSingle(),
      ]);
      if (!live) return;
      const rows = p.data ?? [];
      const plan = rows.find((r) => r.plan_level === "SECTION") ?? null;
      // Same scene-chronology filter the writer uses (story date, flashbacks, narrative vantage) — never chapter order alone.
      let knowledge: Row[] = [];
      const b = k.data as Row | null;
      if (b?.narrator_identity_id) {
        const { data: kr } = await supabase.from("knowledge_acquisitions").select("*").eq("identity_id", b.narrator_identity_id).limit(2000);
        if (!live) return;
        knowledge = sceneKnowledge(kr ?? [], b, plan?.content?.section ?? plan?.content ?? null, chapterIndex, subsectionIndex);
      }
      setData({ plan, beats: rows.find((r) => r.plan_level === "BEATS") ?? null, anchors: a.data ?? [], knowledge });
    })();
    return () => { live = false; };
  }, [bookId, chapterIndex, subsectionIndex]);

  if (!data) return <div className="p-4"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  const sec = data.plan?.content?.section ?? {};
  const detail = data.plan?.content?.detail ?? {};
  const beats: unknown[] = data.beats?.content?.beats ?? sec.beats ?? [];
  const directives: unknown[] = data.beats?.content?.setupDirectives ?? data.plan?.content?.setupDirectives ?? [];
  return (
    <div className="p-3 space-y-5 text-sm">
      <p className="text-xs text-muted-foreground">Chapter {chapterIndex + 1}, section {subsectionIndex + 1}</p>
      <Section icon={Target} title="Scene goal" note="From your approved plan">
        {data.plan ? (
          <div className="space-y-1">
            <p>{sec.objective || "—"}</p>
            {detail.entry && <p className="text-xs"><span className="text-muted-foreground">Opens: </span>{detail.entry}</p>}
            {detail.focus && <p className="text-xs"><span className="text-muted-foreground">Turns on: </span>{detail.focus}</p>}
            {detail.exit && <p className="text-xs"><span className="text-muted-foreground">Ends: </span>{detail.exit}</p>}
            {beats.length > 0 && <ol className="list-decimal pl-4 text-xs space-y-0.5">{beats.map((b, i) => <li key={i}>{txt(b).replace(/_/g, " ")}</li>)}</ol>}
          </div>
        ) : <p className="text-xs text-muted-foreground">No approved plan for this section yet.</p>}
      </Section>
      <Section icon={Lock} title="Locked story details" note="Established by accepted text">
        {data.anchors.length ? <ul className="space-y-1">{data.anchors.map((a) => <li key={a.anchor_key} className="text-xs"><Badge variant="outline" className="mr-1 text-[10px]">{a.anchor_type}</Badge>{a.exact_text}</li>)}</ul> : <p className="text-xs text-muted-foreground">None yet.</p>}
      </Section>
      <Section icon={Eye} title="What characters know" note="Learned on the page so far">
        {data.knowledge.length ? <ul className="space-y-1">{data.knowledge.map((k, i) => <li key={i} className="text-xs">{k.claim}{k.certainty && k.certainty !== "certain" && <span className="text-muted-foreground"> ({k.certainty})</span>}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>}
      </Section>
      <Section icon={KeyRound} title="Author eyes only" note="Foreshadowing guidance. Never treated as something characters know or as established fact.">
        {directives.length ? <ul className="space-y-1">{directives.map((d, i) => <li key={i} className="text-xs italic">{txt(d)}</li>)}</ul> : <p className="text-xs text-muted-foreground">No twist setup in this section.</p>}
      </Section>
    </div>
  );
}

/** Inline card for drafts the checks held back. Edits are saved first; checks run on the saved version. */
export function HeldDraftAlert({ bookId, chapterIndex, onAccepted }: { bookId: string; chapterIndex: number; onAccepted?: () => void }) {
  const [held, setHeld] = useState<{ c: Row; pending: number }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await callReview<{ candidates: Row[]; logs: Row[] }>({ action: "status", bookId });
    if (!r.ok) return;
    setHeld(r.data.candidates.filter((c) => c.chapter_index === chapterIndex).map((c) => {
      const lineage: string[] = c.lineage ?? [c.id];
      return { c, pending: r.data.logs.filter((l) => lineage.includes(l.candidate_id) && l.decision === "PENDING").length };
    }));
  }, [bookId, chapterIndex]);
  useEffect(() => { void load(); }, [load]);
  if (!held.length) return null;
  return (
    <div className="space-y-2 mb-4">
      {held.map(({ c, pending }) => {
        const reason = (c.findings as Row[] ?? []).find((f) => f.severity !== "info")?.message;
        const text = edits[c.id] ?? c.draft_text;
        return (
          <Card key={c.id} className="border-destructive/50">
            <CardContent className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <span className="text-sm font-medium flex-1 min-w-0">Section {c.subsection_index + 1} draft is held{reason ? `: ${reason}` : ""}</span>
                <Button size="sm" variant="outline" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Close" : "Review & correct"}</Button>
                <Button size="sm" variant="ghost" asChild><Link to={`/books/${bookId}/plan`}>Open in Planning Studio</Link></Button>
              </div>
              <p className="text-xs text-muted-foreground">Your accepted text is unchanged.{pending ? ` ${pending} conflict${pending > 1 ? "s" : ""} must be decided in Planning Studio before this can be accepted.` : ""}</p>
              {open === c.id && (
                <div className="space-y-2">
                  {(c.findings as Row[] ?? []).filter((f) => f.severity !== "info").map((f, i) => (
                    <p key={i} className="text-xs border-l-2 border-primary pl-2">{f.message}{f.excerpt && <span className="italic text-muted-foreground"> “{f.excerpt}”</span>}</p>
                  ))}
                  <Textarea rows={8} value={text} onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!!busy || text === c.draft_text} onClick={async () => {
                      setBusy(`s-${c.id}`);
                      try {
                        const s = await callReview<Row>({ action: "save_edit", bookId, candidateId: c.id, editedText: text });
                        if (!s.ok) throw new Error(s.data.error); toast.success("Edit saved"); setEdits({}); await load();
                      } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(null); }
                    }}>Save edit</Button>
                    <Button size="sm" disabled={!!busy || pending > 0} onClick={async () => {
                      setBusy(`a-${c.id}`);
                      try {
                        const r = await saveThenAccept(bookId, c.id, c.draft_text, edits[c.id]);
                        if (r.data.status === "accepted") {
                          toast.success("Passed all checks — accepted");
                          await runNarrativeExtraction(bookId, c.chapter_index, c.subsection_index);
                          onAccepted?.();
                        } else if (r.data.status === "held") toast.warning("Still not passing checks — see the new findings");
                        else throw new Error(r.data.message ?? r.data.error ?? "Could not accept");
                        setEdits({}); await load();
                      } catch (e) { toast.error(e instanceof Error ? e.message : "Could not accept"); } finally { setBusy(null); }
                    }}>{busy === `a-${c.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Re-run checks & accept</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
