import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Feather, Library } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WRITER_PERSONAS, type WriterPersona } from "../../supabase/functions/_shared/writers/personas";
import { resolveAuthor } from "../../supabase/functions/_shared/writers/authorDna";
import { WRITER_PORTRAITS } from "@/components/WriterPortraits";
import { BOOK_TYPE_INFO, BOOK_TYPE_GENRES, type BookType } from "@/types/book";
import { writersForType, typesForWriter, sampleTemplate } from "@/lib/startPaths";

type Pick = { bookType: BookType; genre?: string; writerId: string };
interface Props { open: boolean; busy?: boolean; onClose: () => void; onStart: (p: Pick) => void }
type View = "choose" | "type" | "writers" | "browse" | "writerTypes";

const label = (t: string) => BOOK_TYPE_INFO[t as BookType]?.label ?? t;

function WriterCard({ w, onPick }: { w: WriterPersona; onPick: () => void }) {
  const author = resolveAuthor(w.id);
  return (
    <div className="grid gap-4 sm:grid-cols-[160px_1fr] rounded-2xl border border-border bg-card p-4">
      <img src={WRITER_PORTRAITS[w.id]} alt={w.name} className="h-40 w-40 rounded-xl object-cover" />
      <div className="space-y-2 min-w-0">
        <div>
          <h3 className="font-serif text-xl font-bold text-foreground">{w.name}</h3>
          <p className="text-sm text-muted-foreground">{w.tagline}{author ? ` · writes like ${author.name}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-1">{w.bookTypes.map((t) => <Badge key={t} variant="secondary">{label(t)}</Badge>)}</div>
        <p className="text-sm italic text-muted-foreground border-l-2 border-primary pl-3">{sampleTemplate(w)}</p>
        <Button onClick={onPick} className="rounded-full">Choose {w.name.split(" ")[0]}</Button>
      </div>
    </div>
  );
}

export function StartBookDialog({ open, busy, onClose, onStart }: Props) {
  const [view, setView] = useState<View>("choose");
  const [bookType, setBookType] = useState<BookType | null>(null);
  const [genre, setGenre] = useState<string | undefined>();
  const [writerId, setWriterId] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const matches = useMemo(() => (bookType ? writersForType(bookType, genre) : []), [bookType, genre]);
  const reset = () => { setView("choose"); setBookType(null); setGenre(undefined); setWriterId(null); setIdx(0); };
  const close = () => { reset(); onClose(); };
  const types = Object.keys(BOOK_TYPE_INFO) as BookType[];
  const current = WRITER_PERSONAS[idx];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Start a new book</DialogTitle>
          <DialogDescription>Pick a book type or a writer. The writer's voice shapes the summary and every step after.</DialogDescription>
        </DialogHeader>
        {view !== "choose" && <Button variant="ghost" size="sm" className="w-fit" onClick={() => setView(view === "writers" ? "type" : view === "writerTypes" ? "browse" : "choose")}><ChevronLeft className="h-4 w-4" />Back</Button>}

        {view === "choose" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <button onClick={() => setView("type")} className="rounded-2xl border border-border p-6 text-left hover:border-primary transition-colors">
              <Library className="h-6 w-6 text-primary mb-2" /><h3 className="font-semibold text-foreground">I know the kind of book</h3>
              <p className="text-sm text-muted-foreground">Pick a book type, then a matching writer.</p>
            </button>
            <button onClick={() => setView("browse")} className="rounded-2xl border border-border p-6 text-left hover:border-primary transition-colors">
              <Feather className="h-6 w-6 text-primary mb-2" /><h3 className="font-semibold text-foreground">Browse writers</h3>
              <p className="text-sm text-muted-foreground">Read their cards, pick a voice, then a book type.</p>
            </button>
          </div>
        )}

        {view === "type" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">{types.map((t) => <Button key={t} size="sm" variant={bookType === t ? "default" : "outline"} className="rounded-full" onClick={() => { setBookType(t); setGenre(undefined); }}>{label(t)}</Button>)}</div>
            {bookType && <div className="flex flex-wrap gap-2">{(BOOK_TYPE_GENRES[bookType] ?? []).map((g) => <Button key={g} size="sm" variant={genre === g ? "secondary" : "ghost"} className="rounded-full" onClick={() => setGenre(genre === g ? undefined : g)}>{g}</Button>)}</div>}
            <Button disabled={!bookType} className="rounded-full" onClick={() => setView("writers")}>See matching writers<ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}

        {view === "writers" && bookType && (
          <div className="space-y-3">
            {matches.length === 0 && <p className="text-sm text-muted-foreground">No writer lists this type yet.</p>}
            {matches.map((w) => <WriterCard key={w.id} w={w} onPick={() => !busy && onStart({ bookType, genre, writerId: w.id })} />)}
          </div>
        )}

        {view === "browse" && current && (
          <div className="space-y-3">
            <WriterCard w={current} onPick={() => { setWriterId(current.id); setView("writerTypes"); }} />
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setIdx((idx - 1 + WRITER_PERSONAS.length) % WRITER_PERSONAS.length)}><ChevronLeft className="h-4 w-4" />Previous</Button>
              <span className="text-sm text-muted-foreground">{idx + 1} / {WRITER_PERSONAS.length}</span>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setIdx((idx + 1) % WRITER_PERSONAS.length)}>Next<ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {view === "writerTypes" && writerId && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Book types {WRITER_PERSONAS.find((w) => w.id === writerId)?.name} does best:</p>
            <div className="flex flex-wrap gap-2">{typesForWriter(writerId).map((t) => <Button key={t} disabled={busy} className="rounded-full" onClick={() => onStart({ bookType: t as BookType, writerId })}>{label(t)}</Button>)}</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
