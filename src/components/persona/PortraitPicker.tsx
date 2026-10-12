import { useEffect, useState } from "react";
import { Check, Sparkles, Upload, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { personaStudio } from "@/lib/personaStudio";
import { toast } from "sonner";
import { MAX_PORTRAIT_OPTIONS } from "../../../supabase/functions/_shared/narrative/personaControls";

export function PortraitPicker({ personaId, description, onSelect, onOpen, onBusy }: {
  personaId?: string; description: string; onSelect: (file: File) => void; onOpen: (url: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [prompt, setPrompt] = useState(description);
  const [count, setCount] = useState("1");
  const [choices, setChoices] = useState<{ url: string; file: File }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => { setPrompt(description); }, [description]);
  useEffect(() => () => choices.forEach((c) => URL.revokeObjectURL(c.url)), [choices]);
  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true); onBusy(true); setChoices([]); setSelected(null); setProgress(0);
    const made: { url: string; file: File }[] = [];
    try {
      for (let i = 0; i < Number(count); i++) {
        setProgress(i + 1);
        const { data } = await personaStudio("portrait", { personaId, prompt, optionCount: Number(count) });
        if (data.error) throw new Error(data.error);
        if (!data.imageUrl) throw new Error("No portrait was returned.");
        const response = await fetch(data.imageUrl);
        if (!response.ok) throw new Error("Could not load the portrait.");
        const blob = await response.blob();
        const file = new File([blob], `portrait-${i + 1}.png`, { type: blob.type || "image/png" });
        made.push({ url: URL.createObjectURL(blob), file });
      }
      setChoices(made);
    } catch (e) {
      setChoices(made);
      toast.error(e instanceof Error ? e.message : "Could not generate portraits.");
    } finally { setBusy(false); onBusy(false); }
  };
  return <div className="space-y-3 border-t border-border pt-3">
    <Label htmlFor="portrait-description">Portrait description</Label>
    <Textarea id="portrait-description" rows={3} value={prompt} disabled={busy} onChange={(e) => setPrompt(e.target.value)} placeholder="Age, appearance, hair, clothing and picture style…" />
    <div className="flex flex-wrap items-center gap-2">
      <Select value={count} disabled={busy} onValueChange={setCount}><SelectTrigger className="w-32" aria-label="Portrait options"><SelectValue /></SelectTrigger><SelectContent>
        {Array.from({ length: MAX_PORTRAIT_OPTIONS }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1} {i ? "pictures" : "picture"}</SelectItem>)}
      </SelectContent></Select>
      <Button variant="outline" disabled={busy || !prompt.trim()} onClick={generate}><Sparkles className="w-4 h-4" />{busy ? `Creating ${progress} of ${count}…` : "Generate with AI"}</Button>
      <Label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-2 text-sm"><Upload className="w-4 h-4" />Upload picture
        <input type="file" accept="image/*" disabled={busy} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) return toast.error("Pictures must be under 5 MB."); if (!file.type.startsWith("image/")) return toast.error("Choose an image file."); setSelected(null); onSelect(file); }} />
      </Label>
    </div>
    <p className="text-xs text-muted-foreground">AI pictures use paid image credits. Choose your favourite, then save changes.</p>
    {choices.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {choices.map((c, i) => <div key={c.url} className="relative">
        <Button variant="outline" className={`h-auto w-full rounded-md p-1 ${selected === i ? "border-primary ring-2 ring-ring" : ""}`} aria-label={`Select portrait ${i + 1}`} aria-pressed={selected === i} onClick={() => { setSelected(i); onSelect(c.file); }}>
          <img src={c.url} alt={`Portrait option ${i + 1}`} className="aspect-square w-full rounded-sm object-cover" />
          {selected === i && <Check className="absolute left-2 top-2 h-5 w-5 rounded-full bg-primary text-primary-foreground" />}
        </Button>
        <Button size="icon" variant="secondary" className="absolute right-2 top-2 h-7 w-7" aria-label={`View portrait ${i + 1} full size`} onClick={() => onOpen(c.url)}><ZoomIn className="h-4 w-4" /></Button>
      </div>)}
    </div>}
  </div>;
}