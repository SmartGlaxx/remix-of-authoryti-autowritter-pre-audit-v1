// Phase 4 — optional advanced Book Setup inside Planning Studio. Every step is skippable; the
// server validates and stores the setup apart from prose, and the master planner reads it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PersonaStudioView } from "@/pages/PersonaStudio";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Lock, Plus, RefreshCw, Trash2, Check, X, Sparkles, Wand2, ArrowLeft, ArrowRight } from "lucide-react";
type ScreenKey = "idea" | "twists" | "cast" | "narration" | "writer";
const SCREEN_LABEL: Record<ScreenKey, string> = { idea: "Idea & story", twists: "Twist reveals", cast: "Characters", narration: "Narrator & pen name", writer: "Writer & voice" };
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callPlanBook } from "@/lib/candidateReview";
import { WriterPicker } from "@/components/WriterPicker";
import { BoundedSlider, offsetLabel } from "@/components/BoundedSlider";
import { SLIDERS, MAX_ADJUST, NEUTRAL, readSliders, type SliderValues } from "../../supabase/functions/_shared/writers/sliders";
import { WRITER_BASELINES } from "../../supabase/functions/_shared/writers/manifest";
import { BOOK_TYPE_INFO, BOOK_TYPE_GENRES, GENRE_PRESETS, DEFAULT_BANNED_WORDS, TEXTBOOK_COUNTRIES, TEXTBOOK_LEVELS, type BookType } from "@/types/book";
import { adapterForBookType } from "../../supabase/functions/_shared/narrative/planning/adapters";
import { BOOK_ROLES, emptySetup, validateSetup, type BookSetup, type SetupCastMember } from "../../supabase/functions/_shared/narrative/planning/bookSetup";

type Row = Record<string, any>;
const COUNTS = [3, 5, 7, 10];
const POV_LABEL: Record<string, string> = { first_person: "First person", third_limited: "Third person (close)", third_omniscient: "Third person (all-knowing)", second_person: "Second person" };
const AUDIENCES = ["Children (5-8)", "Middle grade (8-12)", "Young adult", "New adult", "Adult", "Professionals", "Beginners", "General readers"];
// Audiences that make sense for each kind of book.
const AUD_KIDS = ["Toddlers (1-3)", "Early readers (4-6)", "Young children (6-8)", "Middle grade (8-12)"];
const AUD_FICTION = ["Middle grade (8-12)", "Young adult (13-17)", "New adult (18-25)", "General adult", "Literary readers"];
const AUD_PRO = ["Beginners / curious", "General readers", "Workplace professionals", "Founders & leaders", "Advanced practitioners"];
const AUD_TEXT = ["Primary pupils", "Junior secondary students", "Senior secondary students", "University / college students", "Teachers"];
const audiencesFor = (t: string) => t === "children" ? AUD_KIDS : t === "textbook" ? AUD_TEXT : t === "comic" ? ["Children (6-10)", ...AUD_FICTION] : t === "cookbook" ? ["Beginner cooks", "Home cooks", "Families", "Experienced cooks"] : (BOOK_TYPE_INFO[t as BookType]?.category === "fiction" || t === "poetry" || t === "drama") ? AUD_FICTION : AUD_PRO;
const TONES = ["Dark", "Hopeful", "Funny", "Suspenseful", "Romantic", "Literary", "Cozy", "Gritty", "Inspiring", "Practical", "Authoritative", "Conversational"];
const ADJUSTMENTS = [
  { value: "twists", label: "More plot twists" }, { value: "drama", label: "More drama & stakes" },
  { value: "romance", label: "More romance" }, { value: "darker", label: "Darker & grittier" },
  { value: "pacing", label: "Faster pacing & thrills" }, { value: "mystery", label: "More mystery & secrets" },
  { value: "depth", label: "More depth & meaning" }, { value: "humor", label: "More humour" },
  { value: "clarity", label: "Sharper hook" }, { value: "practical", label: "More practical value" },
  { value: "custom", label: "Something else…" },
];
const LENGTHS = [{ v: 20000, l: "Short (~20k words)" }, { v: 50000, l: "Standard (~50k)" }, { v: 80000, l: "Long (~80k)" }, { v: 120000, l: "Epic (~120k)" }];
const genresFor = (t: string) => BOOK_TYPE_GENRES[t as BookType] ?? GENRE_PRESETS[BOOK_TYPE_INFO[t as BookType]?.category ?? "fiction"] ?? [];
const fictionType = (t: string) => { try { return adapterForBookType(t).isFiction; } catch { return true; } };
const nice = (r: string) => r.replace(/_/g, " ");

async function callPersona(body: Row) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/persona-studio`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

export default function BookSetupTab({ book, isFiction, onSaved, onContinue }: { book: Row; isFiction: boolean; onSaved: () => void; onContinue?: (o: { chapterCount: number; targetWords: number }) => void }) {
  const [st, setSt] = useState<BookSetup | null>(null);
  const premiseRef = useRef<HTMLTextAreaElement>(null);
  const [premiseExpanded, setPremiseExpanded] = useState(false);
  const [screen, setScreen] = useState(0);
  const [studioOpen, setStudioOpen] = useState(false);
  const draftKey = `book-setup-draft:${book.id}`;
  const [dir, setDir] = useState<1 | -1>(1);
  const [hasProse, setHasProse] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [chapterCount, setChapterCount] = useState(12);
  const [identities, setIdentities] = useState<Row[]>([]);
  const [universes, setUniverses] = useState<Row[]>([]);
  const [pens, setPens] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState<{ name: string; matches: Row[] } | null>(null);
  const [recs, setRecs] = useState<Row[]>([]);
  const [newFixed, setNewFixed] = useState("");
  const [exType, setExType] = useState<string>(book.book_type ?? "novel");
  const [exGenre, setExGenre] = useState<string>(book.genre ?? "");
  const [adjustKey, setAdjustKey] = useState<string>("");
  const [adjustCustom, setAdjustCustom] = useState("");
  const [prevPremise, setPrevPremise] = useState<string | null>(null);
  const [exAudience, setExAudience] = useState<string>(book.audience ?? "");
  const [exTone, setExTone] = useState("");
  const [exLength, setExLength] = useState(50000);
  const [exSetting, setExSetting] = useState("");
  const [writerId, setWriterId] = useState<string>(book.controls?.writerId ?? "");
  const [sliders, setSliders] = useState<SliderValues>(() => readSliders(book.tone_profile, book.controls));
  // Where each slider value is stored so the writing engine reads it back (legacy field names).
  const TONE_KEYS: Partial<Record<keyof SliderValues, string>> = { formality: "formality", emotion: "emotionalIntensity", warmth: "warmth", humor: "humorLevel", authority: "authorityLevel", directness: "directness", readerIntimacy: "readerIntimacy" };
  const CONTROL_KEYS: Partial<Record<keyof SliderValues, string>> = { pacing: "velocity", elaboration: "scope", conceptualComplexity: "entityComplexity", perspective: "perspectiveMultiplexing", creativity: "creativity", hookFrequency: "hookFrequency", sensoryDetail: "sensoryDetail", sentenceVariation: "sentenceVariation" };
  const saveSliders = (next: SliderValues) => run("sliders", async () => {
    const tone: Row = { ...(book.tone_profile ?? {}) }; const controls: Row = { ...(book.controls ?? {}) };
    for (const s of SLIDERS) { if (TONE_KEYS[s.key]) tone[TONE_KEYS[s.key]!] = next[s.key]; if (CONTROL_KEYS[s.key]) controls[CONTROL_KEYS[s.key]!] = next[s.key]; }
    const { error } = await supabase.from("books").update({ tone_profile: tone, controls }).eq("id", book.id);
    if (error) throw error;
    toast.success("Voice settings saved"); onSaved();
  });
  const [exComparables, setExComparables] = useState("");
  const [exAvoid, setExAvoid] = useState("");
  const [exOriginality, setExOriginality] = useState<"safe" | "balanced" | "bold">("balanced");
  const [showMore, setShowMore] = useState(false);
  const [tbCountry, setTbCountry] = useState("usa");
  const [tbLevel, setTbLevel] = useState("junior-secondary");
  const [banned, setBanned] = useState<string[]>(Array.isArray(book.controls?.bannedWords) ? book.controls.bannedWords : DEFAULT_BANNED_WORDS);
  const [newBan, setNewBan] = useState("");
  const [series, setSeries] = useState<{ enabled: boolean; books: number }>({ enabled: !!book.controls?.series?.enabled, books: Number(book.controls?.series?.books) || 3 });
  const saveSeries = async (next: { enabled: boolean; books: number }) => {
    setSeries(next);
    const { error } = await supabase.from("books").update({ controls: { ...(book.controls ?? {}), bannedWords: banned, series: next } }).eq("id", book.id);
    if (error) toast.error("Couldn't save the series choice");
  };
  const rewriteBook = () => run("rewrite", async () => {
    const typed = window.prompt(`This clears all written text so you can change the setup and write the book again. Your setup and plans are kept.\n\nType the book title to confirm: ${book.title}`);
    if (typed === null) return;
    if (typed.trim() !== String(book.title).trim()) throw new Error("Title didn't match — nothing was changed");
    const { error } = await supabase.from("books").update({ outline: null, status: "planning", word_count: 0, current_chapter_index: 0, current_subsection_index: 0 }).eq("id", book.id);
    if (error) throw error;
    toast.success("Written text cleared — you can now change the setup and plan again"); onSaved(); await load();
  });
  const saveBanned = async (next: string[]) => {
    setBanned(next);
    const { error } = await supabase.from("books").update({ controls: { ...(book.controls ?? {}), bannedWords: next } }).eq("id", book.id);
    if (error) toast.error("Couldn't save the word list");
  };
  const exFiction = fictionType(exType);
  const audList = audiencesFor(exType);
  const curriculum = exType === "textbook" ? { country: TEXTBOOK_COUNTRIES.find((c) => c.value === tbCountry)?.label, level: TEXTBOOK_LEVELS.find((l) => l.value === tbLevel)?.label } : undefined;

  const load = async () => {
    const [r, ids, us, ps] = await Promise.all([
      callPlanBook({ action: "setup_get", bookId: book.id }),
      supabase.from("narrative_identities").select("id, display_name, level, universe_id").is("merged_into_id", null).order("display_name").limit(1000),
      supabase.from("fictional_universes").select("id, name").eq("is_archived", false).order("name"),
      supabase.from("author_identities").select("id, pen_name").eq("is_archived", false).order("pen_name"),
    ]);
    let s0 = r.ok ? (r.data.setup as BookSetup) : emptySetup();
    if (!s0.premise) s0.premise = book.theme ?? "";
    // Unsaved edits survive reloads: a local draft for this book wins over the last server copy.
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (d?.st && !r.data?.hasProse) { s0 = { ...s0, ...d.st }; if (typeof d.screen === "number") setScreen(d.screen); }
    } catch { /* ignore broken draft */ }
    setSt(s0); setHasProse(!!r.data?.hasProse);
    setIdentities(ids.data ?? []); setUniverses(us.data ?? []); setPens(ps.data ?? []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [book.id]);
  useEffect(() => {
    if (!st) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ st, screen, savedAt: Date.now() })); } catch { /* storage full */ }
  }, [st, screen, draftKey]);
  const refreshLibrary = async () => {
    const [ids, us, ps] = await Promise.all([
      supabase.from("narrative_identities").select("id, display_name, level, universe_id").is("merged_into_id", null).order("display_name").limit(1000),
      supabase.from("fictional_universes").select("id, name").eq("is_archived", false).order("name"),
      supabase.from("author_identities").select("id, pen_name").eq("is_archived", false).order("pen_name"),
    ]);
    setIdentities(ids.data ?? []); setUniverses(us.data ?? []); setPens(ps.data ?? []);
  };

  const issues = useMemo(() => (st ? validateSetup(st, { bookType: book.book_type, penNames: pens as any, chapterCount }) : []), [st, pens, chapterCount, book.book_type]);
  useLayoutEffect(() => {
    const textarea = premiseRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "160px";
      if (premiseExpanded) {
        textarea.style.height = `${Math.max(160, textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight)}px`;
      }
    };
    resize();
    let width = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = textarea.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [premiseExpanded, st?.premise, screen]);
  if (!st) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  const up = (patch: Partial<BookSetup>) => setSt({ ...st, ...patch });
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(null); } };
  const universeIds = identities.filter((i) => (i.universe_id ?? null) === st.universeId);
  const libraryHits = search.trim() ? universeIds.filter((i) => i.display_name.toLowerCase().includes(search.toLowerCase()) && !st.cast.some((c) => c.identityId === i.id)).slice(0, 8) : [];

  const save = (stage?: BookSetup["stage"]) => run("save", async () => {
    const r = await callPlanBook({ action: "setup_save", bookId: book.id, chapterCount, setup: { ...st, stage: stage ?? st.stage } });
    if (!r.ok) throw new Error(r.data.message ?? r.data.issues?.filter((i: Row) => i.blocking).map((i: Row) => i.message).join(" ") ?? r.data.error ?? "Couldn't save");
    // A fresh "Untitled book" draft takes its title, type and description from the chosen story.
    const pick = st.selectedIndex != null ? st.alternatives[st.selectedIndex] : null;
    if (book.title === "Untitled book" && (pick || st.premise.trim())) {
      const title = (pick?.title || st.premise.split(/\n| — /)[0]).trim().slice(0, 120) || "Untitled book";
      await supabase.from("books").update({ title, book_type: exType, theme: (pick?.logline || st.premise).slice(0, 1000), ...(exGenre ? { genre: exGenre } : {}), ...(exAudience ? { audience: exAudience } : {}) }).eq("id", book.id);
    }
    if (!Array.isArray(book.controls?.bannedWords)) await saveBanned(banned);
    setSt(r.data.setup); toast.success(stage === "planning" ? "Setup saved — now build the plan" : "Setup saved — you can come back to it any time"); onSaved();
    if (stage === "planning") onContinue?.({ chapterCount, targetWords: exLength });
  });

  const genAlternatives = (replaceIndex?: number) => run(replaceIndex === undefined ? "alts" : `alt${replaceIndex}`, async () => {
    // Save fixed requirements first so the server keeps them in every option.
    await callPlanBook({ action: "setup_save", bookId: book.id, chapterCount, setup: st });
    const r = await callPlanBook({ action: exFiction ? "alternatives" : "concepts", bookId: book.id, count: replaceIndex === undefined ? count : 3, premise: st.premise, chapterCount, bookType: exType, genre: exGenre || undefined, audience: exAudience || undefined, targetWords: exLength, bannedWords: banned, twistMode: exFiction ? st.twistsEnabled : undefined, explore: { tone: exTone, setting: exSetting, comparables: exComparables, avoid: exAvoid, originality: exOriginality, curriculum }, guidance: replaceIndex === undefined ? undefined : `variation ${Date.now()}` });
    if (!r.ok) throw new Error(r.data.error === "PLAN_INVALID" ? "The options didn't pass checks; try again." : r.data.error);
    const list: Row[] = (exFiction ? r.data.alternatives : r.data.concepts).map((a: Row) => ({ ...a, summary: a.summary, twist: a.twist ?? "", ending: a.ending ?? a.readerOutcome ?? "", logline: a.logline ?? a.coreThesis ?? "" }));
    if (replaceIndex === undefined) up({ alternatives: list as any, selectedIndex: null, stage: "alternatives", storyMode: "explore" });
    else { const fresh = list.find((a) => !st.alternatives.some((b) => b.title === a.title)) ?? list[0]; const next = [...st.alternatives]; next[replaceIndex] = { ...(fresh as any), id: `alt${replaceIndex + 1}` }; up({ alternatives: next }); }
  });

  // "Adjust with AI": rewrite the seed idea in a chosen direction before any options are made.
  const adjustPremise = () => run("adjust", async () => {
    const r = await callPlanBook({ action: "adjust_premise", bookId: book.id, premise: st.premise, adjustments: adjustKey && adjustKey !== "custom" ? [adjustKey] : [], custom: adjustKey === "custom" ? adjustCustom : undefined, bookType: exType, genre: exGenre || undefined, audience: exAudience || undefined, chapterCount, targetWords: exLength, bannedWords: banned, explore: { tone: exTone } });
    if (!r.ok) throw new Error(r.data.error === "PLAN_INVALID" ? "The rewrite didn't pass checks; try again." : r.data.error);
    setPrevPremise(st.premise); up({ premise: r.data.premise });
    toast.success(r.data.changes || "Idea adjusted — edit it, adjust again, or undo");
  });

  // "Surprise me": one random starting idea for the chosen book type, before any summaries exist.
  const surpriseMe = () => run("surprise", async () => {
    const { data, error } = await supabase.functions.invoke("book-ideas", { body: {
      mode: "light", count: 2,
      brief: [`A surprising, original ${BOOK_TYPE_INFO[exType as BookType]?.label ?? exType} idea`, exGenre && `in ${exGenre}`, exAudience && `for ${exAudience}`, exTone && `with a ${exTone.toLowerCase()} tone`, exFiction && st.twistsEnabled && "built around one huge, story-reframing plot twist", curriculum && `following the ${curriculum.country} curriculum at ${curriculum.level} level`, banned.length && `never using the words: ${banned.join(", ")}`, `variation ${Math.floor(Math.random() * 1e6)}`].filter(Boolean).join(" "),
      catalog: { [exType]: { audiences: exAudience ? [exAudience] : audList, genres: exGenre ? [exGenre] : genresFor(exType) } },
    } });
    if (error) throw new Error(error.message || "Couldn't get an idea");
    const idea = (data as Row)?.ideas?.[Math.floor(Math.random() * ((data as Row)?.ideas?.length || 1))];
    if (!idea) throw new Error((data as Row)?.error ?? "No idea came back — try again");
    up({ premise: `${idea.title}${idea.subtitle ? ` — ${idea.subtitle}` : ""}\n\n${idea.description}` });
    toast.success("Here's an idea — edit it or press Surprise me again");
  });

  const proposeTwists = () => run("twists", async () => {
    await callPlanBook({ action: "setup_save", bookId: book.id, chapterCount, setup: st });
    const r = await callPlanBook({ action: "twists", bookId: book.id, count: 3, premise: st.premise, chapterCount });
    if (!r.ok) throw new Error(r.data.error ?? "Couldn't propose twists");
    const keep = st.twists.filter((t) => t.status === "approved").slice(0, 1);
    up({ twists: [...keep, ...r.data.twists.map((t: Row, i: number) => ({ ...t, id: `t${Date.now()}${i}` }))], stage: "twists" });
  });

  const addCast = (m: Partial<SetupCastMember> & { name: string }) => up({ cast: [...st.cast, { key: `c${Date.now()}${st.cast.length}`, role: "supporting", identityId: null, lightweight: true, ...m } as SetupCastMember] });
  const setCast = (key: string, patch: Partial<SetupCastMember>) => up({ cast: st.cast.map((c) => (c.key === key ? { ...c, ...patch } : c)) });

  const createPersistent = (name: string, decision?: string, existingId?: string) => run("persist", async () => {
    const r = await callPersona({ action: "create_identity", displayName: name, universeId: st.universeId, level: "story_character", decision, existingId });
    if (r.status === 409 && r.data.status === "needs_confirmation") { setPending({ name, matches: r.data.resolution.matches }); return; }
    if (!r.ok) throw new Error(r.data.error ?? "Couldn't save character");
    setPending(null); setNewName("");
    const existing = st.cast.find((c) => c.name.toLowerCase() === name.toLowerCase() && !c.identityId);
    if (existing) setCast(existing.key, { identityId: r.data.identityId, lightweight: false }); else addCast({ name, identityId: r.data.identityId, lightweight: false });
    await load().catch(() => {});
    toast.success(r.data.reused ? "Linked to your existing character" : "Character saved to your library");
  });

  const locked = hasProse;
  const screens = (isFiction ? ["idea", "twists", "cast", "narration", "writer"] : ["idea", "cast", "narration", "writer"]) as ScreenKey[];
  const cur = screens[Math.min(screen, screens.length - 1)];
  const isLast = screen >= screens.length - 1;
  const go = (d: 1 | -1) => {
    if (d === 1 && cur === "idea") callPlanBook({ action: "setup_save", bookId: book.id, chapterCount, setup: st }).catch(() => {});
    // Quiet server save on every step so nothing is lost if the tab closes.
    if (st && !hasProse) callPlanBook({ action: "setup_save", bookId: book.id, chapterCount, setup: st }).catch(() => {});
    setDir(d); setScreen((s) => Math.max(0, Math.min(screens.length - 1, s + d))); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <div className="space-y-6 mt-4">
      <div className="flex flex-wrap gap-1.5">
        {screens.map((s, i) => <button key={s} onClick={() => { setDir(i > screen ? 1 : -1); setScreen(i); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${i === screen ? "border-primary bg-primary/10 text-foreground" : i < screen ? "border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}>{i < screen && <Check className="inline w-3 h-3 mr-1" />}{SCREEN_LABEL[s]}</button>)}
      </div>
      {locked && <div className="flex gap-2 items-start text-sm rounded-md border border-border p-3"><Lock className="w-4 h-4 mt-0.5 text-primary" /><span>Writing has started. The story, narrator, point of view, universe and character identities are locked to protect what's already written. Cast notes, roles and pen name can still change.</span><Button size="sm" variant="outline" className="ml-auto shrink-0" disabled={!!busy} onClick={rewriteBook}>{busy === "rewrite" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Change setup & rewrite the book</Button></div>}

      <AnimatePresence mode="wait" custom={dir}>
      <motion.div key={cur} custom={dir} initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }} transition={{ duration: 0.25, ease: "easeOut" }}>
      {/* 1. Concept & story options */}
      {cur === "idea" && <Card>
        <CardHeader><CardTitle>1. {exFiction ? "Story alternatives" : "Book approaches"}</CardTitle>
          <CardDescription>{exFiction ? "Compare complete, genuinely different stories — or skip and plan from your own idea." : "Compare different ways to frame this book — or skip and plan from your own concept."}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {!locked && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Book type</label>
              <Select value={exType} onValueChange={(v) => { setExType(v); setExGenre(""); setExAudience(""); }}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(BOOK_TYPE_INFO).map(([k, v]) => <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground">{exType === "textbook" ? "Subject" : "Sub-category"}</label>
              <Select value={exGenre || "__any"} onValueChange={(v) => setExGenre(v === "__any" ? "" : v)}><SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent><SelectItem value="__any">Any / surprise me</SelectItem>{[...new Set([...(exGenre && !genresFor(exType).includes(exGenre) ? [exGenre] : []), ...genresFor(exType)])].map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Audience</label>
              <Select value={exAudience || "__any"} onValueChange={(v) => setExAudience(v === "__any" ? "" : v)}><SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent><SelectItem value="__any">Any</SelectItem>{[...new Set([...(exAudience && !audList.includes(exAudience) ? [exAudience] : []), ...audList])].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Tone</label>
              <Select value={exTone || "__any"} onValueChange={(v) => setExTone(v === "__any" ? "" : v)}><SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent><SelectItem value="__any">Any</SelectItem>{TONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
          </div>}
          {!locked && exType === "textbook" && <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Country curriculum</label>
              <Select value={tbCountry} onValueChange={setTbCountry}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TEXTBOOK_COUNTRIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground">School level</label>
              <Select value={tbLevel} onValueChange={setTbLevel}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TEXTBOOK_LEVELS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent></Select></div>
          </div>}
          {!locked && <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><Switch checked={series.enabled} onCheckedChange={(on) => saveSeries({ ...series, enabled: on })} aria-label="Series" />Part of a series</label>
            {series.enabled && <><Input type="number" className="w-20" min={2} max={12} value={series.books} onChange={(e) => saveSeries({ ...series, books: Math.max(2, Math.min(12, +e.target.value || 3)) })} aria-label="Books in series" /><span className="text-xs text-muted-foreground">books — each gets its own 450–700 word summary (about {series.books * 450}–{series.books * 700} words in all)</span></>}
          </div>}
          {!locked && exFiction && <div className="flex items-start gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <Switch checked={st.twistsEnabled} onCheckedChange={(on) => up({ twistsEnabled: on })} aria-label="Plot twist mode" />
            <div className="text-sm"><p className="font-medium">Plot twist mode {st.twistsEnabled ? "on" : "off"}</p>
              <p className="text-xs text-muted-foreground">{st.twistsEnabled ? "Every story option will be built around one big twist from the very first page, with clues planted along the way." : "Story options will follow clean arcs with no engineered shock reversal."} Choose this before making your options.</p></div>
          </div>}
          {!locked && <p className="text-xs text-muted-foreground">Generating for: <span className="text-foreground">{[BOOK_TYPE_INFO[exType as BookType]?.label, exGenre || "any sub-category", exAudience || "any audience", curriculum?.country?.split(" (")[0], exFiction && (st.twistsEnabled ? "plot twist mode" : "no twist")].filter(Boolean).join(" · ")}</span></p>}
          <Textarea ref={premiseRef} rows={6} className="h-40 min-h-40 resize-none box-border" aria-label="Initial book idea" value={st.premise} disabled={locked} onFocus={() => setPremiseExpanded(true)} onBlur={() => setPremiseExpanded(false)} onChange={(e) => up({ premise: e.target.value })} placeholder="Your idea, title, theme or premise — or press Surprise me" />
          {!locked && <div className="flex flex-wrap justify-end items-center gap-2">
            <Select value={adjustKey} onValueChange={setAdjustKey}><SelectTrigger className="w-56 h-9" aria-label="What to change"><SelectValue placeholder="What should change?" /></SelectTrigger>
              <SelectContent>{ADJUSTMENTS.filter((o) => exFiction ? o.value !== "practical" : !["twists", "romance", "darker"].includes(o.value)).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
            {adjustKey === "custom" && <Input className="w-56 h-9" value={adjustCustom} maxLength={300} onChange={(e) => setAdjustCustom(e.target.value)} placeholder="e.g. set it in 1920s Lagos" />}
            <Button size="sm" variant="outline" disabled={!!busy || !st.premise.trim() || !adjustKey || (adjustKey === "custom" && !adjustCustom.trim())} onClick={adjustPremise}>{busy === "adjust" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}Adjust with AI</Button>
            {prevPremise !== null && <Button size="sm" variant="ghost" onClick={() => { up({ premise: prevPremise }); setPrevPremise(null); }}>Undo</Button>}
            <Button size="sm" variant="outline" disabled={!!busy} onClick={surpriseMe}>{busy === "surprise" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}Surprise me</Button>
          </div>}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Must-keep details (every option will keep these — e.g. a setting, a character, a fact):</p>
            <div className="flex flex-wrap gap-2">{st.fixedRequirements.map((f, i) => <Badge key={i} variant="secondary" className="gap-1">{f}{!locked && <button aria-label="Remove" onClick={() => up({ fixedRequirements: st.fixedRequirements.filter((_, j) => j !== i) })}><X className="w-3 h-3" /></button>}</Badge>)}</div>
            {!locked && <div className="flex gap-2"><Input value={newFixed} onChange={(e) => setNewFixed(e.target.value)} placeholder="Add a must-keep detail" /><Button variant="outline" disabled={!newFixed.trim()} onClick={() => { up({ fixedRequirements: [...st.fixedRequirements, newFixed.trim()] }); setNewFixed(""); }}>Add</Button></div>}
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Words not allowed (kept out of ideas, plans and writing — remove any you want to allow):</p>
            <div className="flex flex-wrap gap-2">{banned.map((w) => <Badge key={w} variant="outline" className="gap-1">{w}<button aria-label={`Allow ${w}`} onClick={() => saveBanned(banned.filter((x) => x !== w))}><X className="w-3 h-3" /></button></Badge>)}{!banned.length && <span className="text-xs text-muted-foreground">None</span>}</div>
            <div className="flex gap-2"><Input value={newBan} onChange={(e) => setNewBan(e.target.value)} placeholder="Add a word or phrase" onKeyDown={(e) => { if (e.key === "Enter" && newBan.trim()) { saveBanned([...new Set([...banned, newBan.trim().toLowerCase()])]); setNewBan(""); } }} /><Button variant="outline" disabled={!newBan.trim()} onClick={() => { saveBanned([...new Set([...banned, newBan.trim().toLowerCase()])]); setNewBan(""); }}>Add word</Button></div>
          </div>
          {!locked && <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-xs text-muted-foreground">Fine-tune the ideas.</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Originality:</span>
              {(["safe", "balanced", "bold"] as const).map((o) => <Button key={o} size="sm" variant={exOriginality === o ? "default" : "outline"} onClick={() => setExOriginality(o)}>{o === "safe" ? "Familiar" : o === "bold" ? "Bold" : "Balanced"}</Button>)}
              <Select value={String(exLength)} onValueChange={(v) => setExLength(+v)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{LENGTHS.map((l) => <SelectItem key={l.v} value={String(l.v)}>{l.l}</SelectItem>)}</SelectContent></Select>
              <Button size="sm" variant="ghost" onClick={() => setShowMore(!showMore)}>{showMore ? "Fewer options" : "More options"}</Button>
            </div>
            {showMore && <div className="grid gap-3 sm:grid-cols-3">
              <Input value={exSetting} onChange={(e) => setExSetting(e.target.value)} placeholder={exFiction ? "Setting or time period" : "Industry, field or context"} />
              <Input value={exComparables} onChange={(e) => setExComparables(e.target.value)} placeholder="Similar books (for feel only)" />
              <Input value={exAvoid} onChange={(e) => setExAvoid(e.target.value)} placeholder="Things to avoid" />
            </div>}
            {exType !== book.book_type && <p className="text-xs text-muted-foreground">Ideas will be for a {BOOK_TYPE_INFO[exType as BookType]?.label}. Your book itself stays a {BOOK_TYPE_INFO[book.book_type as BookType]?.label ?? book.book_type}.</p>}
          </div>}
          {!locked && <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">How many:</span>
            {COUNTS.map((c) => <Button key={c} size="sm" variant={count === c ? "default" : "outline"} onClick={() => setCount(c)}>{c}</Button>)}
            <Input type="number" className="w-24" value={chapterCount} min={1} max={80} onChange={(e) => setChapterCount(Math.max(1, Math.min(80, +e.target.value || 12)))} aria-label="Chapters" />
            <span className="text-xs text-muted-foreground">chapters</span>
            <Button onClick={() => genAlternatives()} disabled={!!busy}>{busy === "alts" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{st.alternatives.length ? "New set" : "Show options"}</Button>
            <Button variant="ghost" onClick={() => up({ storyMode: "skip", selectedIndex: null, stage: "cast" })}>Skip — use my own idea</Button>
          </div>}
          {st.storyMode === "skip" && <p className="text-sm text-muted-foreground">Using your own idea. You can still pick an option later, before writing starts.</p>}
          <div className="grid gap-3">
            {st.alternatives.map((a, i) => (
              <div key={a.id + i} className={`rounded-lg border p-4 ${st.selectedIndex === i ? "border-primary" : "border-border"}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><h4 className="font-medium">{a.title}</h4><p className="text-sm text-muted-foreground">{a.logline}</p></div>
                  {!locked && <Button size="icon" variant="ghost" aria-label="Regenerate this option" disabled={!!busy} onClick={() => genAlternatives(i)}>{busy === `alt${i}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}</Button>}
                  <Button size="sm" disabled={locked} variant={st.selectedIndex === i ? "default" : "outline"} onClick={() => up({ selectedIndex: i, storyMode: "explore", stage: isFiction ? "twists" : "cast", ...(st.selectedIndex !== i ? { twists: [] } : {}) })}>{st.selectedIndex === i ? "Selected" : "Choose"}</Button>
                </div>
                <details className="mt-2"><summary className="text-xs cursor-pointer text-muted-foreground">Read the whole story</summary><p className="text-sm whitespace-pre-wrap mt-2">{a.summary}</p>{a.ending && <p className="text-sm mt-2"><span className="text-muted-foreground">Ending:</span> {a.ending}</p>}</details>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>}

      {/* 2. Twist reveal schedule (fiction only) — the twist itself is chosen at inception in step 1 */}
      {cur === "twists" && <Card>
        <CardHeader><CardTitle>2. Twist reveals & clues</CardTitle><CardDescription>{st.twistsEnabled ? "Your chosen story already carries its big twist. Here you can add extra twists and set which chapter each one is revealed in; clues are planted before, never revealed early." : "Plot twist mode is off. Turn it on in step 1 before making story options."}</CardDescription></CardHeader>
        {st.twistsEnabled && <CardContent className="space-y-3">
          {!locked && <Button variant="outline" onClick={proposeTwists} disabled={!!busy || st.selectedIndex === null}>{busy === "twists" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Suggest extra twists for the chosen story</Button>}
          {st.twists.map((t) => (
            <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
              <Textarea rows={2} value={t.text} disabled={locked} onChange={(e) => up({ twists: st.twists.map((x) => x.id === t.id ? { ...x, text: e.target.value, authorEdited: true } : x) })} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Reveal in chapter</span>
                <Input type="number" className="w-20" min={1} disabled={locked} value={t.revealChapter === null ? "" : t.revealChapter + 1} onChange={(e) => up({ twists: st.twists.map((x) => x.id === t.id ? { ...x, revealChapter: e.target.value ? Math.max(0, +e.target.value - 1) : null } : x) })} />
                <Badge variant={t.status === "approved" ? "default" : t.status === "rejected" ? "destructive" : "secondary"}>{t.status}</Badge>
                {!locked && <><Button size="sm" variant={t.status === "approved" ? "default" : "outline"} onClick={() => up({ twists: st.twists.map((x) => x.id === t.id ? { ...x, status: "approved" } : x.status === "approved" ? { ...x, status: "proposed" } : x) })}><Check className="w-3 h-3 mr-1" />{t.status === "approved" ? "Selected" : "Select this twist"}</Button>
                <Button size="sm" variant="ghost" onClick={() => up({ twists: st.twists.map((x) => x.id === t.id ? { ...x, status: "rejected" } : x) })}>Reject</Button></>}
              </div>
              {t.clues.length > 0 && <p className="text-xs text-muted-foreground">Clues: {t.clues.join(" · ")}</p>}
            </div>
          ))}
        </CardContent>}
      </Card>}

      {/* 3. Cast */}
      {cur === "cast" && <Card>
        <CardHeader><CardTitle>{isFiction ? "3" : "2"}. Characters</CardTitle>
          <CardDescription>Use characters from your library or add new ones. Book-only characters don't need a profile. Roles apply to this book only — a character's lasting profile is never changed here.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your characters" />
            <Button variant="outline" disabled={!!busy} onClick={() => run("recs", async () => { await callPlanBook({ action: "setup_save", bookId: book.id, chapterCount, setup: st }); const r = await callPlanBook({ action: "recommend_cast", bookId: book.id }); if (!r.ok) throw new Error(r.data.error); setRecs(r.data.recommendations); })}>Suggest from story</Button>
            <Button variant="ghost" onClick={() => setStudioOpen(true)}>Open Persona Studio (full profiles, AI or hybrid)</Button>
          </div>
          {libraryHits.length > 0 && <div className="flex flex-wrap gap-2">{libraryHits.map((i) => <Button key={i.id} size="sm" variant="secondary" disabled={locked && false} onClick={() => { addCast({ name: i.display_name, identityId: i.id, lightweight: false }); setSearch(""); }}><Plus className="w-3 h-3 mr-1" />{i.display_name}</Button>)}</div>}
          {recs.length > 0 && <div className="rounded-md border border-border p-3 space-y-1"><p className="text-xs text-muted-foreground">Suggestions (you decide — nothing is created or merged automatically):</p>
            {recs.map((r, i) => <div key={i} className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{r.name}</span><Badge variant="outline">{nice(r.status)}</Badge><span className="text-muted-foreground">{r.reason}</span>
              {!r.name.startsWith("(") && !st.cast.some((c) => c.name === r.name) && (r.status === "existing_match" ? <Button size="sm" variant="ghost" onClick={() => addCast({ name: r.matches[0].displayName, identityId: r.matches[0].id, lightweight: false })}>Use existing</Button> : <Button size="sm" variant="ghost" onClick={() => addCast({ name: r.name })}>Add</Button>)}</div>)}</div>}
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New character name" />
            <Button variant="outline" disabled={!newName.trim()} onClick={() => { addCast({ name: newName.trim() }); setNewName(""); }}>Add book-only</Button>
            <Button variant="outline" disabled={!newName.trim() || !!busy} onClick={() => createPersistent(newName.trim())}>Save to library</Button>
          </div>
          {pending && <div className="rounded-md border border-primary/50 p-3 space-y-2 text-sm">
            <p>"{pending.name}" looks like a character you already have. Is it the same person?</p>
            <div className="flex flex-wrap gap-2">{pending.matches.map((m: Row) => <Button key={m.id} size="sm" onClick={() => createPersistent(pending.name, "use_existing", m.id)}>Yes — {m.displayName}</Button>)}
              <Button size="sm" variant="outline" onClick={() => createPersistent(pending.name, "create_distinct")}>No — a different person</Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button></div>
          </div>}
          <div className="space-y-2">{st.cast.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
              <span className="font-medium min-w-[8rem]">{c.name}</span>
              <Badge variant="outline">{c.identityId ? "in library" : "book-only"}</Badge>
              <Select value={c.role} onValueChange={(v) => setCast(c.key, { role: v as any })}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>{BOOK_ROLES.map((r) => <SelectItem key={r} value={r}>{nice(r)}</SelectItem>)}</SelectContent></Select>
              <Input className="flex-1 min-w-[10rem]" value={c.note ?? ""} onChange={(e) => setCast(c.key, { note: e.target.value })} placeholder="Note for this book" />
              {!c.identityId && !locked && <Button size="sm" variant="ghost" onClick={() => createPersistent(c.name)}>Save to library</Button>}
              {!locked && <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => up({ cast: st.cast.filter((x) => x.key !== c.key), viewpoints: st.viewpoints.filter((v) => v.castKey !== c.key), narration: { ...st.narration, narratorKey: st.narration.narratorKey === c.key ? null : st.narration.narratorKey } })}><Trash2 className="w-4 h-4" /></Button>}
            </div>))}</div>
        </CardContent>
      </Card>}

      {/* 4. Narration, perspective, universe, pen name */}
      {cur === "narration" && <Card>
        <CardHeader><CardTitle>{isFiction ? "4" : "3"}. Narrator, perspective, universe & pen name</CardTitle>
          <CardDescription>A pen name is only the name printed as author — it never becomes a character or narrator.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">Point of view</span>
              <Select value={st.narration.pov} disabled={locked} onValueChange={(v) => up({ narration: { ...st.narration, pov: v } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(POV_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></label>
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">Narrator / main viewpoint character</span>
              <Select value={st.narration.narratorKey ?? "none"} disabled={locked} onValueChange={(v) => up({ narration: { ...st.narration, narratorKey: v === "none" ? null : v } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None / not needed</SelectItem>{st.cast.map((c) => <SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>)}</SelectContent></Select></label>
          </div>
          {st.narration.pov === "first_person" && <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">When is the story told?</span>
              <Select value={st.narration.vantage} disabled={locked} onValueChange={(v) => up({ narration: { ...st.narration, vantage: v as any } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="immediate">As it happens (immediate)</SelectItem><SelectItem value="retrospective">Looking back (retrospective)</SelectItem></SelectContent></Select></label>
            {st.narration.vantage === "retrospective" && <label className="space-y-1 text-sm"><span className="text-muted-foreground">Told from (date)</span><Input disabled={locked} value={st.narration.tellingDate ?? ""} onChange={(e) => up({ narration: { ...st.narration, tellingDate: e.target.value } })} placeholder="e.g. March 2031" /></label>}
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={st.narration.personaLed} disabled={locked} onCheckedChange={(on) => up({ narration: { ...st.narration, personaLed: on } })} />Persona-led (one character tells the whole book in first person)</label>
          </div>}
          {isFiction && <div className="space-y-2">
            <div className="flex gap-2"><Button size="sm" variant={st.perspective === "single" ? "default" : "outline"} disabled={locked} onClick={() => up({ perspective: "single", viewpoints: st.viewpoints.slice(0, 1) })}>Single perspective</Button>
              <Button size="sm" variant={st.perspective === "multiple" ? "default" : "outline"} disabled={locked} onClick={() => up({ perspective: "multiple" })}>Multiple perspectives</Button></div>
            {st.perspective === "multiple" && <div className="space-y-2">
              <p className="text-xs text-muted-foreground">One viewpoint per chapter — each character only knows what they've learned.</p>
              {st.viewpoints.map((v, i) => <div key={i} className="flex flex-wrap gap-2 items-center">
                <Select value={v.castKey} onValueChange={(k) => up({ viewpoints: st.viewpoints.map((x, j) => j === i ? { ...x, castKey: k } : x) })}><SelectTrigger className="w-40"><SelectValue placeholder="Character" /></SelectTrigger><SelectContent>{st.cast.map((c) => <SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>)}</SelectContent></Select>
                <Input className="flex-1 min-w-[10rem]" value={v.purpose} placeholder="Why this viewpoint?" onChange={(e) => up({ viewpoints: st.viewpoints.map((x, j) => j === i ? { ...x, purpose: e.target.value } : x) })} />
                <Input className="w-40" value={v.chapters.map((c) => c + 1).join(",")} placeholder="Chapters e.g. 1,3,5" onChange={(e) => up({ viewpoints: st.viewpoints.map((x, j) => j === i ? { ...x, chapters: e.target.value.split(",").map((n) => parseInt(n, 10) - 1).filter((n) => n >= 0) } : x) })} />
                <Button size="icon" variant="ghost" aria-label="Remove viewpoint" onClick={() => up({ viewpoints: st.viewpoints.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button>
              </div>)}
              {st.cast.length > 0 && !locked && <Button size="sm" variant="outline" onClick={() => up({ viewpoints: [...st.viewpoints, { castKey: st.cast[0].key, purpose: "", chapters: [] }] })}><Plus className="w-3 h-3 mr-1" />Add viewpoint</Button>}
            </div>}
          </div>}
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">Shared universe</span>
              <Select value={st.universeId ?? "none"} disabled={locked} onValueChange={(v) => { const u = v === "none" ? null : v; if (st.cast.some((c) => c.identityId)) { toast.error("Remove library characters first — characters never move between universes."); return; } up({ universeId: u }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Standalone book</SelectItem>{universes.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>
              {!locked && <Button size="sm" variant="link" className="px-0" onClick={() => run("uni", async () => { const name = window.prompt("Name of the new universe"); if (!name?.trim()) return; const { data: u } = await supabase.auth.getUser(); const { error } = await supabase.from("fictional_universes").insert({ user_id: u.user!.id, name: name.trim() }); if (error) throw error; await load(); })}>+ New universe</Button>}</label>
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">Pen name (printed as author)</span>
              <Select value={st.penNameId ?? "none"} onValueChange={(v) => up({ penNameId: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">My account name</SelectItem>{pens.map((p) => <SelectItem key={p.id} value={p.id}>{p.pen_name}</SelectItem>)}</SelectContent></Select>
              <Button size="sm" variant="link" className="px-0" onClick={() => run("pen", async () => { const name = window.prompt("New pen name"); if (!name?.trim()) return; const { data: u } = await supabase.auth.getUser(); const { error } = await supabase.from("author_identities").insert({ user_id: u.user!.id, pen_name: name.trim() }); if (error) throw error; await load(); })}>+ New pen name</Button></label>
          </div>
          {st.universeId && <p className="text-xs text-muted-foreground">Established dates, ages, deaths and relationships from this universe will be respected. Ideas in this setup never become universe facts until they're written and accepted.</p>}
        </CardContent>
      </Card>}
      {/* 5. Writer & voice — the AI author who writes the book */}
      {cur === "writer" && <Card>
        <CardHeader><CardTitle>{isFiction ? "5" : "4"}. Writer & voice</CardTitle>
          <CardDescription>Choose the writer who will write this book, then tune their voice. Each slider can move up to {MAX_ADJUST} steps from the writer's own starting point — their style still carries through every chapter.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <WriterPicker bookType={exType} value={writerId || book.controls?.writerId} onChange={(id) => run("writer", async () => {
            const { error } = await supabase.from("books").update({ controls: { ...(book.controls ?? {}), writerId: id } }).eq("id", book.id);
            if (error) throw error;
            setWriterId(id);
            const base = WRITER_BASELINES[id] ?? NEUTRAL;
            setSliders(base);
            await saveSliders(base);
            toast.success("Writer chosen"); onSaved();
          })} />
          {busy === "writer" && <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />Saving your writer…</p>}
          {(() => { const base = WRITER_BASELINES[writerId || book.controls?.writerId] ?? NEUTRAL; return (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Expression controls</h4>
              <Button size="sm" variant="outline" disabled={busy === "sliders"} onClick={() => saveSliders(sliders)}>{busy === "sliders" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Save voice</Button>
            </div>
            {(["tone", "dynamism"] as const).map((g) => (
              <div key={g} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g === "tone" ? "Tone" : "Energy & structure"}</p>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {SLIDERS.filter((s) => s.group === g).map((s) => (
                    <div key={s.key} className="space-y-1">
                      <div className="flex justify-between gap-2 text-xs"><span title={s.hint}>{s.label}</span><span className="shrink-0 text-muted-foreground">{sliders[s.key]}/10{offsetLabel(sliders[s.key], base[s.key])}</span></div>
                      <BoundedSlider label={s.label} range={[Math.max(1, base[s.key] - MAX_ADJUST), Math.min(10, base[s.key] + MAX_ADJUST)]} base={base[s.key]} value={sliders[s.key]} onChange={(v) => setSliders({ ...sliders, [s.key]: v })} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">The small mark under each rail is the writer's own starting value. Press Save voice when you're happy — you can return to this step any time before writing begins.</p>
          </div> ); })()}
        </CardContent>
      </Card>}
      </motion.div>
      </AnimatePresence>

      {isLast && issues.length > 0 && <div className="space-y-1">{issues.map((i, k) => <p key={k} className={`text-sm ${i.blocking ? "text-destructive" : "text-muted-foreground"}`}>{i.blocking ? "Fix: " : "Note: "}{i.message}</p>)}</div>}
      <div className="flex flex-wrap items-center gap-2 sticky bottom-0 bg-background py-3 border-t border-border z-10">
        <Button variant="ghost" onClick={() => go(-1)} disabled={screen === 0}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
        <Button variant="outline" onClick={() => save()} disabled={!!busy}>{busy === "save" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save</Button>
        <div className="ml-auto">
          {isLast
            ? <Button onClick={() => save("planning")} disabled={!!busy || issues.some((i) => i.blocking)}>Next: Build the plan<ArrowRight className="w-4 h-4 ml-1" /></Button>
            : <Button onClick={() => go(1)}>Next: {SCREEN_LABEL[screens[screen + 1]]}<ArrowRight className="w-4 h-4 ml-1" /></Button>}
        </div>
      </div>
      <Dialog open={studioOpen} onOpenChange={(o) => { setStudioOpen(o); if (!o) refreshLibrary(); }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto p-0">
          <DialogTitle className="sr-only">Persona Studio</DialogTitle>
          <PersonaStudioView embedded onBack={() => { setStudioOpen(false); refreshLibrary(); }}
            bookLink={{ castIdentityIds: st.cast.map((c) => c.identityId).filter(Boolean) as string[], universeId: st.universeId ?? null, locked,
              onAdd: ({ id, name }) => { const ex = st.cast.find((c) => !c.identityId && c.name.toLowerCase() === name.toLowerCase()); if (ex) setCast(ex.key, { identityId: id, lightweight: false }); else addCast({ name, identityId: id, lightweight: false }); toast.success(`${name} added to this book`); } }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
