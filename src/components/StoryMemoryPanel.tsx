import { useEffect, useState } from 'react';
import { BookOpen, Users, MessageSquare, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { contentHash } from '../../supabase/functions/_shared/narrative/extraction';
import { acceptedMemoryEntries, type MemoryRow } from '../../supabase/functions/_shared/narrative/sectionMemory';
import type { Book } from '@/types/book';
import { CharacterGallery } from './CharacterGallery';
export function StoryMemoryPanel({book,onNavigate}: {book:Book;onNavigate:(chapter:number)=>void}) {
  const [open,setOpen] = useState(false);
  const [rows,setRows] = useState<MemoryRow[]>([]);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [person,setPerson] = useState('');
  const load = async()=>{
    setLoading(true);setError('');
    const {data,error} = await supabase.from('narrative_extractions').select('chapter_index,subsection_index,content_hash,status,applied').eq('book_id',book.id).eq('status','completed').order('chapter_index').order('subsection_index');
    if(error) setError('Story memory could not be loaded.');
    else setRows((data ?? []) as unknown as MemoryRow[]);
    setLoading(false);
  };
  useEffect(()=>{if(open) void load();},[open,book.id]);
  const chapters = book.outline?.chapters ?? [];
  const entries = acceptedMemoryEntries(rows,chapters,{chapterIndex:chapters.length,subsectionIndex:0},contentHash);
  const people = [...new Set(entries.flatMap(r=>Object.keys(r.applied.sectionMemory?.dialogueCards.people ?? {})))].sort();
  return <>
    <Button variant="outline" size="sm" onClick={()=>setOpen(true)} className="gap-2"><BookOpen className="h-4 w-4"/>Story memory</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Character Index & story memory</DialogTitle></DialogHeader>
      <CharacterGallery characters={book.outline?.characters ?? []}/>
      <div className="flex flex-wrap items-center gap-2 border-y py-3">
        <Users className="h-4 w-4 text-primary"/>
        <Button size="sm" variant={person?'ghost':'secondary'} onClick={()=>setPerson('')}>Everyone</Button>
        {people.map(name=><Button key={name} variant={person===name?'secondary':'ghost'} size="sm" onClick={()=>setPerson(name)}>{name}</Button>)}
        <Button size="icon" variant="ghost" title="Refresh memory" aria-label="Refresh memory" disabled={loading} onClick={()=>void load()}><RefreshCw className="h-4 w-4"/></Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {loading && <p className="text-muted-foreground">Loading…</p>}
      {!loading && !error && !entries.length && <p className="text-muted-foreground">No accepted paragraph memory yet.</p>}
      {entries.map(row=>{
        const memory=row.applied.sectionMemory;
        if(!memory) return null;
        const incidents=Object.values(memory.dialogueCards.incidents).filter(i=>!person || memory.dialogueCards.people[person]?.incidentIds.includes(i.id));
        const view=person?memory.summary.characterViews[person]:memory.summary.writerView;
        return <section key={`${row.chapter_index}:${row.subsection_index}`} className="space-y-3 border-b py-3">
          <Button variant="link" className="p-0 h-auto" onClick={()=>{setOpen(false);onNavigate(row.chapter_index);}}>Chapter {row.chapter_index+1} · Section {row.subsection_index+1}</Button>
          <p className="text-xs text-muted-foreground">{[memory.sectionTime.date,memory.sectionTime.time].filter(Boolean).join(' · ') || 'Story time not established'}</p>
          <ol className="list-decimal pl-5 space-y-1 text-sm">{view?.map((s,i)=><li key={i}>{s}</li>)}</ol>
          {incidents.map(i=><details key={i.id} className="border-l-2 border-primary pl-3">
            <summary className="cursor-pointer text-sm font-medium"><MessageSquare className="inline h-3 w-3 mr-2"/>{i.label} · {[i.location,i.time].filter(Boolean).join(' · ')}</summary>
            <p className="text-xs text-muted-foreground my-2">Present: {i.present.join(', ')} · Participants: {i.participants.join(', ')}</p>
            {i.turns.map(t=><p key={t.n} className="text-sm my-2"><strong>{t.speaker}:</strong> {t.text}{t.delivery && <em className="text-muted-foreground"> ({t.delivery})</em>}</p>)}
          </details>)}
        </section>;
      })}
    </DialogContent></Dialog>
  </>;
}