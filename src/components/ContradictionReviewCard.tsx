import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, ChevronDown, Loader2, MessageSquare, Pencil, RefreshCw, Send, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callReview, needsReplaceConfirmation, saveThenAccept } from "@/lib/candidateReview";
import { runNarrativeExtraction } from "@/lib/narrativeExtraction";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { Location, Recommendation } from "../../supabase/functions/_shared/narrative/planning/conflictReview";

export const RECONCILIATION_EVENT = "canon-reconciliation-changed";
type Evidence = { summary: string; paragraph: string; location: Location | null; source: string };
type Log = { id: string; severity: string; description: string; decision: string; application_status: string; chapter_index: number; subsection_index: number; candidate: { id: string; draft_text: string } | null; prior: Evidence; newer: Evidence; recommendation: Recommendation; memorySynced: boolean; accepted: boolean };
type Work = { id: string; original: string; text: string; replace: boolean; outcome: string };
type ChatTurn = { role: "author" | "assistant"; content: string; edits?: { find: string; replace: string }[]; applied?: boolean };
const summary = (s: string) => s.split(/(?<=[.!?])\s/)[0];

function Source({ evidence }: { evidence: Evidence }) {
  const l = evidence.location;
  return <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
    <BookOpen className="w-3 h-3" />
    {l ? <><span>Chapter {l.chapter + 1} · Section {l.section + 1}</span>{l.paragraphNumber !== null && <span>Paragraph {l.paragraphNumber}</span>}{l.page !== null && <span>Approx. page {l.page}</span>}</> : <span>{evidence.source === "author" ? "Your setup" : "Source location not recorded"}</span>}
    {evidence.source === "held_draft" && <Badge variant="outline">Draft</Badge>}
  </p>;
}

export function ContradictionReviewCard({ bookId, onAccepted }: { bookId: string; onAccepted?: () => void }) {
  const queryClient = useQueryClient();
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [phase, setPhase] = useState("");
  const [selected, setSelected] = useState<Log | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [work, setWork] = useState<Record<string, Work>>({});
  const [note, setNote] = useState("");
  const [history, setHistory] = useState(false);
  const [chat, setChat] = useState<Record<string, ChatTurn[]>>({});
  const [draft, setDraft] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await callReview<{ logs?: Log[]; error?: string }>({ action: "conflicts", bookId });
      if (!r.ok) throw new Error(r.data.error ?? "Could not load story conflicts");
      setLogs(r.data.logs ?? []); setError("");
      setSelected((old) => old ? r.data.logs?.find((l) => l.id === old.id) ?? old : null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load conflicts"); }
  }, [bookId]);
  useEffect(() => { void load(); const h = () => void load(); window.addEventListener(RECONCILIATION_EVENT, h); return () => window.removeEventListener(RECONCILIATION_EVENT, h); }, [load]);
  const pending = logs.filter((l) => l.decision === "PENDING");
  const unfinished = logs.filter((l) => l.decision !== "PENDING" && (l.candidate || ["PENDING_APPLICATION", "AWAITING_SYNC"].includes(l.application_status)));
  const done = logs.filter((l) => l.decision !== "PENDING" && !unfinished.includes(l));
  const active = [...pending, ...unfinished];
  const w = selected ? work[selected.id] : undefined;
  const notify = () => window.dispatchEvent(new Event(RECONCILIATION_EVENT));
  const open = (log: Log, side?: string) => { setSelected(log); setExpanded(side ? [side] : []); setNote(""); };
  const updateWork = (id: string, value: Partial<Work>) => setWork((old) => ({ ...old, [id]: { id: "", original: "", text: "", replace: false, outcome: "", ...old[id], ...value } }));
  const prepare = async (log: Log) => {
    const r = await callReview<{ candidate_id: string; draft_text: string; error?: string }>({ action: "prepare_conflict", bookId, logId: log.id });
    if (!r.ok) throw new Error(r.data.error ?? "Could not prepare review");
    updateWork(log.id, { id: r.data.candidate_id, original: r.data.draft_text, text: r.data.draft_text });
    return r.data;
  };
  const decide = async (log: Log, decision: string, mode: "ai" | "manual" | "new" | "dismiss") => {
    setBusy(log.id); setPhase("Saving your choice…");
    try {
      let draft = { candidate_id: log.candidate?.id ?? "", draft_text: log.candidate?.draft_text ?? "" };
      if (mode !== "dismiss") draft = await prepare(log);
      const r = await callReview<{ error?: string }>({ action: "decide", bookId, logId: log.id, decision, rationale: note.trim() || (mode === "dismiss" ? "Author reviewed both passages; not a real contradiction." : `Author chose ${mode === "new" ? "the new passage" : "the established detail"} as truth; ${mode} review.`) });
      if (!r.ok) throw new Error(r.data.error ?? "Could not save choice");
      if (mode === "ai") {
        setPhase("Correcting the conflicting passage…");
        const fix = await callReview<{ candidate_id: string; draft_text: string; error?: string }>({ action: "rewrite_conflict", bookId, logId: log.id, candidateId: draft.candidate_id });
        if (!fix.ok) throw new Error(fix.data.error ?? "Could not create a correction");
        updateWork(log.id, { id: fix.data.candidate_id, original: fix.data.draft_text, text: fix.data.draft_text, outcome: "Correction saved. Run checks before accepting it." });
        await check(log, false, { id: fix.data.candidate_id, original: fix.data.draft_text, text: fix.data.draft_text, replace: false, outcome: "" });
      } else if (mode === "manual") updateWork(log.id, { outcome: "Choice saved — edit this section, then run checks." });
      else if (mode === "new") await check(log, false, { id: draft.candidate_id, original: draft.draft_text, text: draft.draft_text, replace: false, outcome: "" });
      else { setSelected(null); toast.success("Marked as not a conflict"); }
      await load(); notify();
    } catch (e) { updateWork(log.id, { outcome: e instanceof Error ? e.message : "Could not complete review" }); toast.error(e instanceof Error ? e.message : "Could not complete review"); await load(); }
    finally { setBusy(""); setPhase(""); }
  };
  const check = async (log: Log, replacement = false, saved?: Work) => {
    const draft = saved ?? work[log.id] ?? (log.candidate ? { id: log.candidate.id, original: log.candidate.draft_text, text: log.candidate.draft_text, replace: false, outcome: "" } : null);
    if (!draft) return;
    setBusy(log.id); setPhase("Checking the full section…");
    try {
      const r = await saveThenAccept(bookId, draft.id, draft.original, draft.text, replacement);
      updateWork(log.id, { id: r.candidateId, original: draft.text });
      if (needsReplaceConfirmation(r.data)) { if (!replacement) return await check(log, true, { ...draft, id: r.candidateId, original: draft.text }); throw new Error("Could not replace the section text."); }
      if (!r.ok) throw new Error(r.data.message ?? r.data.error ?? "Checks did not complete");
      if (r.data.status === "accepted") {
        setPhase("Updating story memory…");
        await runNarrativeExtraction(bookId, log.chapter_index, log.subsection_index);
        onAccepted?.();
        void queryClient.invalidateQueries({ queryKey: ["books"] });
        void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
        updateWork(log.id, { id: "", replace: false, outcome: "Resolved." });
        setSelected(null); toast.success("Conflict resolved — the section is accepted and story memory is updated.");
      } else if (r.data.status === "held") {
        updateWork(log.id, { id: r.data.candidateId ?? draft.id, outcome: "Further issues were found. The section is held; review the new conflict cards or draft findings." });
      } else throw new Error(r.data.error ?? "Review still pending");
      await load(); notify();
    } catch (e) { updateWork(log.id, { outcome: e instanceof Error ? e.message : "Checks failed; text is safe" }); }
    finally { setBusy(""); setPhase(""); }
  };
  const retryAI = async (log: Log) => {
    const id = work[log.id]?.id ?? log.candidate?.id;
    if (!id) return;
    setBusy(log.id); setPhase("Correcting the conflicting passage…");
    try {
      const r = await callReview<{ candidate_id: string; draft_text: string; error?: string }>({ action: "rewrite_conflict", bookId, logId: log.id, candidateId: id });
      if (!r.ok) throw new Error(r.data.error ?? "Correction failed");
      updateWork(log.id, { id: r.data.candidate_id, original: r.data.draft_text, text: r.data.draft_text, outcome: "Correction saved. Run full checks to accept." }); await load();
    } catch (e) { updateWork(log.id, { outcome: e instanceof Error ? e.message : "Correction failed" }); }
    finally { setBusy(""); setPhase(""); }
  };
  const sendChat = async (log: Log) => {
    const text = draft.trim();
    if (!text) return;
    const turns = [...(chat[log.id] ?? []), { role: "author" as const, content: text }];
    setChat((old) => ({ ...old, [log.id]: turns })); setDraft("");
    setBusy(log.id); setPhase("Discussing with the continuity editor…");
    try {
      const r = await callReview<{ reply?: string; edits?: { find: string; replace: string }[]; error?: string }>({ action: "discuss_conflict", bookId, logId: log.id, messages: turns.map((t) => ({ role: t.role, content: t.content })) });
      if (!r.ok || !r.data.reply) throw new Error(r.data.error ?? "The editor could not respond. Try again.");
      setChat((old) => ({ ...old, [log.id]: [...turns, { role: "assistant", content: r.data.reply!, edits: r.data.edits?.length ? r.data.edits : undefined }] }));
    } catch (e) { setChat((old) => ({ ...old, [log.id]: [...turns, { role: "assistant", content: e instanceof Error ? e.message : "The editor could not respond. Try again." }] })); }
    finally { setBusy(""); setPhase(""); }
  };
  const applyChatEdits = async (log: Log, index: number) => {
    const turn = chat[log.id]?.[index];
    if (!turn?.edits?.length) return;
    setBusy(log.id); setPhase("Applying the suggested edits…");
    try {
      const r = await callReview<{ candidate_id: string; draft_text: string; error?: string }>({ action: "apply_conflict_edits", bookId, logId: log.id, edits: turn.edits });
      if (!r.ok) throw new Error(r.data.error ?? "Could not apply the suggestion");
      setChat((old) => ({ ...old, [log.id]: (old[log.id] ?? []).map((t, i) => i === index ? { ...t, applied: true } : t) }));
      if (log.decision === "PENDING") {
        setPhase("Recording your decision…");
        const d = await callReview<{ error?: string }>({ action: "decide", bookId, logId: log.id, decision: "KEEP_CANON_REVISE_PROSE", rationale: "Author agreed an editorial fix in discussion: " + turn.content.slice(0, 1500) });
        if (!d.ok) throw new Error(d.data.error ?? "Could not record your decision");
      }
      const saved = { id: r.data.candidate_id, original: r.data.draft_text, text: r.data.draft_text, replace: false, outcome: "" };
      updateWork(log.id, saved);
      setBusy(""); await check(log, false, saved);
      return;
    } catch (e) { updateWork(log.id, { outcome: e instanceof Error ? e.message : "Could not apply the suggestion" }); }
    finally { setBusy(""); setPhase(""); }
  };
  const evidenceCard = (log: Log, side: "prior" | "new", detailed = false) => {
    const e = side === "prior" ? log.prior : log.newer;
    const isOpen = expanded.includes(side);
    const recommended = log.recommendation.choice === side;
    return <div className={`min-w-0 rounded-lg border p-4 space-y-3 ${side === "prior" ? "border-primary/40 bg-primary/5" : "border-destructive/30 bg-destructive/5"}`}>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs uppercase tracking-wider font-semibold">{side === "prior" ? "Established detail" : "New passage"}</span>{recommended && <Badge variant="outline" className="border-primary/40 text-primary">Suggested truth</Badge>}</div>
      <Button variant="ghost" className="h-auto w-full whitespace-normal text-left justify-start px-0 py-1 font-normal leading-relaxed" onClick={() => detailed ? setExpanded((old) => old.includes(side) ? old.filter((s) => s !== side) : [...old, side]) : open(log, side)} aria-expanded={detailed ? isOpen : undefined}>
        <span className="flex-1 break-words">{summary(e.summary)}</span><ChevronDown className={`w-4 h-4 shrink-0 ml-2 ${isOpen ? "rotate-180" : ""}`} />
      </Button>
      <Source evidence={e} />
      {detailed && isOpen && <div className="border-t border-border pt-3 space-y-2"><p className="text-xs text-muted-foreground">{e.location?.chapterTitle}{e.location?.sectionTitle ? ` — ${e.location.sectionTitle}` : ""}</p><blockquote className="text-sm leading-relaxed whitespace-pre-wrap break-words border-l-2 border-primary/50 pl-3">{e.paragraph || e.summary}</blockquote>{!e.paragraph && <p className="text-xs text-muted-foreground">Only the recorded quotation is available; the full paragraph could not be located.</p>}</div>}
    </div>;
  };
  if (!logs.length && !error) return null;
  return <section className="mb-4 px-4 md:px-0 space-y-3" aria-label="Story conflict review">
    <div className="flex items-center flex-wrap gap-2"><AlertTriangle className="w-5 h-5 text-destructive" /><h2 className="font-semibold">Story review</h2>{pending.length > 0 && <Badge variant="destructive">{pending.length} awaiting your choice</Badge>}{unfinished.length > 0 && <Badge variant="outline">{unfinished.length} awaiting checks</Badge>}<Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Refresh conflicts"><RefreshCw className="w-4 h-4" /></Button>{done.length > 0 && <Button size="sm" variant="ghost" onClick={() => setHistory(!history)}>{history ? "Hide" : "Show"} reviewed ({done.length})</Button>}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error} <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></p>}
    {(history ? [...active, ...done] : active).slice(0, 20).map((log) => <div key={log.id} className="space-y-3 border-b border-border pb-4">
      <div className="flex justify-between items-center gap-2"><p className="text-sm font-medium">Chapter {log.chapter_index + 1}, Section {log.subsection_index + 1}</p>{log.decision !== "PENDING" && <Badge variant="outline">{log.candidate ? "Needs checks" : log.decision === "DISMISS" ? "Dismissed by you" : log.memorySynced ? "Resolved · memory updated" : "Choice recorded"}</Badge>}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{evidenceCard(log, "prior")}{evidenceCard(log, "new")}</div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground flex-1 min-w-0"><ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-primary" />{log.recommendation.reason}</p><Button size="sm" variant="outline" onClick={() => open(log)}>Review conflict<ArrowRight className="w-3.5 h-3.5 ml-1" /></Button></div>
    </div>)}
    <Dialog open={!!selected} onOpenChange={(v) => { if (!v && !busy) setSelected(null); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }} onInteractOutside={(e) => { if (busy) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Two versions of the same detail</DialogTitle></DialogHeader>
        {selected && <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{evidenceCard(selected, "prior", true)}{evidenceCard(selected, "new", true)}</div>
          <div className="space-y-2"><h3 className="font-semibold text-sm">Why this was flagged</h3><p className="text-sm leading-relaxed text-muted-foreground">{selected.description}</p></div>
          <div className="border-l-2 border-primary pl-3"><p className="text-sm font-medium">Recommendation</p><p className="text-sm text-muted-foreground">{selected.recommendation.reason}</p></div>
          {selected.decision === "PENDING" ? <>
            <Textarea aria-label="Reason for your choice" placeholder="Optional: explain your choice" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><p className="text-sm font-medium">Keep established detail</p><Button className="w-full whitespace-normal h-auto py-2" disabled={!!busy || selected.prior.source === "unknown"} onClick={() => void decide(selected, "KEEP_CANON_REVISE_PROSE", "ai")}><Sparkles className="w-4 h-4 mr-2 shrink-0" />AI correction now</Button><Button variant="outline" className="w-full" disabled={!!busy} onClick={() => void decide(selected, "KEEP_CANON_REVISE_PROSE", "manual")}><Pencil className="w-4 h-4 mr-2" />I’ll edit it myself</Button></div>
              <div className="space-y-2"><p className="text-sm font-medium">Keep new passage</p><Button variant="secondary" className="w-full whitespace-normal h-auto py-2" disabled={!!busy} onClick={() => void decide(selected, "ACCEPT_PROSE_UPDATE_CANON", "new")}><CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />Select new text as truth</Button><Button variant="ghost" className="w-full" disabled={!!busy} onClick={() => void decide(selected, "DISMISS", "dismiss")}>Both can be true — dismiss</Button></div>
            </div>
            <p className="text-xs text-muted-foreground">AI corrections and checks use your book’s models and may cost credits. Nothing replaces accepted text without confirmation.</p>
          </> : <>
            <p className="text-sm font-medium">{selected.decision === "KEEP_CANON_REVISE_PROSE" ? "Established detail selected" : selected.decision === "DISMISS" ? "Dismissed by you" : "New passage selected"}</p>
            {(w?.id || selected.candidate) && <>
              <Textarea aria-label="Section correction" className="min-h-[220px] text-sm leading-relaxed" value={w?.text ?? selected.candidate?.draft_text ?? ""} onChange={(e) => updateWork(selected.id, { id: w?.id ?? selected.candidate?.id ?? "", original: w?.original ?? selected.candidate?.draft_text ?? "", text: e.target.value })} maxLength={60000} disabled={!!busy} />
              <div className="flex flex-wrap gap-2"><Button disabled={!!busy} onClick={() => void check(selected)}><ShieldCheck className="w-4 h-4 mr-2" />Run checks & accept</Button>{selected.decision === "KEEP_CANON_REVISE_PROSE" && <Button variant="outline" disabled={!!busy || selected.prior.source === "unknown"} onClick={() => void retryAI(selected)}><Sparkles className="w-4 h-4 mr-2" />AI correction</Button>}</div>
            </>}
            {w?.replace && <div className="border border-primary/40 rounded-lg p-3 space-y-2"><p className="text-sm">Replace the accepted text in this section? Later story memory may need review.</p><div className="flex flex-wrap gap-2"><Button disabled={!!busy} onClick={() => void check(selected, true)}>Replace after full checks</Button><Button variant="outline" disabled={!!busy} onClick={() => updateWork(selected.id, { replace: false, outcome: "Current manuscript kept. The correction is saved for later review." })}>Keep current manuscript</Button></div></div>}
            {!selected.candidate && selected.memorySynced && <p className="text-sm text-primary flex gap-2 items-center"><CheckCircle2 className="w-4 h-4" />Resolved — accepted text and story memory are up to date.</p>}
            {!selected.candidate && selected.accepted && !selected.memorySynced && selected.decision !== "DISMISS" && <Button variant="outline" disabled={!!busy} onClick={async () => { setBusy(selected.id); setPhase("Updating story memory…"); try { await runNarrativeExtraction(bookId, selected.chapter_index, selected.subsection_index); await load(); notify(); } catch (e) { updateWork(selected.id, { outcome: e instanceof Error ? e.message : "Memory update failed. Your accepted text is safe; try again." }); } finally { setBusy(""); setPhase(""); } }}>Retry story memory update</Button>}
          </>}
          <div className="border border-border rounded-lg p-3 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" />Discuss with the editor</p>
            {(chat[selected.id] ?? []).length > 0 && <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {(chat[selected.id] ?? []).map((t, i) => <div key={i} className={`rounded-lg p-2.5 text-sm leading-relaxed ${t.role === "author" ? "bg-primary/10 ml-8" : "bg-muted mr-8"}`}>
                <p className="whitespace-pre-wrap break-words">{t.content}</p>
                {t.edits && <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t.applied ? "Suggestion applied" : `${t.edits.length} suggested edit${t.edits.length > 1 ? "s" : ""}`}</Badge>
                  {!t.applied && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void applyChatEdits(selected, i)}><Sparkles className="w-3.5 h-3.5 mr-1" />Apply suggestion</Button>}
                </div>}
              </div>)}
            </div>}
            <div className="flex gap-2 items-end">
              <Textarea aria-label="Your thought or question" placeholder="Share your take — e.g. “she pauses only when stressed; merge both” — and the editor will suggest a fix." value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={2} disabled={!!busy} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(selected); } }} />
              <Button size="icon" aria-label="Send" disabled={!!busy || !draft.trim()} onClick={() => void sendChat(selected)}><Send className="w-4 h-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">Discussion uses your book’s models and may cost credits. Suggestions only change text after you apply them and run checks.</p>
          </div>
          {busy && <div role="status" aria-live="polite" className="flex gap-2 items-center text-sm text-primary"><Loader2 className="w-4 h-4 animate-spin" />{phase}</div>}
          {w?.outcome && <p role="status" className="text-sm leading-relaxed border-l-2 border-primary pl-3">{w.outcome}</p>}
          {pending.filter((l) => l.id !== selected.id).length > 0 && <div className="border-t border-border pt-3 space-y-2"><p className="text-sm font-medium">Other conflicts to review</p>{pending.filter((l) => l.id !== selected.id).map((l) => <Button key={l.id} variant="outline" className="w-full whitespace-normal h-auto py-2 text-left justify-start" onClick={() => open(l)}>{summary(l.description)}<ArrowRight className="w-4 h-4 shrink-0 ml-auto" /></Button>)}</div>}
        </div>}
      </DialogContent>
    </Dialog>
  </section>;
}
