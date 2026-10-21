// Compact upfront writer choice for Book Variants: shows the writer for the active tone,
// how well they fit it, how they interpret it, and lets the author change writer or tier.
import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { WRITER_PORTRAITS } from "@/components/WriterPortraits";
import { WRITER_PERSONAS, getWriter } from "../../supabase/functions/_shared/writers/personas";
import { TIERS, DEFAULT_WRITER_TIER, type Tier } from "../../supabase/functions/_shared/writers/profiles";
import { matchWriterToTone, recommendWriterForTone, type ToneFit } from "../../supabase/functions/_shared/writers/toneMatch";

const FIT_LABEL: Record<ToneFit, string> = { natural: "Natural match", adapts: "Adapts well", stretch: "Stretch" };
const FIT_CLASS: Record<ToneFit, string> = {
  natural: "border-primary/50 bg-primary/10 text-primary",
  adapts: "border-border bg-muted text-foreground",
  stretch: "border-destructive/50 bg-destructive/10 text-destructive",
};

export function WriterToneSelector({ bookId, bookType, genre, tone, writerId, disabled, onChange }: {
  bookId: string; bookType: string; genre?: string; tone: string; writerId: string; disabled?: boolean; onChange: (id: string) => void;
}) {
  const w = getWriter(writerId) ?? recommendWriterForTone(tone, bookType, genre);
  const rec = recommendWriterForTone(tone, bookType, genre);
  const match = matchWriterToTone(w.id, tone);
  const [tier, setTier] = useState<Tier | null>(null);
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.functions.invoke("model-config", { body: { action: "get", bookId } }).then(({ data }) => {
      if (!data?.config) return;
      setCfg(data.config);
      setTier(data.config.mode === "profile" ? data.config.profileTier ?? DEFAULT_WRITER_TIER : null);
    }).catch(() => {});
  }, [bookId]);

  // Keep a fixed writer profile pointed at the writer shown here.
  useEffect(() => {
    if (cfg?.mode === "profile" && cfg.profileWriter !== w.id) saveCfg({ ...cfg, profileWriter: w.id }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.id, cfg?.mode]);

  const saveCfg = async (next: Record<string, unknown>, notify = true) => {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("model-config", { body: { action: "save", bookId, config: next } });
    setSaving(false);
    if (error || data?.error) { toast.error("Couldn't save the writer tier"); return; }
    setCfg(data.config); setTier(data.config.profileTier ?? null);
    if (notify) toast.success("Writer tier saved");
  };
  const pickTier = (t: Tier) => saveCfg({ ...(cfg ?? {}), mode: "profile", profileWriter: w.id, profileTier: t });
  const tierLabel = TIERS.find((t) => t.value === (tier ?? DEFAULT_WRITER_TIER))?.label ?? "Professional";

  const explain = (
    <div className="space-y-2 text-xs">
      <p className="font-medium text-sm">{w.name} <span className="text-muted-foreground font-normal">· {w.tagline}</span></p>
      {match ? <>
        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] ${FIT_CLASS[match.fit]}`}>{FIT_LABEL[match.fit]} for “{tone}”</span>
        <p>{match.reason}</p>
        <p className="text-muted-foreground">{match.lens}</p>
        {match.fit !== "natural" && rec.id !== w.id && <p>Closest match for this tone: <span className="text-foreground font-medium">{rec.name}</span>.</p>}
      </> : <p className="text-muted-foreground">Pick a tone to see how {w.name.split(" ")[0]} would carry it. Book Variants are written in this writer's voice.</p>}
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HoverCard openDelay={250}>
        <HoverCardTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled} aria-label="Writer for this book"
              className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-left hover:border-primary/50 disabled:opacity-60">
              <img src={WRITER_PORTRAITS[w.id]} alt={w.name} width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
              <span className="min-w-0">
                <span className="block text-xs font-medium leading-tight">{w.name}</span>
                <span className="block text-[10px] text-muted-foreground leading-tight">{tierLabel}{match ? ` · ${FIT_LABEL[match.fit]}` : ""}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </PopoverTrigger>
        </HoverCardTrigger>
        <HoverCardContent align="end" className="w-80">{explain}</HoverCardContent>
      </HoverCard>
      <PopoverContent align="end" className="w-[22rem] max-h-[70vh] overflow-y-auto space-y-3">
        {explain}
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Writer mode {saving && <Loader2 className="inline h-3 w-3 animate-spin" />}</p>
          <div className="flex flex-wrap gap-1">
            {TIERS.map((t) => <Button key={t.value} size="sm" className="h-7 px-2 text-xs" variant={(tier ?? DEFAULT_WRITER_TIER) === t.value ? "default" : "outline"} disabled={saving} onClick={() => pickTier(t.value)}>{t.label}</Button>)}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Change writer</p>
          {[...WRITER_PERSONAS].sort((a, b) => {
            const qa = a.bookTypes.includes(bookType) ? 0 : 1, qb = b.bookTypes.includes(bookType) ? 0 : 1;
            if (qa !== qb) return qa - qb;
            return (matchWriterToTone(a.id, tone)?.gap ?? 0) - (matchWriterToTone(b.id, tone)?.gap ?? 0);
          }).map((p) => {
            const m = matchWriterToTone(p.id, tone);
            return (
              <button key={p.id} type="button" onClick={() => { onChange(p.id); setOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-md border p-1.5 text-left ${p.id === w.id ? "border-primary bg-primary/5" : "border-transparent hover:border-border"}`}>
                <img src={WRITER_PORTRAITS[p.id]} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
                <span className="min-w-0 flex-1"><span className="block text-xs">{p.name}{p.id === rec.id && <span className="ml-1 text-[9px] text-primary">Suggested</span>}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{p.tagline}</span></span>
                {m && <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${FIT_CLASS[m.fit]}`}>{FIT_LABEL[m.fit]}</span>}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
