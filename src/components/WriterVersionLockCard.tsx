import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { callLearning } from "@/lib/naturalnessUi";
import { getWriter } from "../../supabase/functions/_shared/writers/personas";

type Overlay = { id: string; writer_id: string; dimension: string; status: string; version: number; confidence?: number; adjustment: { directive?: string; slider?: { key: string; delta: number } } };
type LockMode = "latest" | "pinned" | "base";

export function lockModeOf(pins: unknown): LockMode {
  if (!Array.isArray(pins)) return "latest";
  return pins.length ? "pinned" : "base";
}

/** Book-level lock for author-approved writer improvements. Only affects sections written later. */
export function WriterVersionLockCard({ bookId, writerId, controls }: { bookId: string; writerId: string; controls: Record<string, unknown> }) {
  const [overlays, setOverlays] = useState<Overlay[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<LockMode>(lockModeOf(controls.adaptationPins));
  const [selected, setSelected] = useState<string[]>(Array.isArray(controls.adaptationPins) ? (controls.adaptationPins as string[]) : []);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const r = await callLearning({ action: "recommendations", writerId });
    if (!r.ok) { setErr(r.data?.error ?? "Could not load improvements"); return; }
    setOverlays(((r.data?.overlays ?? []) as Overlay[]).filter((o) => o.writer_id === writerId));
  }, [writerId]);
  useEffect(() => { load(); }, [load]);

  const save = async (next: LockMode, ids: string[]) => {
    setBusy(true);
    const overlayIds = next === "latest" ? null : next === "base" ? [] : ids;
    const r = await callLearning({ action: "pin", bookId, overlayIds });
    setBusy(false);
    if (!r.ok) { toast.error(r.data?.error ?? "Could not save"); return; }
    controls.adaptationPins = overlayIds; setMode(next); setSelected(ids);
    toast.success(next === "latest" ? "Following latest approved improvements" : next === "base" ? "Locked to the writer's original voice" : `Locked to ${ids.length} improvement version(s)`);
  };

  const active = (overlays ?? []).filter((o) => o.status === "active");
  const name = getWriter(writerId)?.name ?? writerId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Writer improvement versions</CardTitle>
        <p className="text-xs text-muted-foreground">Choose which approved improvements {name} uses in this book. Only used with “Analyze + targeted rewrite”. Changing this never alters sections already accepted.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Improvement version lock">
          {([["latest", "Follow latest"], ["pinned", "Lock to chosen versions"], ["base", "Original voice only"]] as [LockMode, string][]).map(([m, l]) => (
            <Button key={m} role="radio" aria-checked={mode === m} size="sm" className="rounded-full" variant={mode === m ? "default" : "outline"} disabled={busy || (m === "pinned" && !active.length)}
              onClick={() => m === "pinned" ? setMode("pinned") : mode !== m && save(m, [])}>{l}</Button>
          ))}
          {busy && <Loader2 className="w-4 h-4 animate-spin self-center" />}
        </div>
        {err && <p className="text-xs text-destructive">{err} <Button size="sm" variant="outline" className="h-6 ml-1" onClick={load}>Retry</Button></p>}
        {!overlays && !err && <Loader2 className="w-4 h-4 animate-spin" />}
        {overlays && !overlays.length && <p className="text-xs text-muted-foreground">No approved improvements for {name} yet. Approve them in the Writer Improvement Studio.</p>}
        {overlays && overlays.length > 0 && (
          <ul className="space-y-2">
            {overlays.map((o) => {
              const isActive = o.status === "active";
              const checked = selected.includes(o.id);
              const inUse = isActive && (mode === "latest" || (mode === "pinned" && checked));
              return (
                <li key={o.id} className="flex items-start gap-2 rounded-md border border-border/60 p-2 text-xs">
                  {mode === "pinned" && <Checkbox aria-label={`Lock ${o.dimension} v${o.version}`} disabled={!isActive || busy} checked={checked}
                    onCheckedChange={(v) => setSelected((s) => v ? [...s, o.id] : s.filter((x) => x !== o.id))} />}
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{o.dimension}</span><span className="text-muted-foreground">v{o.version}</span>
                      <Badge variant={inUse ? "default" : "secondary"}>{inUse ? "Used in this book" : isActive ? "Not used here" : "Switched off"}</Badge>
                      {o.confidence != null && <span className="text-muted-foreground ml-auto">Confidence {Math.round(o.confidence * 100)}%</span>}
                    </div>
                    <p>{o.adjustment?.directive}</p>
                    {o.adjustment?.slider && <p className="text-muted-foreground">Nudges {o.adjustment.slider.key} by {o.adjustment.slider.delta > 0 ? "+" : ""}{o.adjustment.slider.delta}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {mode === "pinned" && <Button size="sm" disabled={busy || !selected.length} onClick={() => save("pinned", selected)}>Save locked versions</Button>}
      </CardContent>
    </Card>
  );
}
