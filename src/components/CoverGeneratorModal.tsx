import { useState } from "react";
import { sanitizeText } from "@/lib/sanitize";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Wand2, Check, RefreshCw, Send, ArrowLeft, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Book } from "@/types/book";
import { cn } from "@/lib/utils";

interface CoverGeneratorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book: Book;
  onCoverSelected: (coverUrl: string) => void;
}

const FONTS = [
  { label: "Classic Serif", css: "'Playfair Display', Georgia, serif", prompt: "classic elegant high-contrast serif" },
  { label: "Bold Sans", css: "Impact, 'Arial Black', sans-serif", prompt: "bold heavy condensed sans-serif" },
  { label: "Modern Minimal", css: "'Helvetica Neue', Arial, sans-serif", prompt: "clean thin modern minimal sans-serif" },
  { label: "Handwritten", css: "'Brush Script MT', 'Segoe Script', cursive", prompt: "flowing handwritten brush script" },
  { label: "Gothic", css: "'Old English Text MT', 'UnifrakturMaguntia', serif", prompt: "ornate gothic blackletter" },
  { label: "Typewriter", css: "'Courier New', monospace", prompt: "vintage typewriter monospace" },
];
const COLORS = [
  { label: "White", hex: "#ffffff" }, { label: "Gold", hex: "#d4a93a" }, { label: "Black", hex: "#111111" },
  { label: "Crimson", hex: "#b3122e" }, { label: "Silver", hex: "#c0c4cc" }, { label: "Teal", hex: "#1f9e9a" },
];
const POSITIONS = ["top", "center", "bottom"];
const IMAGE_TYPES = ["Digital painting", "Photorealistic", "Watercolor", "Oil painting", "Vector illustration", "Anime", "Vintage poster", "Abstract"];
const THEMES = ["Dramatic", "Mysterious", "Romantic", "Epic", "Whimsical", "Dark", "Hopeful", "Professional"];
const TOGGLES = [
  { key: "minimalist", label: "Minimalist" }, { key: "darkMood", label: "Dark mood" },
  { key: "showCharacter", label: "Show a character" }, { key: "textured", label: "Paper texture" },
  { key: "border", label: "Decorative border" },
] as const;

type Step = "setup" | "select" | "edit";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors",
        active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/50")}>
      {children}
    </button>
  );
}

export function CoverGeneratorModal({ open, onOpenChange, book, onCoverSelected }: CoverGeneratorModalProps) {
  const [step, setStep] = useState<Step>("setup");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [font, setFont] = useState(0);
  const [color, setColor] = useState(0);
  const [position, setPosition] = useState("top");
  const [imageType, setImageType] = useState(IMAGE_TYPES[0]);
  const [theme, setTheme] = useState(THEMES[0]);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [covers, setCovers] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<{ text: string; image: string }[]>([]);

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("generate-cover", { body });
    if (error) {
      let msg = error.message;
      try { const ctx = await (error as any).context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* ignore */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const generate = async () => {
    setBusy(true);
    try {
      const data = await invoke({
        mode: "generate",
        options: {
          title: book.title, subtitle: sanitizeText(subtitle), author: sanitizeText(author),
          description: sanitizeText(description.trim()), bookType: book.bookType,
          font: FONTS[font].prompt, textColor: `${COLORS[color].label} (${COLORS[color].hex})`,
          textPosition: position, imageType, theme, count, ...toggles,
        },
      });
      setCovers(data.covers || []);
      setSelected(data.covers?.length === 1 ? 0 : null);
      setStep("select");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate covers");
    } finally { setBusy(false); }
  };

  const edit = async () => {
    if (selected === null || instruction.trim().length < 3) return;
    setBusy(true);
    const text = sanitizeText(instruction.trim());
    try {
      const data = await invoke({ mode: "edit", image: covers[selected], instruction: text });
      setHistory((h) => [...h, { text, image: covers[selected] }]);
      setCovers((c) => c.map((u, i) => (i === selected ? data.cover : u)));
      setInstruction("");
    } catch (e: any) {
      toast.error(e.message || "Edit failed");
    } finally { setBusy(false); }
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last || selected === null) return;
    setCovers((c) => c.map((u, i) => (i === selected ? last.image : u)));
    setHistory((h) => h.slice(0, -1));
  };

  const useCover = () => {
    if (selected === null) return;
    onCoverSelected(covers[selected]);
    handleClose(false);
    toast.success("Book cover set!");
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) { setStep("setup"); setCovers([]); setSelected(null); setHistory([]); setInstruction(""); }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">Book Cover Studio</DialogTitle>
          <DialogDescription>
            {step === "setup" && `Choose a style for "${book.title}". The AI designs the full cover, title included.`}
            {step === "select" && "Pick your favourite, regenerate, or refine it with a chat edit."}
            {step === "edit" && "Describe a change. Only that part is altered; the rest of the cover stays the same."}
          </DialogDescription>
        </DialogHeader>

        {step === "setup" && (
          <div className="space-y-6 pt-2">
            <div className="grid md:grid-cols-2 gap-3">
              <Input placeholder="Author name (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120} />
              <Input placeholder="Subtitle (optional)" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={200} />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Title font</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {FONTS.map((f, i) => (
                  <button key={f.label} type="button" onClick={() => setFont(i)}
                    className={cn("rounded-md border p-3 text-left transition-colors",
                      font === i ? "border-primary bg-primary/10" : "border-border hover:border-primary/50")}>
                    <span className="block text-lg truncate" style={{ fontFamily: f.css }}>{book.title || "Your Title"}</span>
                    <span className="text-[11px] text-muted-foreground">{f.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-sm font-medium">Title color</p>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c, i) => (
                    <button key={c.label} type="button" onClick={() => setColor(i)} title={c.label}
                      className={cn("w-9 h-9 rounded-full border-2 transition-transform",
                        color === i ? "border-primary scale-110" : "border-border")}
                      style={{ background: c.hex }} />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Title location</p>
                <div className="flex gap-2">
                  {POSITIONS.map((p) => <Chip key={p} active={position === p} onClick={() => setPosition(p)}>{p[0].toUpperCase() + p.slice(1)}</Chip>)}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Image type</p>
              <div className="flex flex-wrap gap-2">
                {IMAGE_TYPES.map((t) => <Chip key={t} active={imageType === t} onClick={() => setImageType(t)}>{t}</Chip>)}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Theme</p>
              <div className="flex flex-wrap gap-2">
                {THEMES.map((t) => <Chip key={t} active={theme === t} onClick={() => setTheme(t)}>{t}</Chip>)}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {TOGGLES.map((t) => (
                <label key={t.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm cursor-pointer">
                  {t.label}
                  <Switch checked={!!toggles[t.key]} onCheckedChange={(v) => setToggles((s) => ({ ...s, [t.key]: v }))} />
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Image description (optional)</p>
              <Textarea placeholder="e.g. A lone lighthouse on a stormy cliff at dusk" value={description}
                onChange={(e) => setDescription(e.target.value)} className="min-h-[70px]" maxLength={1000} />
            </div>

            <div className="flex items-center gap-3">
              <p className="text-sm font-medium">Covers</p>
              {[1, 2, 3, 4].map((n) => <Chip key={n} active={count === n} onClick={() => setCount(n)}>{n}</Chip>)}
            </div>

            <Button onClick={generate} disabled={busy} className="w-full" variant="hero">
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Designing {count} cover{count > 1 ? "s" : ""}…</>
                : <><ImageIcon className="w-4 h-4 mr-2" />Generate Covers</>}
            </Button>
          </div>
        )}

        {step === "select" && (
          <div className="space-y-4 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setStep("setup")} className="text-xs">
              <ArrowLeft className="w-3 h-3 mr-1" /> Change style
            </Button>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {covers.map((url, i) => (
                <button key={i} onClick={() => setSelected(i)}
                  className={cn("relative aspect-[2/3] rounded-md overflow-hidden border-2 transition-all",
                    selected === i ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50")}>
                  <img src={url} alt={`Cover option ${i + 1}`} className="w-full h-full object-cover" />
                  {selected === i && (
                    <div className="absolute top-2 right-2 bg-primary rounded-full p-1">
                      <Check className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={generate} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Regenerate
              </Button>
              <Button variant="outline" onClick={() => { setHistory([]); setStep("edit"); }} disabled={selected === null || busy} className="flex-1">
                <Wand2 className="w-4 h-4 mr-2" />Edit with chat
              </Button>
              <Button onClick={useCover} disabled={selected === null || busy} className="flex-1">
                <Check className="w-4 h-4 mr-2" />Use this cover
              </Button>
            </div>
          </div>
        )}

        {step === "edit" && selected !== null && (
          <div className="grid md:grid-cols-[260px_1fr] gap-6 pt-2">
            <div className="relative aspect-[2/3] rounded-md overflow-hidden border border-border">
              <img src={covers[selected]} alt="Cover being edited" className="w-full h-full object-cover" />
              {busy && <div className="absolute inset-0 bg-background/60 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex-1 min-h-[160px] rounded-md border border-border p-3 space-y-2 overflow-y-auto">
                {history.length === 0 && <p className="text-xs text-muted-foreground">Try: "change the sky to sunset orange", "make the title bigger", "remove the bird on the left".</p>}
                {history.map((h, i) => (
                  <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm w-fit">{h.text}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input placeholder="Describe what to change…" value={instruction} disabled={busy}
                  onChange={(e) => setInstruction(e.target.value)} maxLength={1000}
                  onKeyDown={(e) => { if (e.key === "Enter") edit(); }} />
                <Button onClick={edit} disabled={busy || instruction.trim().length < 3} size="icon" aria-label="Send edit">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("select")} disabled={busy}><ArrowLeft className="w-3 h-3 mr-1" />Back</Button>
                <Button variant="outline" size="sm" onClick={undo} disabled={busy || history.length === 0}>Undo last edit</Button>
                <Button size="sm" className="ml-auto" onClick={useCover} disabled={busy}><Check className="w-4 h-4 mr-1" />Use this cover</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
