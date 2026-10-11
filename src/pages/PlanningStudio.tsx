import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Pause, Play, PenLine, Settings2, Users, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { callPlanBook, callReview } from "@/lib/candidateReview";
import { runNarrativeExtraction } from "@/lib/narrativeExtraction";
import BookSetupTab from "@/components/BookSetupTab";
import IdentityReviewPanel from "@/components/IdentityReviewPanel";
import { adapterForBookType } from "../../supabase/functions/_shared/narrative/planning/adapters";

type Row = Record<string, any>;
const COUNTS = [3, 5, 7, 10];

export default function PlanningStudio() {
  const { bookId = "" } = useParams();
  const [book, setBook] = useState<Row | null>(null);
  const [plans, setPlans] = useState<{ masters: Row[]; plans: Row[] }>({ masters: [], plans: [] });
  const [review, setReview] = useState<{ candidates: Row[]; logs: Row[]; findings: Row[] }>({ candidates: [], logs: [], findings: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState("setup");
  const [carry, setCarry] = useState<{ chapterCount: number; targetWords: number } | null>(null);
  const navigate = useNavigate();

  const isFiction = useMemo(() => { try { return book ? adapterForBookType(book.book_type).isFiction : true; } catch { return true; } }, [book]);

  const refresh = useCallback(async () => {
    const { data: b } = await supabase.from("books").select("id, title, book_type, theme, controls, outline, story_setup, word_count").eq("id", bookId).maybeSingle();
    setBook(b);
    const [p, r] = await Promise.all([callPlanBook({ action: "status", bookId }), callReview({ action: "status", bookId })]);
    if (p.ok) setPlans({ masters: p.data.masters ?? [], plans: p.data.plans ?? [] });
    if (r.ok) setReview(r.data);
  }, [bookId]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(null); }
  };

  if (!book) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  const progressive = (book.controls as Row)?.planning_pipeline === "progressive";
  const openCount = review.candidates.length + review.logs.filter((l) => l.decision === "PENDING").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="h-16 border-b border-border flex items-center gap-3 px-4 md:px-8">
        <Link to="/dashboard" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="min-w-0">
          <h1 className="font-display text-lg truncate">{book.title}</h1>
          <p className="text-xs text-muted-foreground">Planning Studio</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground hidden sm:inline">Progressive Planning</span>
          <Switch checked={progressive} disabled={!!busy} onCheckedChange={(on) => run("toggle", async () => {
            const controls = { ...(book.controls ?? {}), planning_pipeline: on ? "progressive" : "standard" };
            const { error } = await supabase.from("books").update({ controls }).eq("id", bookId);
            if (error) throw error; toast.success(on ? "Progressive Planning is on for this book" : "Back to standard writing"); await refresh();
          })} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-6">
        <ol className="flex flex-wrap gap-2 text-xs mb-4">
          {[["Idea & story", "setup"], ["Whole-book summary", "plan"], ["Chapter summaries", "plan"], ["Section summaries", "plan"], ["Approve", "plan"], ["Write", "plan"]].map(([s, t], i) => (
            <li key={s}><button onClick={() => setTab(t)} className={`px-3 py-1 rounded-full border ${tab === t ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}>{i + 1}. {s}</button></li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2 mb-6">
          <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/${bookId}?settings=1`)}><Settings2 className="w-4 h-4 mr-1" />Writer & book settings</Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/personas")}><Users className="w-4 h-4 mr-1" />Personas</Button>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="review">Review {openCount > 0 && <Badge variant="destructive" className="ml-2">{openCount}</Badge>}</TabsTrigger>
            <TabsTrigger value="memory">Story memory</TabsTrigger>
          </TabsList>
          <TabsContent value="setup"><BookSetupTab book={book} isFiction={isFiction} onSaved={refresh} onContinue={(o) => { setCarry(o); setTab("plan"); window.scrollTo(0, 0); }} /></TabsContent>
          <TabsContent value="plan"><PlanTab key={carry ? `${carry.chapterCount}-${carry.targetWords}` : "p"} book={book} carry={carry} isFiction={isFiction} plans={plans} busy={busy} run={run} refresh={refresh} /></TabsContent>
          <TabsContent value="review"><div className="space-y-6"><ReviewTab bookId={bookId} review={review} busy={busy} run={run} refresh={refresh} /><IdentityReviewPanel bookId={bookId} /></div></TabsContent>
          <TabsContent value="memory"><MemoryTab bookId={bookId} busy={busy} run={run} /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

type RunFn = (label: string, fn: () => Promise<void>) => Promise<void>;

function PlanTab({ book, carry, isFiction, plans, busy, run, refresh }: { book: Row; carry: { chapterCount: number; targetWords: number } | null; isFiction: boolean; plans: { masters: Row[]; plans: Row[] }; busy: string | null; run: RunFn; refresh: () => Promise<void> }) {
  const setup = (book.story_setup ?? {}) as Row;
  const picked = Number.isInteger(setup.selectedIndex) ? setup.alternatives?.[setup.selectedIndex] : null;
  const [premise, setPremise] = useState<string>(picked ? `${picked.title}: ${picked.logline}` : setup.premise || book.theme || "");
  const [targetWords, setTargetWords] = useState(carry?.targetWords ?? 50000);
  const [chapterCount, setChapterCount] = useState(carry?.chapterCount ?? 12);
  const navigate = useNavigate();
  const [count, setCount] = useState(3);
  const [options, setOptions] = useState<Row[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; paused: boolean } | null>(null);
  const pauseRef = useRef(false);
  const master = plans.masters.find((m) => m.status === "APPROVED") ?? plans.masters.find((m) => m.status === "DRAFT");
  const mine = plans.plans.filter((p) => master && p.master_plan_id === master.id);
  const has = (level: string, ch: number) => mine.some((p) => p.plan_level === level && p.chapter_index === ch);
  const chapters = [...new Set(mine.filter((p) => p.plan_level === "CHAPTER").map((p) => p.chapter_index))].sort((a, b) => a - b);
  const brief = { premise, targetWords, chapterCount };

  const generateOptions = () => run("options", async () => {
    const r = await callPlanBook({ action: isFiction ? "alternatives" : "concepts", bookId: book.id, count, ...brief });
    if (!r.ok) throw new Error(r.data.error === "PLAN_INVALID" ? "The options didn't pass checks; try again." : r.data.error);
    setOptions(isFiction ? r.data.alternatives : r.data.concepts); setChosen(null);
  });
  const createMaster = () => run("master", async () => {
    const extra = chosen === null ? {} : isFiction ? { alternatives: options, selectedIndex: chosen } : { concept: options[chosen] };
    const r = await callPlanBook({ action: "master", bookId: book.id, requestId: crypto.randomUUID(), ...brief, ...extra });
    if (!r.ok) throw new Error(r.data.error ?? "Master plan failed");
    toast.success("Master plan drafted — review and approve it"); await refresh();
  });
  const planAll = () => run("auto", async () => {
    if (!master) return;
    pauseRef.current = false;
    const total = (master.plan_skeleton?.chapters?.length ?? chapterCount) * 3 + 1; let done = 0;
    setProgress({ done, total, paused: false });
    const step = async (body: Row) => { while (pauseRef.current) await new Promise((r) => setTimeout(r, 400)); const r = await callPlanBook({ bookId: book.id, masterPlanId: master.id, requestId: `auto-${master.id}`, ...body }); if (!r.ok && r.status !== 207) throw new Error(r.data.error ?? "Planning step failed"); setProgress({ done: ++done, total, paused: false }); };
    await step({ action: "chapters" }); // checkpointed: already-expanded chapters are skipped
    const st = await callPlanBook({ action: "status", bookId: book.id });
    const rows: Row[] = (st.data.plans ?? []).filter((p: Row) => p.master_plan_id === master.id);
    const chs = [...new Set(rows.filter((p) => p.plan_level === "CHAPTER").map((p) => p.chapter_index))].sort((a, b) => a - b);
    for (const ch of chs) {
      if (!rows.some((p) => p.plan_level === "SECTION" && p.chapter_index === ch)) await step({ action: "sections", chapter: ch }); else setProgress({ done: ++done, total, paused: false });
      if (!rows.some((p) => p.plan_level === "BEATS" && p.chapter_index === ch)) await step({ action: "beats", chapter: ch }); else setProgress({ done: ++done, total, paused: false });
    }
    toast.success("Planning finished — review and approve"); setProgress(null); await refresh();
  });

  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Concept</CardTitle>
          <CardDescription>{isFiction ? "Optional: compare complete story alternatives (with their twists), or go straight to a master plan from your own premise." : "Optional: compare different approaches to this book, or go straight to a master plan from your own concept."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={premise} onChange={(e) => setPremise(e.target.value)} rows={4} placeholder="Your premise or concept" />
          <div className="flex flex-wrap gap-3 items-center text-sm">
            <label className="flex items-center gap-2">Words <Input type="number" className="w-28" value={targetWords} onChange={(e) => setTargetWords(Number(e.target.value))} /></label>
            <label className="flex items-center gap-2">Chapters <Input type="number" className="w-20" value={chapterCount} onChange={(e) => setChapterCount(Number(e.target.value))} /></label>
            <div className="flex items-center gap-1">{COUNTS.map((c) => <Button key={c} size="sm" variant={count === c ? "default" : "outline"} onClick={() => setCount(c)}>{c}</Button>)}</div>
            <Button variant="outline" onClick={generateOptions} disabled={!!busy}>{busy === "options" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}{isFiction ? "Generate story alternatives" : "Generate book concepts"}</Button>
          </div>
          {options.length > 0 && (
            <div className="grid md:grid-cols-2 gap-3">
              {options.map((o, i) => (
                <button key={i} onClick={() => setChosen(chosen === i ? null : i)} className={`text-left p-4 rounded-lg border transition-colors ${chosen === i ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                  <p className="font-medium">{o.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{isFiction ? o.logline : o.coreThesis}</p>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-6 whitespace-pre-line">{o.summary}</p>
                  {isFiction ? <p className="text-xs mt-2"><span className="text-primary">Twist:</span> {o.twist}</p> : <p className="text-xs mt-2"><span className="text-primary">Reader gains:</span> {o.readerOutcome}</p>}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Master plan</CardTitle>
          <CardDescription>{chosen !== null ? `Built from option ${chosen + 1}.` : "Built from your premise above."} Plans never count as story canon — only accepted text does.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={createMaster} disabled={!!busy || !premise.trim()}>{busy === "master" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Draft master plan</Button>
          {plans.masters.map((m) => (
            <div key={m.id} className="flex items-center gap-3 text-sm border border-border rounded-md px-3 py-2">
              <span>Version {m.version}</span><Badge variant={m.status === "APPROVED" ? "default" : "outline"}>{m.status}</Badge>
              {m.status === "DRAFT" && <Button size="sm" className="ml-auto" disabled={!!busy} onClick={() => run("approve", async () => { const r = await callPlanBook({ action: "approve_master", planId: m.id }); if (!r.ok) throw new Error(r.data.error); toast.success("Master plan approved"); await refresh(); })}>Approve</Button>}
            </div>
          ))}
        </CardContent>
      </Card>

      {master && (
        <Card>
          <CardHeader>
            <CardTitle>3. Chapters, sections and beats</CardTitle>
            <CardDescription>Plan step by step, or let the planner run through the whole book. It resumes where it stopped.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={planAll} disabled={!!busy}>{busy === "auto" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Plan the whole book</Button>
              {progress && <Button variant="outline" onClick={() => { pauseRef.current = !pauseRef.current; setProgress({ ...progress, paused: pauseRef.current }); }}>{progress.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</Button>}
              <Button variant="outline" disabled={!!busy || !mine.some((p) => p.plan_status === "PLANNED")} onClick={() => run("approveAll", async () => {
                const r = await callPlanBook({ action: "approve_plans", ids: mine.filter((p) => p.plan_status === "PLANNED").map((p) => p.id) }); if (!r.ok) throw new Error(r.data.error); toast.success(`${r.data.approved} plans approved`); await refresh();
              })}>4. Approve all planned</Button>
            </div>
            {progress && <Progress value={(progress.done / progress.total) * 100} />}
            <div className="divide-y divide-border border border-border rounded-md">
              {chapters.length === 0 && <p className="p-3 text-sm text-muted-foreground">No chapters expanded yet.</p>}
              {chapters.map((ch) => (
                <div key={ch} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <span className="font-medium w-24">Chapter {ch + 1}</span>
                  {["CHAPTER", "SECTION", "BEATS"].map((lv) => {
                    const rows = mine.filter((p) => p.plan_level === lv && p.chapter_index === ch);
                    const ready = rows.length && rows.every((p) => p.plan_status === "READY");
                    return <Badge key={lv} variant={ready ? "default" : rows.length ? "secondary" : "outline"}>{lv.toLowerCase()} {ready ? "approved" : rows.length ? "planned" : "—"}</Badge>;
                  })}
                  <div className="ml-auto flex gap-2">
                    {!has("SECTION", ch) && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("sec", async () => { const r = await callPlanBook({ action: "sections", bookId: book.id, masterPlanId: master.id, chapter: ch, requestId: crypto.randomUUID() }); if (!r.ok) throw new Error(r.data.error); await refresh(); })}>Plan sections</Button>}
                    {has("SECTION", ch) && !has("BEATS", ch) && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("beats", async () => { const r = await callPlanBook({ action: "beats", bookId: book.id, masterPlanId: master.id, chapter: ch, requestId: crypto.randomUUID() }); if (!r.ok) throw new Error(r.data.error); await refresh(); })}>Plan beats</Button>}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">5. Once approved and Progressive Planning is on, write from the book page. Each section is checked before it is accepted; anything held shows up under Review.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const DECISIONS: { value: string; label: string; help: string }[] = [
  { value: "KEEP_CANON_REVISE_PROSE", label: "Keep the story as it is", help: "The draft must be corrected before it can be accepted." },
  { value: "ACCEPT_PROSE_UPDATE_CANON", label: "Adopt the change", help: "Takes effect only after the draft passes checks, is accepted and story memory updates." },
  { value: "DISMISS", label: "Not a real conflict", help: "Records that this flag was mistaken." },
];

function ReviewTab({ bookId, review, busy, run, refresh }: { bookId: string; review: { candidates: Row[]; logs: Row[]; findings: Row[] }; busy: string | null; run: RunFn; refresh: () => Promise<void> }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const decide = (logId: string, decision: string) => run(`d-${logId}`, async () => {
    const r = await callReview({ action: "decide", logId, decision, rationale: why[logId] || DECISIONS.find((d) => d.value === decision)!.label });
    if (!r.ok) throw new Error(r.data.error); await refresh();
  });
  return (
    <div className="space-y-6 mt-4">
      {review.candidates.length === 0 && <p className="text-sm text-muted-foreground">No drafts are waiting for you.</p>}
      {review.candidates.map((c) => {
        const logs = review.logs.filter((l) => l.candidate_id === c.id);
        const pending = logs.some((l) => l.decision === "PENDING");
        const text = edits[c.id] ?? c.draft_text;
        return (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-destructive" />Chapter {c.chapter_index + 1}, section {c.subsection_index + 1} — held draft (attempt {c.attempt_count})</CardTitle>
              <CardDescription>{c.validation_status === "BLOCKED_MATERIAL" ? "This draft conflicts with your story. Decide each conflict, then accept a corrected or approved version." : "Checks need your review before this draft can be accepted."} Your accepted manuscript is unchanged.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(c.findings as Row[]).filter((f) => f.severity !== "info").map((f, i) => (
                <div key={i} className="text-sm border-l-2 border-primary pl-3">
                  <p><Badge variant="outline" className="mr-2">Stage {f.stage ?? "?"}</Badge>{f.message}</p>
                  {f.excerpt && <p className="text-xs text-muted-foreground mt-1 italic">“{f.excerpt}”</p>}
                  {f.sourceRef && <p className="text-xs text-muted-foreground">Source: {f.sourceRef}</p>}
                </div>
              ))}
              {logs.map((l) => (
                <div key={l.id} className="rounded-md border border-border p-3 space-y-2 text-sm">
                  <p className="font-medium">{l.description}</p>
                  {l.prose_excerpt && <p className="text-xs italic text-muted-foreground">“{l.prose_excerpt}”</p>}
                  {l.decision === "PENDING" ? (
                    <>
                      <Input placeholder="Why (optional)" value={why[l.id] ?? ""} onChange={(e) => setWhy({ ...why, [l.id]: e.target.value })} />
                      <div className="flex flex-wrap gap-2">{DECISIONS.map((d) => <Button key={d.value} size="sm" variant="outline" title={d.help} disabled={!!busy} onClick={() => decide(l.id, d.value)}>{d.label}</Button>)}</div>
                    </>
                  ) : <p className="text-xs"><CheckCircle2 className="w-3 h-3 inline mr-1" />{DECISIONS.find((d) => d.value === l.decision)?.label} {l.application_status === "PENDING_APPLICATION" && "— waiting for acceptance"}</p>}
                </div>
              ))}
              <Textarea rows={10} value={text} onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={!!busy || pending} onClick={() => run(`a-${c.id}`, async () => {
                  const r = await callReview({ action: "accept", bookId, candidateId: c.id, editedText: edits[c.id] && edits[c.id] !== c.draft_text ? edits[c.id] : undefined });
                  if (r.data.status === "accepted") {
                    toast.success("Accepted — updating story memory");
                    await runNarrativeExtraction(bookId, c.chapter_index, c.subsection_index);
                  } else if (r.data.status === "held") toast.warning("Still not passing checks — see the new findings");
                  else throw new Error(r.data.message ?? r.data.error ?? "Could not accept");
                  await refresh();
                })}>{busy === `a-${c.id}` && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Check & accept</Button>
                <Button variant="outline" disabled={!!busy} onClick={() => run(`x-${c.id}`, async () => { const r = await callReview({ action: "discard", candidateId: c.id }); if (!r.ok) throw new Error(r.data.error); await refresh(); })}>Discard draft</Button>
              </div>
              {pending && <p className="text-xs text-muted-foreground">Decide every conflict above before accepting.</p>}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader><CardTitle className="text-base">Editorial notes</CardTitle><CardDescription>Advisory notes on accepted text. These never block writing.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {review.findings.length === 0 && <p className="text-sm text-muted-foreground">Nothing open.</p>}
          {review.findings.map((f) => (
            <div key={f.id} className="flex items-start gap-3 text-sm border-b border-border pb-2">
              <div className="flex-1"><p>{f.message}</p>{f.excerpt && <p className="text-xs italic text-muted-foreground">“{f.excerpt}”</p>}
                {f.details?.proposed_text && <details className="text-xs mt-1"><summary className="cursor-pointer text-primary">Proposed correction</summary><p className="whitespace-pre-line mt-1">{f.details.proposed_text}</p></details>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => run(`f-${f.id}`, async () => { const { error } = await supabase.from("editorial_validation_findings").update({ status: "DISMISSED" }).eq("id", f.id); if (error) throw error; await refresh(); })}>Dismiss</Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MemoryTab({ bookId, busy, run }: { bookId: string; busy: string | null; run: RunFn }) {
  const [ch, setCh] = useState(1); const [sub, setSub] = useState(1);
  const [radius, setRadius] = useState<Row | null>(null);
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Before rewriting an earlier section</CardTitle>
        <CardDescription>See what later text and story memory depend on it. Rewriting never deletes later accepted text; memory built from it is set aside until you confirm or re-check it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          Chapter <Input type="number" min={1} className="w-20" value={ch} onChange={(e) => setCh(Number(e.target.value))} />
          Section <Input type="number" min={1} className="w-20" value={sub} onChange={(e) => setSub(Number(e.target.value))} />
          <Button variant="outline" disabled={!!busy} onClick={() => run("radius", async () => { const r = await callReview({ action: "blast_radius", bookId, chapter: ch - 1, subsection: sub - 1 }); if (!r.ok) throw new Error(r.data.error); setRadius(r.data); })}>Show what depends on it</Button>
          <Button variant="outline" disabled={!!busy} onClick={() => run("confirm", async () => { const r = await callReview({ action: "confirm_memory", bookId, chapter: ch - 1, subsection: sub - 1 }); if (!r.ok) throw new Error(r.data.error); toast.success(`${r.data.reestablished} memory items confirmed`); })}>I've checked this section — confirm its memory</Button>
        </div>
        {radius && (
          <ul className="grid sm:grid-cols-2 gap-1">
            <li>Later accepted sections: <b>{radius.accepted_downstream_sections}</b></li>
            <li>Facts: <b>{radius.facts}</b> · Events: <b>{radius.events}</b></li>
            <li>Character states: <b>{radius.states}</b> · Timeline: <b>{radius.timeline}</b></li>
            <li>Plot threads: <b>{radius.threads}</b> · Exact details: <b>{radius.anchors}</b></li>
            {(radius.characters_carried_forward ?? []).length > 0 && <li className="sm:col-span-2">Characters carried forward: {(radius.characters_carried_forward as string[]).join(", ")}</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
