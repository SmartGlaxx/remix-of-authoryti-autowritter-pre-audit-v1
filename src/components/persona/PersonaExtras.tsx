import { useEffect, useState } from "react";
import { BookOpen, Camera, MapPin, Pencil, Trash2, Users, X, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { labelOf } from "@/lib/personaStudio";

type Row = Record<string, any>;
const BUCKET = "persona-portraits";
const urlCache = new Map<string, string>();

/** Signed URL for a private portrait path (cached per session). */
export function usePortraitUrl(path?: string | null) {
  const [url, setUrl] = useState<string | null>(path ? urlCache.get(path) ?? null : null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    if (urlCache.has(path)) { setUrl(urlCache.get(path)!); return; }
    let live = true;
    supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7).then(({ data }) => {
      if (data?.signedUrl && live) { urlCache.set(path, data.signedUrl); setUrl(data.signedUrl); }
    });
    return () => { live = false; };
  }, [path]);
  return url;
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

export function PersonaAvatar({ path, name, size = "md", onOpen }: { path?: string | null; name: string; size?: "sm" | "md" | "lg"; onOpen?: (url: string) => void }) {
  const url = usePortraitUrl(path);
  const dims = size === "lg" ? "w-40 h-40 text-4xl" : size === "sm" ? "w-8 h-8 text-xs" : "w-14 h-14 text-lg";
  return (
    <button type="button" disabled={!url || !onOpen} onClick={(e) => { e.stopPropagation(); url && onOpen?.(url); }}
      className={`${dims} shrink-0 overflow-hidden rounded-full border-2 border-primary/40 bg-secondary flex items-center justify-center font-display text-primary ${url && onOpen ? "cursor-zoom-in hover:border-primary" : "cursor-default"}`}
      aria-label={url ? `View ${name} full size` : name}>
      {url ? <img src={url} alt={name} className="w-full h-full object-cover" /> : initials(name)}
    </button>
  );
}

export function ImageLightbox({ url, alt, onClose }: { url: string | null; alt: string; onClose: () => void }) {
  return (
    <Dialog open={!!url} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-2 bg-background/95">
        {url && <img src={url} alt={alt} className="w-full max-h-[85vh] object-contain rounded-md" />}
      </DialogContent>
    </Dialog>
  );
}

function Section({ dot, title, children }: { dot: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} />{title}</div>
      {children}
    </div>
  );
}
const Bullets = ({ items }: { items: [string, React.ReactNode][] }) => {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length));
  if (!shown.length) return <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>;
  return <ol className="list-decimal space-y-1 pl-5 text-sm marker:text-primary">{shown.map(([k, v]) => <li key={k}><span className="text-muted-foreground">{k}:</span> {v}</li>)}</ol>;
};

export function PersonaDetailDialog({ persona, fmtDate, universeName, relationships, idById, books, roles, onClose, onEdit, onDelete }: {
  persona: Row | null; fmtDate: (d: any) => string; universeName?: string; relationships: Row[]; idById: Record<string, Row>;
  books: Row[]; roles: Row[]; onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (!persona) return null;
  const id = persona.identity; const psy = persona.psychology ?? {};
  const featured = roles.filter((r) => r.identity_id === persona.identity_id).map((r) => ({ role: r.narrative_role, book: books.find((b) => b.id === r.book_id) })).filter((x) => x.book);
  const origin = id.origin_book_id ? books.find((b) => b.id === id.origin_book_id) : null;
  const deletedTitle = id.seed_details?.deleted_book_title;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="sr-only">{id.display_name}</DialogTitle></DialogHeader>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <PersonaAvatar path={persona.portrait_path} name={id.display_name} size="lg" onOpen={setZoom} />
          <div className="min-w-0 text-center sm:text-left">
            <h2 className="font-display text-2xl">{id.display_name}</h2>
            <div className="mt-2 flex flex-wrap justify-center gap-1 sm:justify-start">
              <Badge>{labelOf(persona.category)}</Badge><Badge variant="outline">{labelOf(persona.creation_mode)}</Badge>
              {universeName && <Badge variant="secondary">{universeName}</Badge>}
            </div>
            <div className="mt-3 flex justify-center gap-2 sm:justify-start">
              <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="w-4 h-4" />Edit</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={onDelete}><Trash2 className="w-4 h-4" />Delete</Button>
            </div>
          </div>
        </div>
        <div className="grid gap-3">
          <Section dot="bg-primary" title="Personal details">
            <Bullets items={[
              ["Also known as", (id.aliases ?? []).join(", ")], ["Born", persona.birth_date ? fmtDate(persona.birth_date) : null],
              ["Died", persona.death_date ? fmtDate(persona.death_date) : null], ["Field", labelOf(persona.category)],
              ["Universe", universeName ?? "No shared universe"],
            ]} />
          </Section>
          <Section dot="bg-accent" title="Inner life">
            <Bullets items={[
              ["Core values", Array.isArray(psy.coreValues) ? psy.coreValues.join(", ") : psy.coreValues], ["Flaw", psy.flaw],
              ["Deepest fear", psy.fear], ["Motivation", psy.motivation], ["Backstory", psy.backstory],
            ]} />
          </Section>
          {persona.voice_sample && <Section dot="bg-muted-foreground" title="Voice"><blockquote className="border-l-2 border-primary pl-3 text-sm italic">{persona.voice_sample}</blockquote></Section>}
          <Section dot="bg-primary/60" title="Relationships">
            <Bullets items={relationships.map((r) => {
              const other = idById[r.subject_identity_id === persona.identity_id ? r.target_identity_id : r.subject_identity_id];
              return [labelOf(r.relationship_type), `${other?.display_name ?? "?"}${r.emotional_quality ? ` (${r.emotional_quality})` : ""}`] as [string, string];
            })} />
          </Section>
          <Section dot="bg-destructive/70" title="Books">
            <Bullets items={[
              ...featured.map((f) => [f.book!.title, labelOf(f.role)] as [string, string]),
              ...(origin && !featured.some((f) => f.book!.id === origin.id) ? [[origin.title, "First appeared here"] as [string, string]] : []),
              ...(deletedTitle ? [[deletedTitle, <span key="d" className="text-destructive">Book deleted</span>] as [string, React.ReactNode]] : []),
            ]} />
          </Section>
        </div>
        <ImageLightbox url={zoom} alt={id.display_name} onClose={() => setZoom(null)} />
      </DialogContent>
    </Dialog>
  );
}

export function PersonaEditDialog({ persona, userId, onClose, onSaved }: { persona: Row | null; userId?: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Row>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!persona) return;
    const p = persona.psychology ?? {};
    setF({ name: persona.identity.display_name, aliases: (persona.identity.aliases ?? []).join(", "), values: Array.isArray(p.coreValues) ? p.coreValues.join(", ") : p.coreValues ?? "",
      flaw: p.flaw ?? "", fear: p.fear ?? "", motivation: p.motivation ?? "", backstory: p.backstory ?? "", voice: persona.voice_sample ?? "" });
    setFile(null);
  }, [persona]);
  if (!persona) return null;
  const set = (k: string) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.name?.trim()) return toast.error("Name is required.");
    setBusy(true);
    try {
      let portrait_path = persona.portrait_path ?? null;
      if (file && userId) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${userId}/${persona.id}-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
        if (error) throw error;
        portrait_path = path;
      }
      const { error: e1 } = await supabase.from("narrative_identities").update({
        display_name: f.name.trim(), aliases: String(f.aliases).split(",").map((s) => s.trim()).filter(Boolean),
      }).eq("id", persona.identity_id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("personas").update({
        portrait_path, voice_sample: f.voice || null,
        psychology: { ...(persona.psychology ?? {}), coreValues: String(f.values).split(",").map((s) => s.trim()).filter(Boolean), flaw: f.flaw || null, fear: f.fear || null, motivation: f.motivation || null, backstory: f.backstory || null },
      } as any).eq("id", persona.id);
      if (e2) throw e2;
      toast.success("Persona updated."); onSaved(); onClose();
    } catch (e: any) { toast.error(e.message ?? "Could not save"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit {persona.identity.display_name}</DialogTitle></DialogHeader>
        <div className="flex items-center gap-3">
          {file ? <img src={URL.createObjectURL(file)} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-primary/40" /> : <PersonaAvatar path={persona.portrait_path} name={f.name || "?"} />}
          <Label className="cursor-pointer inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            <Camera className="w-4 h-4" />{persona.portrait_path || file ? "Change picture" : "Add picture"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x && x.size > 5 * 1024 * 1024) return toast.error("Pictures must be under 5 MB."); setFile(x ?? null); }} />
          </Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Name</Label><Input value={f.name ?? ""} onChange={set("name")} /></div>
          <div className="space-y-1"><Label>Also known as</Label><Input value={f.aliases ?? ""} onChange={set("aliases")} /></div>
          <div className="space-y-1"><Label>Core values</Label><Input value={f.values ?? ""} onChange={set("values")} /></div>
          <div className="space-y-1"><Label>Flaw</Label><Input value={f.flaw ?? ""} onChange={set("flaw")} /></div>
          <div className="space-y-1"><Label>Deepest fear</Label><Input value={f.fear ?? ""} onChange={set("fear")} /></div>
          <div className="space-y-1"><Label>Motivation</Label><Input value={f.motivation ?? ""} onChange={set("motivation")} /></div>
        </div>
        <div className="space-y-1"><Label>Backstory</Label><Textarea rows={3} value={f.backstory ?? ""} onChange={set("backstory")} /></div>
        <div className="space-y-1"><Label>Voice sample</Label><Textarea rows={2} value={f.voice ?? ""} onChange={set("voice")} /></div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDelete({ open, title, body, onCancel, onConfirm }: { open: boolean; title: string; body: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{body}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>Delete</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A universe opened like a library: shelf of covers, cast and locations. */
export function UniverseDetailDialog({ universe, books, cast, personaByIdentity, onClose, onChanged, onOpenPersona }: {
  universe: Row | null; books: Row[]; cast: Row[]; personaByIdentity: Record<string, Row>; onClose: () => void; onChanged: () => void; onOpenPersona: (identityId: string) => void;
}) {
  const [edit, setEdit] = useState(false); const [name, setName] = useState(""); const [genre, setGenre] = useState(""); const [desc, setDesc] = useState("");
  const [locName, setLocName] = useState(""); const [locDesc, setLocDesc] = useState(""); const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (universe) { setName(universe.name); setGenre(universe.genre ?? ""); setDesc(universe.description ?? ""); setEdit(false); } }, [universe]);
  if (!universe) return null;
  const locations: Row[] = Array.isArray(universe.locations) ? universe.locations : [];
  const update = async (patch: Row) => {
    const { error } = await supabase.from("fictional_universes").update(patch as any).eq("id", universe.id);
    if (error) return toast.error(error.message); onChanged();
  };
  const addLoc = async () => { if (!locName.trim()) return; await update({ locations: [...locations, { name: locName.trim(), description: locDesc.trim() || null }] }); setLocName(""); setLocDesc(""); };
  const removeBook = async (id: string) => { const { error } = await supabase.from("books").update({ universe_id: null } as any).eq("id", id); if (error) return toast.error(error.message); onChanged(); };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl">{universe.name}</DialogTitle></DialogHeader>
        {edit ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <Input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Genre" />
            <Textarea className="sm:col-span-2" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" />
            <div className="flex gap-2"><Button size="sm" onClick={async () => { await update({ name: name.trim() || universe.name, genre: genre || null, description: desc || null }); setEdit(false); }}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button></div>
          </div>
        ) : (
          <div className="space-y-2">
            {universe.genre && <Badge variant="secondary">{universe.genre}</Badge>}
            {universe.description && <p className="text-sm text-muted-foreground">{universe.description}</p>}
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil className="w-4 h-4" />Edit</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirm(true)}><Trash2 className="w-4 h-4" />Delete</Button></div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="flex items-center gap-2 font-semibold"><BookOpen className="w-4 h-4 text-primary" />Bookshelf ({books.length})</h3>
          {books.length === 0 ? <p className="text-sm text-muted-foreground">No books in this universe yet.</p> : (
            <div className="rounded-lg border border-border bg-card/40 p-4">
              <div className="flex gap-4 overflow-x-auto pb-3">
                {books.map((b) => (
                  <div key={b.id} className="group relative w-28 shrink-0">
                    <div className="aspect-[2/3] overflow-hidden rounded-r-md rounded-l-sm border border-border bg-secondary shadow-lg transition-transform group-hover:-translate-y-1">
                      {b.cover_url ? <img src={b.cover_url} alt={b.title} className="w-full h-full object-cover" /> :
                        <div className="flex h-full items-center justify-center p-2 text-center font-display text-xs text-primary">{b.title}</div>}
                    </div>
                    <p className="mt-1 truncate text-xs" title={b.title}>{b.title}</p>
                    <button onClick={() => removeBook(b.id)} className="absolute right-1 top-1 hidden rounded-full bg-background/90 p-1 group-hover:block" aria-label={`Remove ${b.title} from universe`}><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
              <div className="h-2 rounded-full bg-primary/30" />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="flex items-center gap-2 font-semibold"><Users className="w-4 h-4 text-primary" />Characters ({cast.length})</h3>
          {cast.length === 0 ? <p className="text-sm text-muted-foreground">No characters yet.</p> : (
            <div className="flex flex-wrap gap-2">
              {cast.map((c) => {
                const p = personaByIdentity[c.id];
                return (
                  <button key={c.id} disabled={!p} onClick={() => onOpenPersona(c.id)} className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1 pr-3 text-sm hover:border-primary disabled:cursor-default">
                    <PersonaAvatar path={p?.portrait_path} name={c.display_name} size="sm" />{c.display_name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="flex items-center gap-2 font-semibold"><MapPin className="w-4 h-4 text-primary" />Locations ({locations.length})</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm marker:text-primary">
            {locations.map((l, i) => (
              <li key={i}><span className="font-medium">{l.name}</span>{l.description ? <span className="text-muted-foreground"> — {l.description}</span> : null}
                <button className="ml-2 text-muted-foreground hover:text-destructive" aria-label={`Delete ${l.name}`} onClick={() => update({ locations: locations.filter((_, j) => j !== i) })}><X className="inline w-3 h-3" /></button></li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Input className="w-full sm:w-48" placeholder="Location name" value={locName} onChange={(e) => setLocName(e.target.value)} />
            <Input className="w-full sm:flex-1" placeholder="Short description (optional)" value={locDesc} onChange={(e) => setLocDesc(e.target.value)} />
            <Button size="sm" onClick={addLoc} disabled={!locName.trim()}><Plus className="w-4 h-4" />Add</Button>
          </div>
        </div>
        <ConfirmDelete open={confirm} title={`Delete ${universe.name}?`} body="The universe is removed from your library. Books and characters are kept but no longer grouped under it."
          onCancel={() => setConfirm(false)} onConfirm={async () => {
            await supabase.from("books").update({ universe_id: null } as any).eq("universe_id", universe.id);
            await update({ is_archived: true }); setConfirm(false); onClose();
          }} />
      </DialogContent>
    </Dialog>
  );
}
