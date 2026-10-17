import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Feather, ChevronDown, ChevronUp } from "lucide-react";
import { analyzeSection } from "../../supabase/functions/_shared/writers/naturalnessMetrics";
import { NATURALNESS_PLANNED, NATURALNESS_OPERATIONAL, protectedMotifLabels, resolveNaturalnessMode, type NaturalnessFinding } from "../../supabase/functions/_shared/writers/naturalness";
import { CATEGORY_LABELS, MODE_LABELS, motifCandidate } from "@/lib/naturalnessUi";

type Finding = { id: string; chapter_index: number; subsection_index: number | null; category: string; severity: string; message: string; evidence: any; status: string };
type Artifact = { id: string; artifact_type: string; label: string; status: string };

/** Book's intentional motifs; shared by the panel and held-draft checks. */
export function useMotifs(bookId: string) {
  const [rows, setRows] = useState<Artifact[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from("book_literary_artifacts").select("id, artifact_type, label, status").eq("book_id", bookId).order("created_at");
    setRows((data ?? []) as Artifact[]);
  }, [bookId]);
  useEffect(() => { load(); }, [load]);
  const add = async (label: string) => {
    const l = label.trim().slice(0, 120);
    if (!l) return false;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { toast.error("Please sign in again."); return false; }
    const { error } = await supabase.from("book_literary_artifacts").insert({ book_id: bookId, user_id: u.user.id, artifact_type: "verbal_motif", label: l, content: { source: "naturalness" } });
    if (error) { toast.error(error.message); return false; }
    toast.success(`"${l}" marked as an intentional motif. It won't be flagged again.`); await load(); return true;
  };
  const retire = async (id: string) => {
    const { error } = await supabase.from("book_literary_artifacts").update({ status: "retired" }).eq("id", id);
    if (error) toast.error(error.message); else await load();
  };
  return { rows, labels: protectedMotifLabels(rows), add, retire };
}

export function FindingList({ findings, onStatus, onMotif }: { findings: (Finding | (NaturalnessFinding & { id?: string; status?: string }))[]; onStatus?: (id: string, s: "accepted" | "dismissed" | "open") => void; onMotif?: (label: string) => void }) {
  if (!findings.length) return <p className="text-xs text-muted-foreground">No style notes.</p>;
  return (
    <ul className="space-y-2">
      {findings.map((f, i) => {
        const motif = motifCandidate(f.evidence as any);
        return (
          <li key={(f as Finding).id ?? i} className="rounded-md border border-border/60 p-2 text-xs space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{CATEGORY_LABELS[f.category] ?? f.category}</Badge>
              {"chapter_index" in f && <span className="text-muted-foreground">Ch {f.chapter_index + 1}{f.subsection_index != null ? `, §${f.subsection_index + 1}` : ""}</span>}
              {f.status && f.status !== "open" && <Badge variant="secondary">{f.status === "accepted" ? "Noted" : "Dismissed"}</Badge>}
            </div>
            <p>{f.message}</p>
            {(f.evidence as any)?.opening && <p className="italic text-muted-foreground">“{String((f.evidence as any).opening).slice(0, 200)}”</p>}
            {(f.evidence as any)?.stockPhrases?.length > 0 && <p className="italic text-muted-foreground">{(f.evidence as any).stockPhrases.slice(0, 5).map((p: string) => `“${p}”`).join(", ")}</p>}
            <div className="flex flex-wrap gap-1">
              {onStatus && (f as Finding).id && (f.status === "open" ? <>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => onStatus((f as Finding).id, "accepted")}>Noted, will fix</Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => onStatus((f as Finding).id, "dismissed")}>Dismiss</Button>
              </> : <Button size="sm" variant="ghost" className="h-7" onClick={() => onStatus((f as Finding).id, "open")}>Reopen</Button>)}
              {onMotif && motif && <Button size="sm" variant="ghost" className="h-7" onClick={() => onMotif(motif)}>Mark “{motif.slice(0, 40)}” as intentional</Button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Style notes for completed sections. chapterIndex given → one chapter; omitted → whole-manuscript summary. */
export function NaturalnessPanel({ bookId, controls, chapterIndex }: { bookId: string; controls: unknown; chapterIndex?: number }) {
  const mode = resolveNaturalnessMode(controls);
  const [rows, setRows] = useState<Finding[]>([]);
  const [open, setOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [newMotif, setNewMotif] = useState("");
  const motifs = useMotifs(bookId);
  const load = useCallback(async () => {
    let q = supabase.from("naturalness_findings").select("id, chapter_index, subsection_index, category, severity, message, evidence, status").eq("book_id", bookId).order("chapter_index").order("subsection_index").limit(500);
    if (chapterIndex !== undefined) q = q.eq("chapter_index", chapterIndex);
    const { data } = await q;
    setRows((data ?? []) as Finding[]);
  }, [bookId, chapterIndex]);
  useEffect(() => { load(); }, [load]);
  const setStatus = async (id: string, status: "accepted" | "dismissed" | "open") => {
    const { error } = await supabase.from("naturalness_findings").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else setRows((r) => r.map((x) => x.id === id ? { ...x, status } : x));
  };
  const visible = rows.filter((r) => (showClosed || r.status === "open") && !motifs.labels.some((m) => JSON.stringify(r.evidence ?? {}).toLowerCase().includes(m.toLowerCase())));
  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) if (r.status === "open") m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [rows]);
  const openCount = rows.filter((r) => r.status === "open").length;
  if (mode === "off" && !rows.length) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setOpen(!open)}>
        <CardTitle className="text-sm flex items-center gap-2">
          <Feather className="w-4 h-4 text-primary" />
          {chapterIndex === undefined ? "Writing style — whole book" : "Writing style notes"}
          <Badge variant="outline" className="ml-1">{openCount} open</Badge>
          <span className="text-xs font-normal text-muted-foreground ml-auto">{MODE_LABELS[mode].label}</span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Advice only — these notes never block writing or acceptance. Checked today: {NATURALNESS_OPERATIONAL.map((c) => CATEGORY_LABELS[c]).join(", ")}. Not yet available: {NATURALNESS_PLANNED.join(", ")}.</p>
          {chapterIndex === undefined && Object.keys(byCat).length > 0 && (
            <div className="flex flex-wrap gap-2">{Object.entries(byCat).map(([c, n]) => <Badge key={c} variant="secondary">{CATEGORY_LABELS[c] ?? c}: {n}</Badge>)}</div>
          )}
          <FindingList findings={visible} onStatus={setStatus} onMotif={motifs.add} />
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide reviewed" : "Show reviewed"}</Button>
          <div className="border-t border-border/60 pt-2 space-y-2">
            <p className="text-xs font-medium">Intentional motifs (never flagged)</p>
            <div className="flex flex-wrap gap-1">
              {motifs.rows.filter((m) => m.status === "active").map((m) => (
                <Badge key={m.id} variant="outline" className="gap-1">{m.label}<button aria-label={`Remove motif ${m.label}`} className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => motifs.retire(m.id)}>×</button></Badge>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await motifs.add(newMotif)) setNewMotif(""); }}>
              <Input value={newMotif} onChange={(e) => setNewMotif(e.target.value)} placeholder="e.g. nine beats, pause" className="h-8 text-xs" maxLength={120} />
              <Button size="sm" type="submit" disabled={!newMotif.trim()}>Add</Button>
            </form>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/** Free, local style check of a held draft (before acceptance). */
export function checkDraft(text: string, motifs: string[], bookType?: string) {
  return analyzeSection(text, { protectedMotifs: motifs, bookType });
}
