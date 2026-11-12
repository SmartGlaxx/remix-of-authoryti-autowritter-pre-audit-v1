// Pass 5 — Manuscript audit panel. Audit-only: author actions change finding status/notes only.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2, ShieldCheck, RefreshCw, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AUDIT_STAGES, type StageProgress } from "../../supabase/functions/_shared/narrative/audit.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// Tables are newer than the generated types; keep the query untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const sevVariant = (s: string) => (s === "CRITICAL" || s === "HIGH" ? "destructive" : s === "MEDIUM" ? "default" : "secondary");
const label = (s: string) => s.replace(/_/g, " ");

export function ManuscriptAuditPanel({ bookId, onNavigateToChapter }: { bookId: string; onNavigateToChapter: (idx: number) => void }) {
  const [open, setOpen] = useState(false);
  const [audit, setAudit] = useState<Row | null>(null);
  const [findings, setFindings] = useState<Row[]>([]);
  const [starting, setStarting] = useState(false);
  const [sev, setSev] = useState<string>("ALL");
  const [cat, setCat] = useState<string>("ALL");
  const [showClosed, setShowClosed] = useState(false);
  const [repairs, setRepairs] = useState<Row[]>([]);
  const [repairConfirm, setRepairConfirm] = useState(false);
  const [repairStarting, setRepairStarting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await db.from("manuscript_audits").select("*").eq("book_id", bookId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    setAudit(data ?? null);
    const { data: repairData } = await supabase.functions.invoke("repair-manuscript-audit", { body: { action: "status", bookId } });
    setRepairs(repairData?.runs ?? []);
    if (data && data.status !== "RUNNING") {
      const { data: f } = await db.from("manuscript_audit_findings").select("*").eq("audit_id", data.id);
      setFindings(f ?? []);
    } else setFindings([]);
  }, [bookId]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    if (audit?.status !== "RUNNING" && !repairs.some(r => ["RUNNING", "SYNCING"].includes(r.status))) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [audit?.status, repairs, load]);

  const startRepair = async () => {
    setRepairStarting(true);
    const pending = repairs.find(r => r.status === "NEEDS_SYNC");
    const { error } = await supabase.functions.invoke("repair-manuscript-audit", { body: { action: pending ? "resume" : "start", bookId, ...(pending ? { runId: pending.id } : { auditId: audit?.id }), authorizeRepair: true } });
    setRepairStarting(false);
    if (error) {
      let message = "Couldn't start automatic repairs.";
      try { const details = await error.context?.json(); if (details?.error) message = details.error; } catch { /* use safe fallback */ }
      toast.error(message);
    }
    await load();
  };

  const run = async (force: boolean) => {
    setStarting(true);
    const { data, error } = await supabase.functions.invoke("run-manuscript-audit", { body: { bookId, forceReaudit: force } });
    setStarting(false);
    if (error) { toast.error("Couldn't start the audit. Please try again."); return; }
    if (data?.cached && data.status === "COMPLETE") toast.info("Nothing changed since the last audit — showing it.");
    await load();
  };

  const act = async (f: Row, status: string, notes?: string) => {
    const patch: Row = { status };
    if (notes !== undefined) patch.user_notes = notes.slice(0, 2000);
    const { error } = await db.from("manuscript_audit_findings").update(patch).eq("id", f.id);
    if (error) { toast.error("Couldn't save."); return; }
    setFindings((prev) => prev.map((x) => (x.id === f.id ? { ...x, ...patch } : x)));
  };

  const stages = (audit?.stage_progress ?? {}) as Record<string, StageProgress>;
  const cats = [...new Set(findings.map((f) => f.category))];
  const resolved = new Set(repairs.flatMap(r => (r.outcomes ?? []).filter((o: Row) => o.status === "RESOLVED").map((o: Row) => o.findingId)));
  const shown = findings.map(f => resolved.has(f.id) ? { ...f, status: "AUTO_RESOLVED" } : f)
    .filter((f) => (sev === "ALL" || f.severity === sev) && (cat === "ALL" || f.category === cat) && (showClosed || f.status === "OPEN" || f.status === "ACKNOWLEDGED"))
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || b.confidence - a.confidence);
  const running = audit?.status === "RUNNING";
  const repair = repairs[0];
  const repairing = repair && ["RUNNING", "SYNCING"].includes(repair.status);

  return (
    <div className="mb-3 mx-4 md:mx-0 rounded-xl border border-border bg-card/60">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} className="w-full h-auto flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground">
        <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> Manuscript audit
          {audit && <Badge variant="outline" className="ml-2">{label(audit.status)}</Badge>}
          {audit?.summary?.total != null && !running && <span className="text-muted-foreground font-normal">· {audit.summary.total} finding(s)</span>}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run(false)} disabled={starting || running || repairing || repair?.status === "NEEDS_SYNC"}>
              {starting || running ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}{audit ? "Audit again" : "Run audit"}
            </Button>
            {audit && !running && <Button size="sm" variant="outline" onClick={() => run(true)} disabled={starting || repairing || repair?.status === "NEEDS_SYNC"}><RefreshCw className="w-4 h-4 mr-1" />Force fresh audit</Button>}
            {audit && <Button size="sm" variant="outline" onClick={() => setRepairConfirm(true)} disabled={repairStarting || repairing || running || audit.status !== "COMPLETE"}>
              {repairing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wrench className="w-4 h-4 mr-1" />}{repair?.status === "NEEDS_SYNC" ? "Resume story memory" : "Auto-fix conflicts"}
            </Button>}
          </div>
          {repair && <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{label(repair.status)}</Badge><span>{(repair.outcomes ?? []).filter((o: Row) => o.status === "RESOLVED").length} fixed · {(repair.outcomes ?? []).filter((o: Row) => o.status === "HELD").length} held</span><Button size="sm" variant="ghost" onClick={() => setHistoryOpen(v => !v)}>Repair history</Button></div>
            {repair.error && <p className="text-destructive">{repair.error}</p>}
            {historyOpen && <div className="space-y-3">{repairs.flatMap(r => (r.patches ?? []).map((p: Row, i: number) => <div key={`${r.id}-${i}`} className="space-y-2 border-t border-border pt-2"><p>{p.details?.rationale}</p>{(p.changes ?? []).map((c: Row) => <details key={`${c.chapterIndex}-${c.subsectionIndex}`}><summary className="cursor-pointer">Section {c.chapterIndex + 1}.{c.subsectionIndex + 1} · {Math.round(c.ratio * 100)}% changed</summary><div className="grid gap-3 md:grid-cols-2 mt-2"><div><Badge variant="outline">Before</Badge><p className="whitespace-pre-wrap mt-1">{c.original}</p></div><div><Badge variant="outline">After</Badge><p className="whitespace-pre-wrap mt-1">{c.text}</p></div></div></details>)}</div>))}{(repair.outcomes ?? []).filter((o: Row) => o.status !== "RESOLVED").map((o: Row) => <p key={o.findingId}>{o.status}: {o.reason}</p>)}</div>}
          </div>}

          {audit && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs">
              {AUDIT_STAGES.map((s) => {
                const p = stages[s];
                if (!p) return null;
                return (
                  <div key={s} className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1" title={p.error ?? ""}>
                    {p.status === "running" ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className={`w-2 h-2 rounded-full ${p.status === "completed" ? "bg-primary" : p.status === "failed" ? "bg-destructive" : "bg-muted-foreground/40"}`} />}
                    <span className="capitalize truncate">{label(s)}</span>
                    {p.status === "completed" && <span className="ml-auto text-muted-foreground">{p.finding_count}</span>}
                    {p.status === "skipped" && <span className="ml-auto text-muted-foreground">skip</span>}
                  </div>
                );
              })}
            </div>
          )}
          {audit?.status === "FAILED" && <p className="text-xs text-destructive">The audit could not finish. Please try again.</p>}
          {audit?.status === "PARTIAL" && <p className="text-xs text-muted-foreground">Some checks failed; results below are from the checks that finished.</p>}

          {!running && findings.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs items-center">
              <select className="bg-background border border-border rounded px-2 py-1" value={sev} onChange={(e) => setSev(e.target.value)}>
                <option value="ALL">All severities</option>{SEV_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="bg-background border border-border rounded px-2 py-1" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="ALL">All categories</option>{cats.map((c) => <option key={c} value={c}>{label(c)}</option>)}
              </select>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Show dismissed/resolved</label>
            </div>
          )}
          {!running && audit && findings.length === 0 && audit.status !== "FAILED" && <p className="text-sm text-muted-foreground">No problems found.</p>}

          <div className="space-y-3">
            {shown.map((f) => <FindingCard key={f.id} f={f} onAct={act} onGo={onNavigateToChapter} />)}
          </div>
        </div>
      )}
      <AlertDialog open={repairConfirm} onOpenChange={setRepairConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{repair?.status === "NEEDS_SYNC" ? "Resume story memory?" : "Automatically repair this book?"}</AlertDialogTitle><AlertDialogDescription>AI charges apply. Earlier and later passages may change to keep the most compelling believable version. Your explicit story facts remain protected. Changes are checked, saved with before-and-after history, and limited to 20% per section. Unsafe corrections remain held.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={startRepair}>Authorize repairs</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}

function FindingCard({ f, onAct, onGo }: { f: Row; onAct: (f: Row, status: string, notes?: string) => void; onGo: (i: number) => void }) {
  const [notes, setNotes] = useState<string>(f.user_notes ?? "");
  const loc = f.evidence_location as { chapterIndex: number; subsectionIndex: number } | null;
  const cloc = f.contradicting_location as { chapterIndex: number; subsectionIndex: number } | null;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={sevVariant(f.severity)}>{f.severity}</Badge>
        <Badge variant="outline" className="capitalize">{label(f.category)}</Badge>
        {f.verification === "UNCERTAIN" && <Badge variant="secondary">Uncertain</Badge>}
        {f.user_canon_protected && <Badge variant="outline">Your canon — needs your review</Badge>}
        {f.status !== "OPEN" && <Badge variant="secondary" className="capitalize">{label(f.status).toLowerCase()}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{Math.round(Number(f.confidence) * 100)}% confident</span>
      </div>
      <p className="font-medium text-foreground">{f.title}</p>
      {f.concise_description && <p className="text-muted-foreground">{f.concise_description}</p>}
      {f.evidence_excerpt && <blockquote className="border-l-2 border-primary pl-2 italic text-xs">“{f.evidence_excerpt}”{loc && <span className="not-italic text-muted-foreground"> — {loc.chapterIndex + 1}.{loc.subsectionIndex + 1}</span>}</blockquote>}
      {f.contradicting_evidence && <blockquote className="border-l-2 border-destructive pl-2 italic text-xs">{f.contradicting_evidence}{cloc && <span className="not-italic text-muted-foreground"> — {cloc.chapterIndex + 1}.{cloc.subsectionIndex + 1}</span>}</blockquote>}
      {f.explanation && <p className="text-xs text-muted-foreground">{f.explanation}</p>}
      {f.suggested_action && <p className="text-xs"><span className="font-medium">Suggestion:</span> {f.suggested_action}</p>}
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Your notes" className="text-xs min-h-[48px]" maxLength={2000} />
      <div className="flex flex-wrap gap-2">
        {loc && <Button size="sm" variant="outline" onClick={() => onGo(loc.chapterIndex)}>Go to section</Button>}
        <Button size="sm" variant="secondary" onClick={() => onAct(f, "ACKNOWLEDGED", notes)}>Acknowledge</Button>
        <Button size="sm" variant="secondary" onClick={() => onAct(f, "RESOLVED_BY_USER", notes)}>Mark resolved</Button>
        <Button size="sm" variant="ghost" onClick={() => onAct(f, "DISMISSED", notes)}>Dismiss</Button>
      </div>
    </div>
  );
}
