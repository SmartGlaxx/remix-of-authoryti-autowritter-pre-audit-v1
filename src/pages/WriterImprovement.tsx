import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { getWriter } from "../../supabase/functions/_shared/writers/personas";
import { callLearning, CATEGORY_LABELS } from "@/lib/naturalnessUi";

type Rec = { writerId: string; genre: string | null; category: string; dimension: string; confidence: number; adjustment: { directive: string; slider?: { key: string; delta: number } }; evidence: { sections?: number; chapters?: number; books?: number } };
type Weak = { writerId: string; category: string; genre: string | null; sections: number; chapters: number; recurring: boolean };
type Overlay = { id: string; writer_id: string; dimension: string; status: string; version: number; adjustment: { directive?: string }; created_at: string; confidence?: number };

const writerName = (id: string) => getWriter(id)?.name ?? id;

export default function WriterImprovement() {
  const [data, setData] = useState<{ weaknesses: Weak[]; recommendations: Rec[]; overlays: Overlay[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await callLearning({ action: "recommendations" });
    if (!r.ok) { setErr(r.data?.error ?? "Could not load"); return; }
    setErr(null); setData(r.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (r: Rec) => {
    setBusy(`a-${r.writerId}-${r.category}`);
    const res = await callLearning({ action: "approve", writerId: r.writerId, category: r.category, genre: r.genre });
    setBusy(null);
    if (!res.ok) { toast.error(res.data?.message ?? res.data?.error ?? "Could not approve"); return; }
    toast.success(`Approved for ${writerName(r.writerId)}. Applies to new sections in books using Analyze + targeted rewrite.`); load();
  };
  const revert = async (o: Overlay) => {
    setBusy(`r-${o.id}`);
    const res = await callLearning({ action: "revert", overlayId: o.id });
    setBusy(null);
    if (!res.ok) { toast.error(res.data?.error ?? "Could not undo"); return; }
    toast.success("Improvement switched off. The writer's original personality is unchanged."); load();
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-6 space-y-4">
        <Button variant="ghost" size="sm" asChild><Link to="/dashboard"><ArrowLeft className="w-4 h-4 mr-1" />Back</Link></Button>
        <h1 className="font-display text-2xl">Writer Improvement Studio</h1>
        <p className="text-sm text-muted-foreground">Patterns that keep recurring across your books become suggested improvements. Nothing changes until you approve it, and you can undo any improvement. The 48 original writer personalities are never altered.</p>
        {err && <p className="text-sm text-destructive">{err} <Button size="sm" variant="outline" onClick={load}>Retry</Button></p>}
        {!data && !err && <Loader2 className="w-5 h-5 animate-spin" />}
        {data && <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Suggested improvements</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!data.recommendations.length && <p className="text-xs text-muted-foreground">None yet. A suggestion appears only when a pattern recurs in at least 3 sections across 2 chapters and you have corrected or approved a fix for it at least once.</p>}
              {data.recommendations.map((r) => (
                <div key={`${r.writerId}-${r.category}-${r.genre}`} className="rounded-md border border-border/60 p-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{writerName(r.writerId)}</span>
                    <Badge variant="outline">{CATEGORY_LABELS[r.category] ?? r.category}</Badge>
                    {r.genre && <Badge variant="secondary">{r.genre}</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">Confidence {Math.round(r.confidence * 100)}%</span>
                  </div>
                  <p className="text-xs">{r.adjustment.directive}</p>
                  <p className="text-xs text-muted-foreground">Seen in {r.evidence.sections ?? "?"} sections across {r.evidence.chapters ?? "?"} chapters.{r.adjustment.slider ? ` Nudges ${r.adjustment.slider.key} by ${r.adjustment.slider.delta > 0 ? "+" : ""}${r.adjustment.slider.delta} (within the writer's limits).` : ""}</p>
                  <Button size="sm" disabled={!!busy} onClick={() => approve(r)}>{busy === `a-${r.writerId}-${r.category}` && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Approve</Button>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Improvements history</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!data.overlays.length && <p className="text-xs text-muted-foreground">No improvements approved yet.</p>}
              {data.overlays.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2 text-xs border-b border-border/40 pb-2">
                  <span className="font-medium">{writerName(o.writer_id)}</span>
                  <span className="text-muted-foreground">{o.dimension} · v{o.version}</span>
                  <Badge variant={o.status === "active" ? "default" : "secondary"}>{o.status === "active" ? "On" : o.status === "reverted" ? "Off" : "Proposed"}</Badge>
                  <span className="flex-1 min-w-[12rem]">{o.adjustment?.directive}</span>
                  {o.status !== "reverted" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => revert(o)}>Undo</Button>}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Patterns being watched</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {!data.weaknesses.length && <p className="text-xs text-muted-foreground">Nothing yet. Turn on style checks in a book's settings to start collecting.</p>}
              {data.weaknesses.map((w, i) => (
                <p key={i} className="text-xs">{writerName(w.writerId)} — {CATEGORY_LABELS[w.category] ?? w.category}: {w.sections} sections / {w.chapters} chapters {w.recurring ? <Badge variant="outline" className="ml-1">recurring</Badge> : null}</p>
              ))}
            </CardContent>
          </Card>
        </>}
      </main>
    </div>
  );
}
