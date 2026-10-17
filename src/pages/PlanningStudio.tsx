import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
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
import { bulkApprovableIds } from "../../supabase/functions/_shared/narrative/planning/blueprint.ts";
import { callPlanBook, callReview, needsReplaceConfirmation, saveThenAccept } from "@/lib/candidateReview";
import { runNarrativeExtraction } from "@/lib/narrativeExtraction";
import BookSetupTab from "@/components/BookSetupTab";
import IdentityReviewPanel from "@/components/IdentityReviewPanel";
import { WriterPicker } from "@/components/WriterPicker";
import { ModelConfigCard } from "@/components/ModelConfigCard";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { bestWriterFor } from "../../supabase/functions/_shared/writers/personas";
import { adapterForBookType } from "../../supabase/functions/_shared/narrative/planning/adapters";
import { buildOutlineFromPlans } from "@/lib/planToOutline";

type Row = Record<string, any>;

// Writer & voice step inside the continuous flow — same picker and locked profiles as Book Settings.
function WriterStep({ book, onBack, onNext, onSaved }: { book: Row; onBack: () => void; onNext: () => void; onSaved: () => void }) {
  const [writerId, setWriterId] = useState<string | undefined>(book.controls?.writerId);
  const save = async (id: string) => {
    const prev = writerId; setWriterId(id);
    const { error } = await supabase.from("books").update({ controls: { ...(book.controls ?? {}), writerId: id } }).eq("id", book.id);
    if (error) { setWriterId(prev); toast.error("Couldn't change the writer."); return; }
    toast.success("Writer chosen"); onSaved();
  };
  return (
    <div className="space-y-6 mt-4">
      <Card><CardHeader><CardTitle>Virtual writer</CardTitle><CardDescription>The author whose voice shapes every section. Fine-tune the 15 style controls any time in Writer & book settings.</CardDescription></CardHeader>
        <CardContent><WriterPicker bookType={book.book_type} value={writerId} onChange={save} /></CardContent></Card>
      <ModelConfigCard bookId={book.id} writerId={writerId ?? bestWriterFor(book.book_type).id} />
      <div className="flex items-center gap-2 sticky bottom-0 bg-background py-3 border-t border-border z-10">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
        <Button className="ml-auto" onClick={onNext}>Next: Chapter & section summaries<ArrowRight className="w-4 h-4 ml-1" /></Button>
      </div>
    </div>
  );
}
const COUNTS = [3, 5, 7, 10];

export default function PlanningStudio() {
  const { bookId = "" } = useParams();
  const [book, setBook] = useState<Row | null>(null);
  const [plans, setPlans] = useState<{ masters: Row[]; plans: Row[] }>({ masters: [], plans: [] });
  const [review, setReview] = useState<{ candidates: Row[]; logs: Row[]; findings: Row[] }>({ candidates: [], logs: [], findings: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState("setup");
  const [dir, setDir] = useState(1);
  const ORDER = ["setup", "writer", "plan", "review", "memory"];
  const goTab = (t: string) => { setDir(ORDER.indexOf(t) >= ORDER.indexOf(tab) ? 1 : -1); setTab(t); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const [carry, setCarry] = useState<{ chapterCount: number; targetWords: number } | null>(null);
  const [liveTitleState, setLiveTitle] = useState<string | null>(null);
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
  const liveTitle = liveTitleState;
  const openCount = review.candidates.length + review.logs.filter((l) => l.decision === "PENDING").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="h-16 border-b border-border flex items-center gap-3 px-4 md:px-8">
        <Link to="/dashboard" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="min-w-0">
          <h1 className="font-display text-lg truncate">{liveTitle ?? book.title}</h1>
          <p className="text-xs text-muted-foreground">Planning Studio</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground hidden sm:inline">Progressive Planning</span>
          <TooltipProvider delayDuration={150}><Tooltip><TooltipTrigger asChild>
            <button type="button" aria-label="What is Progressive Planning?" className="text-muted-foreground hover:text-primary"><Info className="w-4 h-4" /></button>
          </TooltipTrigger><TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
            Plan your book before writing: start with the big idea, then shape the chapters and scenes. As you write, the app checks for mixed-up details and keeps twists for the right moment. You review drafts that need attention. Turn this off to write one section at a time without this planning flow.
          </TooltipContent></Tooltip></TooltipProvider>
          <Switch checked={progressive} disabled={!!busy} onCheckedChange={(on) => run("toggle", async () => {
            const controls = { ...(book.controls ?? {}), planning_pipeline: on ? "progressive" : "standard", ...(on && !(book.controls as Row)?.planning_pipeline ? { blueprint_mode: "required" } : {}) };
            const { error } = await supabase.from("books").update({ controls }).eq("id", bookId);
            if (error) throw error; toast.success(on ? "Progressive Planning is on for this book" : "Back to standard writing"); await refresh();
          })} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-6">
        <ol className="flex flex-wrap gap-2 text-xs mb-4">
          {[["Idea, story & cast", "setup"], ["Writer & voice", "writer"], ["Chapter & section summaries", "plan"], ["Review", "review"], ["Story memory", "memory"]].map(([s, t], i) => (
            <li key={s}><button onClick={() => goTab(t)} className={`px-3 py-1 rounded-full border transition-colors ${tab === t ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{i + 1}. {s}{t === "review" && openCount > 0 ? ` (${openCount})` : ""}</button></li>
          ))}
        </ol>
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={tab} custom={dir} initial={{ opacity: 0, x: dir * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -60 }} transition={{ duration: 0.3, ease: "easeOut" }}>
            {tab === "setup" && <BookSetupTab book={book} isFiction={isFiction} onSaved={refresh} onTitleChange={setLiveTitle} onContinue={(o) => { setCarry(o); goTab("writer"); }} />}
            {tab === "writer" && <WriterStep book={book} onBack={() => goTab("setup")} onNext={() => goTab("plan")} onSaved={refresh} />}
            {tab === "plan" && <div className="space-y-2">
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => goTab("writer")}><ArrowLeft className="w-4 h-4 mr-1" />Back to writer & voice</Button>
              <PlanTab key={`${carry ? `${carry.chapterCount}-${carry.targetWords}` : "p"}-${(book.story_setup as Row)?.selectedIndex ?? "n"}-${(book.story_setup as Row)?.updatedAt ?? ""}`} book={book} carry={carry} isFiction={isFiction} plans={plans} busy={busy} run={run} refresh={refresh} />
            </div>}
            {tab === "review" && <div className="space-y-6"><ReviewTab bookId={bookId} review={review} busy={busy} run={run} refresh={refresh} /><IdentityReviewPanel bookId={bookId} /></div>}
            {tab === "memory" && <MemoryTab bookId={bookId} busy={busy} run={run} />}
          </motion.div>
        </AnimatePresence>
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
  const [progress, setProgress] = useState<{ done: number; total: number; paused: boolean } | null>(null);
  const pauseRef = useRef(false);
  // Continuous flow: approving the whole-book summary goes straight on to chapter and section summaries.
  const [autoNext, setAutoNext] = useState(false);
  const master = plans.masters.find((m) => m.status === "APPROVED") ?? plans.masters.find((m) => m.status === "DRAFT");
  const mine = plans.plans.filter((p) => master && p.master_plan_id === master.id);
  const has = (level: string, ch: number) => mine.some((p) => p.plan_level === level && p.chapter_index === ch);
  const chapters = [...new Set(mine.filter((p) => p.plan_level === "CHAPTER").map((p) => p.chapter_index))].sort((a, b) => a - b);
  const brief = { premise, targetWords, chapterCount };
  // Detailed-blueprint workflow: new Progressive books require it; older Progressive books opt in explicitly.
  const blueprintsRequired = (book.controls as Row)?.blueprint_mode === "required" || !(book.controls as Row)?.planning_pipeline;
  const legacyProgressive = (book.controls as Row)?.planning_pipeline === "progressive" && (book.controls as Row)?.blueprint_mode !== "required";
  // Every chapter of the approved master has chapter, section and beat plans.
  const planningComplete = master?.status === "APPROVED" && chapters.length > 0
    && chapters.length === (master.plan_skeleton?.chapters?.length ?? chapters.length)
    && chapters.every((c) => ["CHAPTER", "SECTION", "BEATS"].every((lv) => has(lv, c)));
  const allReady = master?.status === "APPROVED" && chapters.length > 0 && chapters.length === (master.plan_skeleton?.chapters?.length ?? chapters.length)
    && chapters.every((c) => ["CHAPTER", "SECTION"].every((lv) => mine.some((p) => p.plan_level === lv && p.chapter_index === c)))
    && mine.every((p) => p.plan_status === "READY")
    && (!blueprintsRequired || chapters.every((c) => mine.some((p) => p.plan_level === "BLUEPRINT" && p.chapter_index === c && p.plan_status === "READY")));

  const createMaster = () => run("master", async () => {
    const extra = {}; // the story chosen in Setup reaches the planner server-side
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
  useEffect(() => {
    if (autoNext && master?.status === "APPROVED" && !busy) { setAutoNext(false); planAll(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNext, master?.status, busy]);

  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Your story</CardTitle>
          <CardDescription>Comes from step 1 (Setup). To compare other options, go back to Setup — that's the one place to choose a story.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {picked ? <p className="text-sm rounded-md border border-primary/50 p-3">Chosen story: <b>{picked.title}</b>. Your cast, twists, narrator and series choice go into the plan automatically.</p>
            : <p className="text-sm text-muted-foreground">No story option chosen — the plan is built from your own idea below.</p>}
          <Textarea value={premise} onChange={(e) => setPremise(e.target.value)} rows={4} placeholder="Your premise or concept" />
          <div className="flex flex-wrap gap-3 items-center text-sm">
            <label className="flex items-center gap-2">Words <Input type="number" className="w-28" value={targetWords} onChange={(e) => setTargetWords(Number(e.target.value))} /></label>
            <label className="flex items-center gap-2">Chapters <Input type="number" className="w-20" value={chapterCount} onChange={(e) => setChapterCount(Number(e.target.value))} /></label>
            {(book.controls as Row)?.series?.enabled && <Badge variant="secondary">Series of {(book.controls as Row).series.books} books</Badge>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Master plan</CardTitle>
          <CardDescription>Built from your story above. Plans never count as story canon — only accepted text does.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={createMaster} disabled={!!busy || !premise.trim()}>{busy === "master" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Draft master plan</Button>
          {master?.master_synopsis && <div className="rounded-lg border border-border p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Whole-book summary (version {master.version})</p>
            <p className="text-sm whitespace-pre-wrap">{master.master_synopsis}</p>
            {master.intended_ending && <p className="text-sm"><span className="text-primary">Ending:</span> {master.intended_ending}</p>}
            {(master.plan_skeleton?.reveals ?? []).length > 0 && <p className="text-xs text-muted-foreground">Twists: {(master.plan_skeleton.reveals as Row[]).map((r) => `${r.summary} (ch. ${r.revealChapter + 1})`).join(" · ")}</p>}
            {(master.plan_skeleton?.genreData?.series_books ?? []).length > 0 && <div className="space-y-2 pt-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Books in the series</p>
              {(master.plan_skeleton.genreData.series_books as Row[]).map((sb) => <details key={sb.bookNumber} className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Book {sb.bookNumber}{sb.title ? `: ${sb.title}` : ""}</summary><p className="text-sm whitespace-pre-wrap mt-2">{sb.summary}</p></details>)}
            </div>}
            {master.status === "DRAFT" && <p className="text-xs text-muted-foreground">Not right? Edit your premise above and draft again — the new version replaces this draft.</p>}
          </div>}
          {plans.masters.map((m) => (
            <div key={m.id} className="flex items-center gap-3 text-sm border border-border rounded-md px-3 py-2">
              <span>Version {m.version}</span><Badge variant={m.status === "APPROVED" ? "default" : "outline"}>{m.status}</Badge>
              {m.status === "DRAFT" && <Button size="sm" className="ml-auto" disabled={!!busy} onClick={() => run("approve", async () => { const r = await callPlanBook({ action: "approve_master", planId: m.id }); if (!r.ok) throw new Error(r.data.error); toast.success("Approved — now writing chapter and section summaries"); await refresh(); setAutoNext(true); })}>Approve & plan chapters</Button>}
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
              <Button onClick={planAll} disabled={!!busy || planningComplete}>{busy === "auto" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}{planningComplete ? "Whole book planned" : "Plan the whole book"}</Button>
              {progress && <Button variant="outline" onClick={() => { pauseRef.current = !pauseRef.current; setProgress({ ...progress, paused: pauseRef.current }); }}>{progress.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</Button>}
              <Button variant="outline" disabled={!!busy || !planningComplete || !bulkApprovableIds(mine as never).length} onClick={() => run("approveAll", async () => {
                const r = await callPlanBook({ action: "approve_plans", ids: bulkApprovableIds(mine as never) }); if (!r.ok) throw new Error(r.data.error); toast.success(`${r.data.approved} plans approved${blueprintsRequired ? " — approve each chapter blueprint separately" : ""}`); await refresh();
              })}>4. Approve all planned</Button>
            </div>
            {legacyProgressive && <div className="rounded-md border border-border p-3 text-xs flex flex-wrap items-center gap-2"><span className="flex-1">This book started before detailed blueprints. Writing still follows your approved summaries. Turning blueprints on makes every chapter not yet written need an approved blueprint first; written text is not changed.</span><Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("bpOn", async () => { const { error } = await supabase.from("books").update({ controls: { ...(book.controls ?? {}), blueprint_mode: "required" } }).eq("id", book.id); if (error) throw error; toast.success("Detailed blueprints now required for this book"); await refresh(); })}>Require blueprints</Button></div>}
            {progress && <Progress value={(progress.done / progress.total) * 100} />}
            <div className="space-y-2">
              {chapters.length === 0 && <p className="p-3 text-sm text-muted-foreground border border-border rounded-md">No chapter summaries yet. Press "Plan the whole book" to explode the summary into chapters and sections.</p>}
              {chapters.map((ch) => (
                <ChapterCard key={ch} ch={ch} rows={mine.filter((p) => p.chapter_index === ch)} busy={busy} run={run} refresh={refresh}
                  onSections={() => run("sec", async () => { const r = await callPlanBook({ action: "sections", bookId: book.id, masterPlanId: master.id, chapter: ch, requestId: crypto.randomUUID() }); if (!r.ok) throw new Error(r.data.error); await refresh(); })}
                  onBeats={() => run("beats", async () => { const r = await callPlanBook({ action: "beats", bookId: book.id, masterPlanId: master.id, chapter: ch, requestId: crypto.randomUUID() }); if (!r.ok) throw new Error(r.data.error); await refresh(); })}
                  onBlueprint={() => run("blueprint", async () => { const r = await callPlanBook({ action: "blueprint", bookId: book.id, masterPlanId: master.id, chapter: ch, requestId: crypto.randomUUID() }); if (!r.ok) throw new Error([r.data.error, ...(r.data.issues ?? []).slice(0, 3)].join(" · ")); toast.success("Blueprint ready for your review"); await refresh(); })} />
              ))}
            </div>
            {allReady && <div className="rounded-lg border border-primary p-4 flex flex-wrap items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-primary" /><span className="text-sm flex-1">The whole book is planned and approved. Writing will follow these exact summaries, section by section.</span>
              <Button disabled={!!busy} onClick={() => run("write", async () => {
                const controls = { ...(book.controls ?? {}), planning_pipeline: "progressive", ...(!(book.controls as Row)?.planning_pipeline ? { blueprint_mode: "required" } : {}) };
                const outline = buildOutlineFromPlans(master, mine, book.outline);
                const hasProse = outline.chapters.some((c: Row) => c.subsections.some((s: Row) => s.content));
                const { error } = await supabase.from("books").update({ controls, outline: outline as any, ...(hasProse ? {} : { status: "ready_to_write", current_chapter_index: 0, current_subsection_index: 0 }) }).eq("id", book.id); if (error) throw error;
                navigate(`/dashboard/${book.id}?autostart=1`);
              })}><PenLine className="w-4 h-4 mr-2" />Start writing the book</Button>
            </div>}
            <p className="text-xs text-muted-foreground">5. Once approved and Progressive Planning is on, write from the book page. Each section is checked before it is accepted; anything held shows up under Review.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EditableText({ label, value, editable, onSave, busy }: { label: string; value: string; editable: boolean; onSave: (v: string) => Promise<void>; busy: boolean }) {
  const [v, setV] = useState(value); const [editing, setEditing] = useState(false);
  useEffect(() => setV(value), [value]);
  if (!value && !editable) return null;
  return (
    <div className="text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {editing ? <div className="space-y-2 mt-1"><Textarea rows={4} value={v} onChange={(e) => setV(e.target.value)} />
        <div className="flex gap-2"><Button size="sm" disabled={busy || !v.trim()} onClick={async () => { await onSave(v); setEditing(false); }}>Save</Button><Button size="sm" variant="ghost" onClick={() => { setV(value); setEditing(false); }}>Cancel</Button></div></div>
        : <p className="whitespace-pre-wrap">{value || <span className="text-muted-foreground">—</span>}{editable && <button className="ml-2 text-xs text-primary" onClick={() => setEditing(true)}>Edit</button>}</p>}
    </div>
  );
}

function ChapterCard({ ch, rows, busy, run, refresh, onSections, onBeats, onBlueprint }: { ch: number; rows: Row[]; busy: string | null; run: RunFn; refresh: () => Promise<void>; onSections: () => void; onBeats: () => void; onBlueprint: () => void }) {
  const [open, setOpen] = useState(ch === 0);
  const chap = rows.find((p) => p.plan_level === "CHAPTER");
  const secs = rows.filter((p) => p.plan_level === "SECTION").sort((a, b) => a.subsection_index - b.subsection_index);
  const beats = rows.filter((p) => p.plan_level === "BEATS");
  const c = chap?.content ?? {};
  const edit = (row: Row, fields: Row) => run(`e-${row.id}`, async () => { const r = await callPlanBook({ action: "edit_plan", bookId: row.book_id, planId: row.id, fields }); if (!r.ok) throw new Error(r.data.error); toast.success("Saved"); await refresh(); });
  const status = (lv: string) => { const rs = rows.filter((p) => p.plan_level === lv); return rs.length ? (rs.every((p) => p.plan_status === "READY") ? "approved" : "planned") : "—"; };
  return (
    <div className="border border-border rounded-md">
      <button onClick={() => setOpen(!open)} className="w-full flex flex-wrap items-center gap-2 p-3 text-left">
        <span className="font-medium">Chapter {ch + 1}</span>
        <span className="text-sm text-muted-foreground truncate flex-1 min-w-0">{c.chapter?.objective}</span>
        {["CHAPTER", "SECTION", "BEATS"].map((lv) => <Badge key={lv} variant={status(lv) === "approved" ? "default" : status(lv) === "planned" ? "secondary" : "outline"}>{lv === "BEATS" ? "scene beats" : lv.toLowerCase()} {status(lv)}</Badge>)}
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && chap && <div className="border-t border-border p-3 space-y-3">
        <EditableText label="Chapter summary" value={c.chapter?.objective ?? ""} editable={chap.plan_status === "PLANNED"} busy={!!busy} onSave={(v) => edit(chap, { objective: v })} />
        <EditableText label="What's at stake" value={c.stakes ?? ""} editable={chap.plan_status === "PLANNED"} busy={!!busy} onSave={(v) => edit(chap, { stakes: v })} />
        <EditableText label="Focus" value={c.focus ?? ""} editable={chap.plan_status === "PLANNED"} busy={!!busy} onSave={(v) => edit(chap, { focus: v })} />
        <p className="text-xs text-muted-foreground">About {c.chapter?.targetWords?.toLocaleString?.() ?? "?"} words · {(c.chapter?.sections ?? []).length} sections</p>
        <div className="space-y-2">
          {secs.length === 0 && <Button size="sm" variant="outline" disabled={!!busy} onClick={onSections}>Explode into section summaries</Button>}
          {secs.map((s) => { const d = s.content?.detail ?? {}; const ed = s.plan_status === "PLANNED"; const b = beats.find((x) => x.subsection_index === s.subsection_index);
            return <div key={s.id} className="rounded-md bg-muted/30 border border-border p-3 space-y-2">
              <p className="text-xs font-medium">Section {s.subsection_index + 1} · about {s.content?.section?.targetWords ?? "?"} words {s.plan_status === "READY" && <CheckCircle2 className="w-3 h-3 inline text-primary" />}</p>
              <EditableText label="Section summary" value={s.content?.section?.objective ?? ""} editable={ed} busy={!!busy} onSave={(v) => edit(s, { objective: v })} />
              <EditableText label="Opens with" value={d.entry ?? ""} editable={ed} busy={!!busy} onSave={(v) => edit(s, { entry: v })} />
              <EditableText label="Turns on" value={d.focus ?? ""} editable={ed} busy={!!busy} onSave={(v) => edit(s, { focus: v })} />
              <EditableText label="Ends with" value={d.outcome ?? ""} editable={ed} busy={!!busy} onSave={(v) => edit(s, { outcome: v })} />
              {b && (b.content?.beats ?? []).length > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Scene beats ({b.content.beats.length})</summary><ol className="list-decimal ml-5 mt-1 space-y-0.5">{(b.content.beats as Row[]).map((x, i) => <li key={i}>{String(x.kind ?? "").replace(/_/g, " ")}{x.targetWords ? ` · ~${x.targetWords} words` : ""}{(b.content?.notes as Row[] | undefined)?.find((n) => n.id === x.id)?.note ? ` — ${(b.content.notes as Row[]).find((n) => n.id === x.id)!.note}` : ""}</li>)}</ol></details>}
            </div>; })}
          {secs.length > 0 && beats.length === 0 && <Button size="sm" variant="outline" disabled={!!busy} onClick={onBeats}>Add scene beats</Button>}
        </div>
        {secs.length > 0 && <BlueprintBlock rows={rows.filter((p) => p.plan_level === "BLUEPRINT")} busy={busy} run={run} refresh={refresh} onBuild={onBlueprint} />}
      </div>}
    </div>
  );
}

function BlueprintBlock({ rows, busy, run, refresh, onBuild }: { rows: Row[]; busy: string | null; run: RunFn; refresh: () => Promise<void>; onBuild: () => void }) {
  const row = rows.find((r) => r.plan_status === "READY") && !rows.some((r) => r.plan_status === "PLANNED") ? rows.find((r) => r.plan_status === "READY") : rows.find((r) => r.plan_status === "PLANNED") ?? rows[0];
  const { bookId = "" } = useParams();
  const bp = row?.content?.blueprint as Row | undefined;
  const name = (id: string) => (bp?.cast as Row[] | undefined)?.find((c) => c.id === id)?.name ?? (bp?.castProposals as Row[] | undefined)?.find((c) => c.id === id)?.name ?? id;
  const place = (id: string) => (bp?.locations as Row[] | undefined)?.find((l) => l.id === id)?.name ?? id;
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Detailed blueprint</span>
        {row && <Badge variant={row.plan_status === "READY" ? "default" : "secondary"}>{row.plan_status === "READY" ? "approved" : "waiting for your approval"}</Badge>}
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={!!busy} onClick={onBuild}>{bp ? "Rebuild blueprint" : "Build detailed blueprint"}</Button>
        {row?.plan_status === "PLANNED" && <Button size="sm" disabled={!!busy} onClick={() => run(`bp-${row.id}`, async () => { const r = await callPlanBook({ action: "approve_plans", ids: [row.id] }); if (!r.ok) throw new Error(r.data.error); toast.success("Blueprint approved"); await refresh(); })}>Approve blueprint</Button>}
      </div>
      {!bp && <p className="text-xs text-muted-foreground">Sets out who takes part, where, what happens and how the chapter ends, step by step, before any writing.</p>}
      {bp && <div className="space-y-2 text-sm">
        <p className="whitespace-pre-wrap">{bp.synopsis}</p>
        <p className="text-xs text-muted-foreground"><span className="font-medium">Ends with:</span> {bp.conclusion}</p>
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div><p className="font-medium">Characters</p>{(bp.cast as Row[]).map((c) => <p key={c.id}>{c.name}{c.pov ? " (viewpoint)" : ""} — {c.role}</p>)}</div>
          <div><p className="font-medium">Places</p>{(bp.locations as Row[]).map((l) => <p key={l.id}>{l.name} — {l.significance}</p>)}</div>
          <div><p className="font-medium">Events</p>{(bp.events as Row[]).map((e) => <p key={e.id}>{e.name}</p>)}</div>
        </div>
        {(bp.castProposals as Row[]).length > 0 && <div className="text-xs rounded bg-muted/40 p-2"><p className="font-medium">New people the plan proposes — each must be approved and added to your cast before this blueprint can be approved</p>{(bp.castProposals as Row[]).map((p) => <div key={p.id} className="flex flex-wrap items-center gap-2 py-1"><span className="flex-1">{p.name} — {p.justification}</span>{row?.plan_status === "PLANNED" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(`cp-${p.id}`, async () => { const r = await callPlanBook({ action: "approve_cast_proposal", bookId, planId: row.id, proposalId: p.id }); if (!r.ok) throw new Error(r.data.error); toast.success(r.data.already ? `${p.name} is already in your cast` : `${p.name} added to your cast`); await refresh(); })}>Add to cast</Button>}</div>)}</div>}
        <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Step-by-step beats ({(bp.microbeats as Row[]).length})</summary>
          <ol className="list-decimal ml-5 mt-1 space-y-1">{(bp.microbeats as Row[]).map((b) => <li key={b.id}>{b.text} <span className="text-muted-foreground">· {(b.characterIds as string[]).map(name).join(", ") || "no one"} · {place(b.locationId)} · why: {b.purpose}</span></li>)}</ol></details>
        <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Who knows what</summary>
          <p className="mt-1"><span className="font-medium">Only you (author):</span> {(bp.knowledge?.author ?? []).join("; ") || "—"}</p>
          <p><span className="font-medium">Reader by chapter end:</span> {(bp.knowledge?.reader ?? []).join("; ") || "—"}</p>
          {(bp.knowledge?.characters ?? []).map((k: Row) => <p key={k.characterId}><span className="font-medium">{name(k.characterId)}:</span> knows {(k.knows ?? []).join("; ") || "—"}; doesn't know {(k.doesNotKnow ?? []).join("; ") || "—"}</p>)}</details>
      </div>}
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
  const [replaceAsk, setReplaceAsk] = useState<Record<string, string>>({});
  const decide = (logId: string, decision: string) => run(`d-${logId}`, async () => {
    const r = await callReview({ action: "decide", logId, decision, rationale: why[logId] || DECISIONS.find((d) => d.value === decision)!.label });
    if (!r.ok) throw new Error(r.data.error); await refresh();
  });
  return (
    <div className="space-y-6 mt-4">
      {review.candidates.length === 0 && <p className="text-sm text-muted-foreground">No drafts are waiting for you.</p>}
      {review.candidates.map((c) => {
        const lineage: string[] = c.lineage ?? [c.id];
        const logs = review.logs.filter((l) => lineage.includes(l.candidate_id));
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
                  const r = await saveThenAccept(bookId, c.id, c.draft_text, edits[c.id]);
                  if (needsReplaceConfirmation(r.data)) { setReplaceAsk((m) => ({ ...m, [c.id]: r.candidateId })); return; }
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
              {replaceAsk[c.id] && (
                <div className="rounded-md border border-primary/50 p-3 space-y-2">
                  <p className="text-sm">This section already has accepted text in your book. Replace it with this draft? The full checks still run first.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={!!busy} onClick={() => run(`a-${c.id}`, async () => {
                      const r = await saveThenAccept(bookId, replaceAsk[c.id], c.draft_text, undefined, true);
                      setReplaceAsk((m) => { const n = { ...m }; delete n[c.id]; return n; });
                      if (r.data.status === "accepted") { toast.success("Accepted — updating story memory"); await runNarrativeExtraction(bookId, c.chapter_index, c.subsection_index); }
                      else if (r.data.status === "held") toast.warning("Still not passing checks — see the new findings");
                      else throw new Error(r.data.message ?? r.data.error ?? "Could not accept");
                      await refresh();
                    })}>Replace with this draft</Button>
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(`k-${c.id}`, async () => {
                      for (const id of new Set([c.id, replaceAsk[c.id]])) await callReview({ action: "discard", candidateId: id });
                      setReplaceAsk({}); toast.success("Kept the accepted text; removed the old draft"); await refresh();
                    })}>Keep current text</Button>
                  </div>
                </div>
              )}
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
