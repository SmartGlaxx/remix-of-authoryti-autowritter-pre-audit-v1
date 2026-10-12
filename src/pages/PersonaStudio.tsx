import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Sparkles, Users, Globe2, Feather, ArrowUpCircle, ArrowDownCircle, Check, X, Link2, Pencil, Trash2, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  personaStudio, PERSONA_DOMAINS, labelOf, checkLifeChronology,
  type IdentityResolution, type PersonaSuggestion, type AuthorFact,
} from "@/lib/personaStudio";
import { PersonaAvatar, ImageLightbox, PersonaDetailDialog, PersonaEditDialog, ConfirmDelete, UniverseDetailDialog } from "@/components/persona/PersonaExtras";
import { emptySetup, normalizeSetup } from "../../supabase/functions/_shared/narrative/planning/bookSetup";
import { PromotionCard, PromoteButton } from "@/components/persona/PromotionCard";

type Row = Record<string, any>;
type DateVal = { precision: string; year?: number; month?: number; day?: number } | null;
const NONE = "__none__";

function DateField({ label, value, onChange }: { label: string; value: DateVal; onChange: (v: DateVal) => void }) {
  const p = value?.precision ?? "unknown";
  const set = (patch: Partial<NonNullable<DateVal>>) => onChange({ ...(value ?? { precision: "year" }), ...patch } as DateVal);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <Select value={p} onValueChange={(v) => (v === "unknown" ? onChange(null) : set({ precision: v }))}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unknown">Unknown</SelectItem>
            <SelectItem value="exact">Exact date</SelectItem>
            <SelectItem value="month_year">Month & year</SelectItem>
            <SelectItem value="year">Year only</SelectItem>
            <SelectItem value="approximate">About (±2 yrs)</SelectItem>
          </SelectContent>
        </Select>
        {p !== "unknown" && <Input className="w-24" type="number" placeholder="Year" value={value?.year ?? ""} onChange={(e) => set({ year: e.target.value ? Number(e.target.value) : undefined })} />}
        {(p === "exact" || p === "month_year") && <Input className="w-20" type="number" min={1} max={12} placeholder="Month" value={value?.month ?? ""} onChange={(e) => set({ month: e.target.value ? Number(e.target.value) : undefined })} />}
        {p === "exact" && <Input className="w-20" type="number" min={1} max={31} placeholder="Day" value={value?.day ?? ""} onChange={(e) => set({ day: e.target.value ? Number(e.target.value) : undefined })} />}
      </div>
    </div>
  );
}

const fmtDate = (d: DateVal) => !d ? "?" : d.precision === "exact" ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : d.precision === "month_year" ? `${d.month}/${d.year}` : d.precision === "approximate" ? `c. ${d.year}` : String(d.year ?? "?");

function ConfirmIdentity({ resolution, onDecide, onCancel }: { resolution: IdentityResolution | null; onDecide: (d: "create_distinct" | "use_existing", id?: string) => void; onCancel: () => void }) {
  return (
    <Dialog open={!!resolution} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Is this the same character?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          {resolution?.status === "EXACT_MATCH" ? "A character with this name already exists in this universe." : "Similar names already exist in this universe."} Nothing is merged unless you choose.
        </p>
        <div className="space-y-2">
          {resolution?.matches.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-md border border-border p-3">
              <div><div className="font-medium">{m.displayName}</div><div className="text-xs text-muted-foreground">{labelOf(m.reason)}</div></div>
              <Button size="sm" variant="outline" onClick={() => onDecide("use_existing", m.id)}><Link2 className="w-4 h-4" />Same person</Button>
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onDecide("create_distinct")}>Different person — create new</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonaEditor({ open, onClose, universes, onSaved }: { open: boolean; onClose: () => void; universes: Row[]; onSaved: () => void }) {
  const [mode, setMode] = useState<"manual" | "ai" | "hybrid">("manual");
  const [name, setName] = useState(""); const [aliases, setAliases] = useState("");
  const [domain, setDomain] = useState("general"); const [universeId, setUniverseId] = useState(NONE);
  const [birth, setBirth] = useState<DateVal>(null); const [death, setDeath] = useState<DateVal>(null);
  const [values, setValues] = useState(""); const [flaw, setFlaw] = useState(""); const [fear, setFear] = useState("");
  const [motivation, setMotivation] = useState(""); const [voice, setVoice] = useState(""); const [seed, setSeed] = useState("");
  const [suggestions, setSuggestions] = useState<PersonaSuggestion[]>([]); const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [resolution, setResolution] = useState<IdentityResolution | null>(null);

  const reset = () => { setMode("manual"); setName(""); setAliases(""); setDomain("general"); setUniverseId(NONE); setBirth(null); setDeath(null); setValues(""); setFlaw(""); setFear(""); setMotivation(""); setVoice(""); setSeed(""); setSuggestions([]); setRejected([]); };
  const authorFacts = (): AuthorFact[] => {
    const f: AuthorFact[] = [];
    if (name.trim()) f.push({ field: "displayName", value: name.trim() });
    if (birth) f.push({ field: "birthDate", value: birth });
    if (death) f.push({ field: "deathDate", value: death });
    if (values.trim()) f.push({ field: "coreValues", value: values.split(",").map((s) => s.trim()).filter(Boolean) });
    if (flaw.trim()) f.push({ field: "flaw", value: flaw.trim() });
    if (fear.trim()) f.push({ field: "fear", value: fear.trim() });
    if (motivation.trim()) f.push({ field: "motivation", value: motivation.trim() });
    if (voice.trim()) f.push({ field: "voiceSample", value: voice.trim() });
    return f;
  };

  const generate = async () => {
    setBusy(true);
    const { data } = await personaStudio("generate", { mode: mode === "ai" ? "ai_generate" : "hybrid", domain, seed, authorFacts: mode === "hybrid" ? authorFacts() : [] });
    setBusy(false);
    if (data.error) return toast.error(data.error);
    setSuggestions(data.draft.suggestions); setRejected(data.draft.rejectedOverrides);
    if (!name.trim()) setName(data.draft.displayName);
    if (data.engine === "mock") toast.message("Test suggestions shown (no AI credits used).");
  };
  const setStatus = (i: number, status: PersonaSuggestion["status"]) => setSuggestions((s) => s.map((x, j) => (j === i ? { ...x, status } : x)));

  const save = async (decision?: "create_distinct" | "use_existing", existingId?: string) => {
    if (!name.trim()) return toast.error("Give the persona a name.");
    const accepted = suggestions.filter((s) => s.status === "accepted");
    const pick = (field: string) => accepted.find((s) => s.field === field)?.value;
    const birthDate = birth ?? (pick("birthDate") as DateVal) ?? null;
    const deathDate = death ?? (pick("deathDate") as DateVal) ?? null;
    const local = checkLifeChronology(birthDate as any, deathDate as any, []);
    if (local.some((f) => f.verdict === "violation")) return toast.error("Death date is before birth date.");
    setBusy(true);
    const { httpStatus, data } = await personaStudio("create_persona", {
      displayName: name.trim(), aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
      universeId: universeId === NONE ? null : universeId, domain, creationMode: mode,
      birthDate, deathDate,
      psychology: {
        coreValues: values ? values.split(",").map((s) => s.trim()).filter(Boolean) : pick("coreValues") ?? [],
        flaw: flaw || pick("flaw") || null, fear: fear || pick("fear") || null, motivation: motivation || pick("motivation") || null,
        backstory: pick("backstory") ?? null,
      },
      voiceSample: voice || (pick("voiceSample") as string) || "",
      userFacts: authorFacts(), aiExpansions: suggestions.filter((s) => s.status !== "discarded"),
      decision, existingId,
    });
    setBusy(false);
    if (httpStatus === 409 && data.status === "needs_confirmation") return setResolution(data.resolution);
    if (data.error) return toast.error(data.error === "CHRONOLOGY_VIOLATION" ? "Dates are out of order." : data.error);
    toast.success(data.reused ? "Persona profile attached to the existing character." : "Persona saved.");
    setResolution(null); reset(); onSaved(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New persona</DialogTitle></DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="grid grid-cols-3"><TabsTrigger value="manual">Manual</TabsTrigger><TabsTrigger value="ai">AI Generate</TabsTrigger><TabsTrigger value="hybrid">Hybrid</TabsTrigger></TabsList>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Also known as (comma separated)</Label><Input value={aliases} onChange={(e) => setAliases(e.target.value)} /></div>
          <div className="space-y-1"><Label>Domain</Label>
            <Select value={domain} onValueChange={setDomain}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PERSONA_DOMAINS.map((d) => <SelectItem key={d} value={d}>{labelOf(d)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Universe</Label>
            <Select value={universeId} onValueChange={setUniverseId}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>No shared universe</SelectItem>{universes.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Domain is the persona's lasting field. Their role (protagonist, mentor…) is chosen per book.</p>
        {mode !== "ai" && (
          <div className="grid gap-3">
            <DateField label="Born" value={birth} onChange={setBirth} />
            <DateField label="Died" value={death} onChange={setDeath} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Core values</Label><Input value={values} onChange={(e) => setValues(e.target.value)} placeholder="loyalty, honesty" /></div>
              <div className="space-y-1"><Label>Flaw</Label><Input value={flaw} onChange={(e) => setFlaw(e.target.value)} /></div>
              <div className="space-y-1"><Label>Deepest fear</Label><Input value={fear} onChange={(e) => setFear(e.target.value)} /></div>
              <div className="space-y-1"><Label>Motivation</Label><Input value={motivation} onChange={(e) => setMotivation(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Voice sample</Label><Textarea rows={2} value={voice} onChange={(e) => setVoice(e.target.value)} /></div>
          </div>
        )}
        {mode !== "manual" && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <Label>{mode === "ai" ? "Describe the persona you want" : "Anything else the AI should build on"}</Label>
            <Textarea rows={2} value={seed} onChange={(e) => setSeed(e.target.value)} />
            {mode === "hybrid" && <p className="text-xs text-muted-foreground">Everything you typed above is locked — suggestions can only fill gaps.</p>}
            <Button variant="outline" size="sm" onClick={generate} disabled={busy}><Sparkles className="w-4 h-4" />Suggest details</Button>
            {rejected.length > 0 && <p className="text-xs text-muted-foreground">Ignored suggestions that tried to change your facts: {rejected.map(labelOf).join(", ")}.</p>}
            {suggestions.map((s, i) => (
              <div key={i} className={`rounded-md border p-2 text-sm ${s.status === "discarded" ? "opacity-50 border-border" : s.status === "accepted" ? "border-primary" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><Badge variant="secondary" className="mr-2">AI suggestion</Badge><span className="font-medium">{labelOf(s.field)}:</span>{" "}
                    <span className="break-words">{typeof s.value === "string" ? s.value : JSON.stringify(s.value)}</span></div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" aria-label="Accept" onClick={() => setStatus(i, "accepted")}><Check className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Discard" onClick={() => setStatus(i, "discarded")}><X className="w-4 h-4" /></Button>
                  </div>
                </div>
                {s.rationale && <div className="text-xs text-muted-foreground mt-1">{s.rationale}</div>}
              </div>
            ))}
          </div>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save()} disabled={busy}>Save persona</Button></DialogFooter>
        <ConfirmIdentity resolution={resolution} onCancel={() => setResolution(null)} onDecide={(d, id) => save(d, id)} />
      </DialogContent>
    </Dialog>
  );
}

function RelationshipDialog({ subject, identities, onClose, onSaved }: { subject: Row | null; identities: Row[]; onClose: () => void; onSaved: () => void }) {
  const [target, setTarget] = useState(""); const [type, setType] = useState(""); const [quality, setQuality] = useState("");
  const options = identities.filter((i) => subject && i.id !== subject.id && (i.universe_id ?? null) === (subject.universe_id ?? null));
  const save = async () => {
    const { data } = await personaStudio("create_relationship", { subjectId: subject!.id, targetId: target, relationshipType: type, emotionalQuality: quality });
    if (data.error) return toast.error(data.error);
    toast.success("Relationship added."); setTarget(""); setType(""); setQuality(""); onSaved(); onClose();
  };
  return (
    <Dialog open={!!subject} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add relationship for {subject?.display_name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Only characters from the same universe are listed.</p>
        <Select value={target} onValueChange={setTarget}><SelectTrigger><SelectValue placeholder="Choose a character" /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.display_name}</SelectItem>)}</SelectContent></Select>
        <Input placeholder="Relationship (e.g. mentor, sister, rival)" value={type} onChange={(e) => setType(e.target.value)} />
        <Input placeholder="Feeling between them (optional)" value={quality} onChange={(e) => setQuality(e.target.value)} />
        <DialogFooter><Button onClick={save} disabled={!target || !type.trim()}>Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PersonaStudio() {
  const navigate = useNavigate();
  return <PersonaStudioView onBack={() => navigate("/dashboard")} />;
}

/** One Persona Studio for both the standalone page and the in-book-setup window. */
export interface BookLink { bookId?: string; castIdentityIds: string[]; universeId: string | null; locked?: boolean; onAdd: (p: { id: string; name: string }) => void }
export function PersonaStudioView({ onBack, embedded = false, bookLink }: { onBack: () => void; embedded?: boolean; bookLink?: BookLink }) {
  const { user } = useAuth();
  const [identities, setIdentities] = useState<Row[]>([]); const [personas, setPersonas] = useState<Row[]>([]);
  const [universes, setUniverses] = useState<Row[]>([]); const [penNames, setPenNames] = useState<Row[]>([]);
  const [relationships, setRelationships] = useState<Row[]>([]); const [characters, setCharacters] = useState<Row[]>([]);
  const [books, setBooks] = useState<Row[]>([]); const [roles, setRoles] = useState<Row[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null); const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null); const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false); const [relFor, setRelFor] = useState<Row | null>(null);
  const [search, setSearch] = useState(""); const [domainFilter, setDomainFilter] = useState("all"); const [uniFilter, setUniFilter] = useState("all");
  const [promoteRes, setPromoteRes] = useState<{ id: string; resolution: IdentityResolution } | null>(null);
  const [reuseSource, setReuseSource] = useState<Row | null>(null);
  const [reuseBook, setReuseBook] = useState("library");
  const [reuseName, setReuseName] = useState("");
  const [reuseBusy, setReuseBusy] = useState(false);
  const [reuseCreated, setReuseCreated] = useState<string | null>(null);
  const openReuse = (source: Row) => { setReuseSource(source); setReuseName(source.display_name); setReuseBook(bookLink?.bookId ?? "library"); setReuseCreated(null); };
  const reuse = async () => {
    if (!reuseSource || !reuseName.trim()) return;
    setReuseBusy(true);
    try {
      const bookId = reuseBook === "library" ? null : reuseBook;
      if (bookId === bookLink?.bookId && (bookById[bookId]?.universe_id ?? null) !== bookLink?.universeId) throw new Error("Save your book's universe choice first, then reuse this character.");
      let identityId = reuseCreated;
      if (!identityId) {
        const { data } = await personaStudio("reuse_deleted", { identityId: reuseSource.id, bookId, displayName: reuseName });
        if (data.error) throw new Error(data.error);
        identityId = data.identityId;
        setReuseCreated(identityId);
      }
      if (!identityId) throw new Error("Could not create the persona.");
      if (bookId) {
        if (bookLink?.bookId === bookId && (bookById[bookId]?.universe_id ?? null) === bookLink.universeId) {
          if (bookLink.locked) throw new Error("This book's cast is locked.");
          bookLink.onAdd({ id: identityId, name: reuseName.trim() });
        } else {
          const { data: book, error } = await supabase.from("books").select("story_setup, universe_id").eq("id", bookId).single();
          if (error) throw error;
          const setup = normalizeSetup(book.story_setup ?? emptySetup());
          setup.universeId = book.universe_id ?? null;
          if (!setup.cast.some((c) => c.identityId === identityId)) setup.cast.push({ key: crypto.randomUUID(), name: reuseName.trim(), role: "supporting", identityId, lightweight: false });
          const { data } = await personaStudioSetupSave(bookId, setup);
          if (data.error) throw new Error(data.error);
        }
      }
      toast.success(bookId ? "New persona added to the book." : "New persona saved for a future book.");
      setReuseSource(null); setReuseCreated(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not reuse this persona."); }
    finally { setReuseBusy(false); }
  };

  const load = useCallback(async () => {
    if (!user) return;
    const [i, p, u, n, r, c, b, br] = await Promise.all([
      supabase.from("narrative_identities").select("*").is("merged_into_id", null).order("display_name"),
      supabase.from("personas").select("*"),
      supabase.from("fictional_universes").select("*").eq("is_archived", false).order("name"),
      supabase.from("author_identities").select("*").eq("is_archived", false).order("pen_name"),
      supabase.from("narrative_relationships").select("*"),
      supabase.from("story_characters").select("id, book_id, name, role, narrative_identity_id, source_key").eq("is_active", true).limit(500),
      supabase.from("books").select("id, title, universe_id, author_identity_id, cover_url, characters"),
      supabase.from("book_identity_roles").select("book_id, identity_id, narrative_role"),
    ]);
    setRoles(br.data ?? []);
    setIdentities(i.data ?? []); setPersonas(p.data ?? []); setUniverses(u.data ?? []); setPenNames(n.data ?? []);
    setRelationships(r.data ?? []); setCharacters(c.data ?? []); setBooks(b.data ?? []);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const idById = useMemo(() => Object.fromEntries(identities.map((i) => [i.id, i])), [identities]);
  const uniById = useMemo(() => Object.fromEntries(universes.map((u) => [u.id, u])), [universes]);
  const bookById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);
  const library = personas
    .filter((p) => !p.is_archived)
    .map((p: any) => ({ ...p, identity: idById[p.identity_id] }) as any)
    .filter((p) => p.identity)
    .filter((p) => domainFilter === "all" || p.category === domainFilter)
    .filter((p) => uniFilter === "all" || (p.identity.universe_id ?? NONE) === uniFilter)
    .filter((p) => !search.trim() || [p.identity.display_name, ...(p.identity.aliases ?? [])].some((n: string) => n.toLowerCase().includes(search.toLowerCase())));
  const personaIds = new Set(personas.filter((p) => !p.is_archived).map((p) => p.identity_id));
  const promotable = characters.filter((c) => !c.narrative_identity_id || !personaIds.has(c.narrative_identity_id));

  const promoteGroups = promotable.reduce<Record<string, Row[]>>((g, c) => { (g[c.book_id] ??= []).push(c); return g; }, {});
  const orphans = identities.filter((i) => i.seed_details?.deleted_book_title && !personaIds.has(i.id));
  const orphanGroups = orphans.reduce<Record<string, Row[]>>((g, i) => { (g[i.seed_details.deleted_book_title] ??= []).push(i); return g; }, {});
  const personaById = useMemo(() => Object.fromEntries(personas.map((p: any) => [p.id, { ...p, identity: idById[p.identity_id] }])), [personas, idById]);
  const personaByIdentity = useMemo(() => Object.fromEntries(personas.map((p) => [p.identity_id, p])), [personas]);
  const detail = detailId ? personaById[detailId] : null;
  const promoteIdentity = async (identityId: string) => {
    const { data } = await personaStudio("promote", { identityId });
    if (data.error) return toast.error(data.error);
    toast.success("Promoted to persona."); load();
  };
  const demote = async (id: string) => {
    const { data } = await personaStudio("demote", { personaId: id });
    if (data.error) return toast.error(data.error);
    setDetailId(null); toast.success("Demoted. Profile, picture and book links are kept."); await load();
  };
  const deletePersona = async (id: string) => {
    const { error } = await supabase.from("personas").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setDeleteId(null); setDetailId(null); toast.success("Persona deleted. The character stays in any books it appears in."); load();
  };
  const promote = async (scId: string, decision?: string, existingId?: string) => {
    const { httpStatus, data } = await personaStudio("promote_character", { storyCharacterId: scId, decision, existingId });
    if (httpStatus === 409 && data.status === "needs_confirmation") return setPromoteRes({ id: scId, resolution: data.resolution });
    if (data.error) return toast.error(data.error);
    setPromoteRes(null); toast.success("Promoted to persona."); load();
  };

  return (
    <div className={embedded ? "bg-background" : "min-h-screen bg-background"}>
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label={embedded ? "Back to book setup" : "Back"}><ArrowLeft className="w-5 h-5" /></Button>
          <div className="min-w-0 flex-1"><h1 className="text-xl font-serif font-semibold">Persona Studio</h1><p className="text-sm text-muted-foreground truncate">Characters, universes and pen names that live beyond one book</p></div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <Tabs defaultValue="personas">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="personas"><Users className="w-4 h-4 mr-1" />Personas</TabsTrigger>
            <TabsTrigger value="universes"><Globe2 className="w-4 h-4 mr-1" />Universes</TabsTrigger>
            <TabsTrigger value="pennames"><Feather className="w-4 h-4 mr-1" />Pen names</TabsTrigger>
            <TabsTrigger value="promote"><ArrowUpCircle className="w-4 h-4 mr-1" />Promote characters</TabsTrigger>
          </TabsList>

          <TabsContent value="personas" className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input className="w-full sm:w-56" placeholder="Search names" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={domainFilter} onValueChange={setDomainFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All domains</SelectItem>{PERSONA_DOMAINS.map((d) => <SelectItem key={d} value={d}>{labelOf(d)}</SelectItem>)}</SelectContent></Select>
              <Select value={uniFilter} onValueChange={setUniFilter}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All universes</SelectItem><SelectItem value={NONE}>No universe</SelectItem>{universes.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>
              <Button className="ml-auto" onClick={() => setEditorOpen(true)}><Plus className="w-4 h-4" />New persona</Button>
            </div>
            {library.length === 0 && <p className="text-sm text-muted-foreground">No personas yet. Create one, or promote a character from one of your books.</p>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {library.map((p) => {
                const rels = relationships.filter((r) => r.subject_identity_id === p.identity_id || r.target_identity_id === p.identity_id);
                const featured = new Set(roles.filter((r) => r.identity_id === p.identity_id).map((r) => r.book_id));
                return (
                  <Card key={p.id} className="cursor-pointer transition-colors hover:border-primary/60" onClick={() => setDetailId(p.id)}>
                    <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
                      <PersonaAvatar path={p.portrait_path} name={p.identity.display_name} onOpen={(url) => setZoom({ url, name: p.identity.display_name })} />
                      <div className="min-w-0 flex-1"><CardTitle className="text-base truncate">{p.identity.display_name}</CardTitle>
                      <div className="mt-1 flex flex-wrap gap-1"><Badge variant="secondary">{labelOf(p.category)}</Badge>
                        {p.identity.universe_id && <Badge variant="outline">{uniById[p.identity.universe_id]?.name}</Badge>}</div></div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="text-muted-foreground">Born {fmtDate(p.birth_date)}{p.death_date ? ` · Died ${fmtDate(p.death_date)}` : ""}</div>
                      {(p.identity.aliases ?? []).length > 0 && <div className="text-xs text-muted-foreground truncate">Also: {p.identity.aliases.join(", ")}</div>}
                      {p.psychology?.motivation && <div className="line-clamp-2">{p.psychology.motivation}</div>}
                      {featured.size > 0 && <div className="text-xs"><span className="text-muted-foreground">Books: </span>{[...featured].map((id) => bookById[id]?.title).filter(Boolean).join(", ")}</div>}
                      {rels.length > 0 && <div className="text-xs text-muted-foreground">{rels.length} relationship{rels.length > 1 ? "s" : ""}</div>}
                      {p.identity.seed_details?.deleted_book_title && <div className="text-xs text-destructive">{p.identity.seed_details.deleted_book_title} · Book deleted</div>}
                      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        {p.identity.seed_details?.deleted_book_title && <Button size="sm" variant="outline" onClick={() => openReuse(p.identity)}><Plus className="w-4 h-4" />Reuse in a book</Button>}
                        <Button size="sm" variant="outline" onClick={() => setRelFor(p.identity)}><Link2 className="w-4 h-4" />Relationship</Button>
                        <Button size="icon" variant="ghost" aria-label="Edit persona" onClick={() => setEditId(p.id)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="outline" title="Undo promotion. Keeps the character, picture and profile for later." onClick={() => demote(p.id)}><ArrowDownCircle className="w-4 h-4" />Demote</Button>
                        <Button size="icon" variant="ghost" aria-label="Delete persona" className="text-destructive" onClick={() => setDeleteId(p.id)}><Trash2 className="w-4 h-4" /></Button>
                        {bookLink && (() => {
                          const inBook = bookLink.castIdentityIds.includes(p.identity_id);
                          const wrongUniverse = (bookLink.universeId ?? null) !== (p.identity.universe_id ?? null);
                          if (inBook) return <Badge className="h-8 px-3">✓ In this book</Badge>;
                          return <Button size="sm" disabled={bookLink.locked || wrongUniverse} title={wrongUniverse ? "This persona belongs to a different universe than this book" : undefined} onClick={() => bookLink.onAdd({ id: p.identity_id, name: p.identity.display_name })}><Plus className="w-4 h-4" />{wrongUniverse ? "Other universe" : "Add to this book"}</Button>;
                        })()}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="universes"><UniverseTab universes={universes} identities={identities} books={books} onChange={load} userId={user?.id} personaByIdentity={personaByIdentity}
            onOpenPersona={(iid) => { const p = personaByIdentity[iid]; if (p) setDetailId(p.id); }} /></TabsContent>
          <TabsContent value="pennames"><PenNameTab penNames={penNames} books={books} onChange={load} userId={user?.id} /></TabsContent>

          <TabsContent value="promote" className="space-y-3">
            <p className="text-sm text-muted-foreground">Characters from your books. Promoting keeps the same character and all their links; it just adds a full persona profile.</p>
            {promotable.length === 0 && orphans.length === 0 && !personas.some((p) => p.is_archived) && <p className="text-sm text-muted-foreground">No characters to promote yet.</p>}
            {Object.entries(promoteGroups).map(([bookId, list]) => (
              <div key={bookId} className="rounded-lg border border-border bg-card/40 p-3 space-y-2">
                <div className="flex items-center gap-2 font-medium"><BookOpen className="w-4 h-4 text-primary" />{bookById[bookId]?.title ?? "Book"}<Badge variant="secondary">{list.length}</Badge></div>
                {list.map((c) => (
                  <PromotionCard key={c.id} name={c.name} identity={idById[c.narrative_identity_id]} profile={personaByIdentity[c.narrative_identity_id]}
                    character={(Array.isArray(bookById[bookId]?.characters) ? bookById[bookId].characters : []).find((x: Row) => x.id === c.source_key || x.name === c.name)}
                    onOpen={(url) => setZoom({ url, name: c.name })}>
                    {c.role && <Badge variant="secondary">{labelOf(c.role)}</Badge>}<PromoteButton onClick={() => promote(c.id)} />
                  </PromotionCard>
                ))}
              </div>
            ))}
            {Object.entries(orphanGroups).map(([title, list]) => (
              <div key={title} className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-center gap-2 font-medium text-destructive"><BookOpen className="w-4 h-4" />{title}<Badge variant="destructive">Book deleted</Badge></div>
                {list.map((c) => (
                  <PromotionCard key={c.id} name={c.display_name} identity={c} profile={personaByIdentity[c.id]} onOpen={(url) => setZoom({ url, name: c.display_name })}>
                    <PromoteButton onClick={() => promoteIdentity(c.id)} /><Button size="sm" onClick={() => openReuse(c)}><Plus className="w-4 h-4" />Reuse in a book</Button>
                  </PromotionCard>
                ))}
              </div>
            ))}
            {personas.filter((p) => p.is_archived && !characters.some((c) => c.narrative_identity_id === p.identity_id) && !orphans.some((i) => i.id === p.identity_id)).map((p) => {
              const id = idById[p.identity_id]; if (!id) return null;
              return <PromotionCard key={p.id} name={id.display_name} profile={p} identity={id} onOpen={(url) => setZoom({ url, name: id.display_name })}><Badge variant="secondary">Demoted</Badge><PromoteButton onClick={() => promoteIdentity(id.id)} /><Button size="sm" variant="outline" onClick={() => setEditId(p.id)}><Pencil className="w-4 h-4" />Edit</Button></PromotionCard>;
            })}
          </TabsContent>
        </Tabs>
      </main>
      {detail && <PersonaDetailDialog persona={detail} fmtDate={fmtDate} universeName={detail.identity?.universe_id ? uniById[detail.identity.universe_id]?.name : undefined}
        relationships={relationships.filter((r) => r.subject_identity_id === detail.identity_id || r.target_identity_id === detail.identity_id)} idById={idById}
        books={books} roles={roles} onClose={() => setDetailId(null)} onEdit={() => setEditId(detail.id)} onDelete={() => setDeleteId(detail.id)} />}
      <PersonaEditDialog persona={editId ? personaById[editId] ?? null : null} userId={user?.id} onClose={() => setEditId(null)} onSaved={load} />
      <ConfirmDelete open={!!deleteId} title="Delete this persona?" body="The persona profile is removed. The character itself stays in any books it already appears in." onCancel={() => setDeleteId(null)} onConfirm={() => deleteId && deletePersona(deleteId)} />
      <ImageLightbox url={zoom?.url ?? null} alt={zoom?.name ?? ""} onClose={() => setZoom(null)} />
      <PersonaEditor open={editorOpen} onClose={() => setEditorOpen(false)} universes={universes} onSaved={load} />
      <Dialog open={!!reuseSource} onOpenChange={(o) => { if (!o && !reuseBusy) setReuseSource(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Give this character a new story</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Keep their profile and picture as a starting point. This creates a separate persona; old relationships and story events stay behind.</p>
          <Label htmlFor="reuse-name">Persona name</Label><Input id="reuse-name" value={reuseName} disabled={reuseBusy || !!reuseCreated} onChange={(e) => setReuseName(e.target.value)} />
          <Label>Use in</Label><Select value={reuseBook} disabled={reuseBusy || !!reuseCreated} onValueChange={setReuseBook}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="library">Save for a new book later</SelectItem>
            {books.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}{b.id === bookLink?.bookId ? " (this book)" : ""}</SelectItem>)}
          </SelectContent></Select>
          <DialogFooter><Button variant="ghost" disabled={reuseBusy} onClick={() => setReuseSource(null)}>Cancel</Button><Button disabled={reuseBusy || !reuseName.trim() || (bookLink?.locked && reuseBook === bookLink.bookId)} onClick={reuse}>{reuseBusy ? "Saving…" : reuseCreated ? "Retry adding to book" : reuseBook === "library" ? "Create new persona" : "Create & add to book"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <RelationshipDialog subject={relFor} identities={identities} onClose={() => setRelFor(null)} onSaved={load} />
      <ConfirmIdentity resolution={promoteRes?.resolution ?? null} onCancel={() => setPromoteRes(null)} onDecide={(d, id) => promoteRes && promote(promoteRes.id, d, id)} />
    </div>
  );
}

async function personaStudioSetupSave(bookId: string, setup: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plan-book`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ action: "setup_save", bookId, setup }),
  });
  return { data: await response.json() };
}

function UniverseTab({ universes, identities, books, onChange, userId, personaByIdentity, onOpenPersona, bookLink }: { universes: Row[]; identities: Row[]; books: Row[]; onChange: () => void; userId?: string; personaByIdentity: Record<string, Row>; onOpenPersona: (id: string) => void; bookLink?: BookLink }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = universes.find((u) => u.id === openId) ?? null;
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [genre, setGenre] = useState("");
  const add = async () => {
    if (!name.trim() || !userId) return;
    const { error } = await supabase.from("fictional_universes").insert({ user_id: userId, name: name.trim(), description: desc || null, genre: genre || null });
    if (error) return toast.error(error.message);
    setName(""); setDesc(""); setGenre(""); toast.success("Universe created."); onChange();
  };
  const assign = async (bookId: string, universeId: string | null) => {
    const { error } = await supabase.from("books").update({ universe_id: universeId } as any).eq("id", bookId);
    if (error) return toast.error(error.message.includes("NARRATOR") ? "This book's narrator belongs to another universe." : error.message);
    onChange();
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="sm:col-span-2"><CardContent className="pt-6 grid gap-2 sm:grid-cols-3">
        <Input placeholder="Universe name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Genre (optional)" value={genre} onChange={(e) => setGenre(e.target.value)} />
        <Button onClick={add} disabled={!name.trim()}><Plus className="w-4 h-4" />Create universe</Button>
        <Textarea className="sm:col-span-3" rows={2} placeholder="What is this world? (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </CardContent></Card>
      {universes.map((u) => {
        const cast = identities.filter((i) => i.universe_id === u.id);
        const inBooks = books.filter((b) => b.universe_id === u.id);
        return (
          <Card key={u.id} className="cursor-pointer transition-colors hover:border-primary/60" onClick={() => setOpenId(u.id)}>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Globe2 className="w-4 h-4 text-primary" />{u.name}</CardTitle>{u.description && <p className="text-sm text-muted-foreground line-clamp-2">{u.description}</p>}</CardHeader>
            <CardContent className="space-y-3 text-sm">
              {inBooks.length > 0 && <div className="flex gap-2 overflow-hidden">{inBooks.slice(0, 8).map((b) => (
                <div key={b.id} className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-sm border border-border bg-secondary" title={b.title}>
                  {b.cover_url ? <img src={b.cover_url} alt={b.title} className="w-full h-full object-cover" /> : <div className="flex h-full items-center justify-center p-0.5 text-center text-[8px] leading-tight text-primary">{b.title}</div>}
                </div>))}</div>}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{inBooks.length} books</Badge><Badge variant="secondary">{cast.length} characters</Badge><Badge variant="secondary">{(u.locations ?? []).length} locations</Badge>
              </div>
              {bookLink?.onUniverse && <div onClick={(e) => e.stopPropagation()}>
                {(bookLink.universeId ?? null) === u.id
                  ? <div className="flex flex-wrap gap-2"><Badge className="h-8 px-3"><Check className="w-4 h-4 mr-1" />This book's universe</Badge>
                      <Button size="sm" variant="ghost" disabled={bookLink.locked} onClick={() => bookLink.onUniverse!(null)}>Make standalone</Button></div>
                  : <Button size="sm" disabled={bookLink.locked} onClick={() => bookLink.onUniverse!(u.id)}><Plus className="w-4 h-4" />Put this book here</Button>}
              </div>}
            </CardContent></Card>
        );
      })}
      {open && <UniverseDetailDialog universe={open} books={books.filter((b) => b.universe_id === open.id)} cast={identities.filter((i) => i.universe_id === open.id)}
        personaByIdentity={personaByIdentity} onClose={() => setOpenId(null)} onChanged={onChange} onOpenPersona={(id) => { setOpenId(null); onOpenPersona(id); }} />}
    </div>
  );
}

function PenNameTab({ penNames, books, onChange, userId }: { penNames: Row[]; books: Row[]; onChange: () => void; userId?: string }) {
  const [pen, setPen] = useState(""); const [bio, setBio] = useState(""); const [genres, setGenres] = useState("");
  const add = async () => {
    if (!pen.trim() || !userId) return;
    const { error } = await supabase.from("author_identities").insert({ user_id: userId, pen_name: pen.trim(), bio: bio || null, genres: genres.split(",").map((s) => s.trim()).filter(Boolean) });
    if (error) return toast.error(error.message);
    setPen(""); setBio(""); setGenres(""); toast.success("Pen name added."); onChange();
  };
  const assign = async (bookId: string, id: string) => {
    const { error } = await supabase.from("books").update({ author_identity_id: id } as any).eq("id", bookId);
    if (error) return toast.error(error.message); onChange();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">A pen name is the name printed on your cover. It is never a character in your stories, and it is separate from the AI writer that drafts your prose.</p>
      <Card><CardContent className="pt-6 grid gap-2 sm:grid-cols-3">
        <Input placeholder="Pen name" value={pen} onChange={(e) => setPen(e.target.value)} />
        <Input placeholder="Genres (comma separated)" value={genres} onChange={(e) => setGenres(e.target.value)} />
        <Button onClick={add} disabled={!pen.trim()}><Plus className="w-4 h-4" />Add pen name</Button>
        <Textarea className="sm:col-span-3" rows={2} placeholder="Author bio (optional)" value={bio} onChange={(e) => setBio(e.target.value)} />
      </CardContent></Card>
      {penNames.map((p) => (
        <Card key={p.id}><CardHeader className="pb-2"><CardTitle className="text-base">{p.pen_name}</CardTitle>{p.bio && <p className="text-sm text-muted-foreground">{p.bio}</p>}</CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-1">{(p.genres ?? []).map((g: string) => <Badge key={g} variant="secondary">{g}</Badge>)}</div>
            <div><span className="text-muted-foreground">Books: </span>{books.filter((b) => b.author_identity_id === p.id).map((b) => b.title).join(", ") || "none yet"}</div>
            <Select value="" onValueChange={(v) => assign(v, p.id)}><SelectTrigger className="w-64"><SelectValue placeholder="Publish a book under this name" /></SelectTrigger>
              <SelectContent>{books.filter((b) => b.author_identity_id !== p.id).map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}</SelectContent></Select>
          </CardContent></Card>
      ))}
    </div>
  );
}
