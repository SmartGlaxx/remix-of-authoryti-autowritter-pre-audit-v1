import { supabase } from "@/integrations/supabase/client";
import { printDesignedPages } from "@/lib/pageDesign/print";
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBooks } from '@/hooks/useBooks';
import { Button } from '@/components/ui/button';
import { PageRenderer } from '@/components/pageDesign/PageRenderer';
import { PageEditorToolbar } from '@/components/pageDesign/PageEditorToolbar';
import { asDesignBookType } from '@/lib/pageDesign/layoutCatalog';
import { defaultSettings, textHash } from '../../supabase/functions/_shared/pageDesign/compose';
import { paginate } from '../../supabase/functions/_shared/pageDesign/paginate';
import { staticChecks } from '../../supabase/functions/_shared/pageDesign/checks';
import { createCanvasMeasurer } from '@/lib/pageDesign/measure';
import { unitsFromBook, bookIllustrations } from '@/lib/pageDesign/units';
import { composePage } from '@/lib/pageDesign/service';
import { loadDesigns, savePageSpec, saveSettings } from '@/lib/pageDesign/repo';
import { applyEdit, type PageEdit } from '@/lib/pageDesign/edits';
import { STYLE_FAMILIES, COMPOSITION_MODES, type BookDesignSettings, type PageCompositionSpec } from '@/types/pageDesign';
import { toast } from 'sonner';
export default function PageDesign() {
 const {bookId}=useParams(); const {books,isLoading}=useBooks(); const book=books.find(b=>b.id===bookId);
 const kind=book?asDesignBookType(book.bookType):null;
 const [settings,setSettings]=useState<BookDesignSettings|null>(null),[specs,setSpecs]=useState(new Map<string,PageCompositionSpec>()),[original,setOriginal]=useState(new Map<string,PageCompositionSpec>());
 const [active,setActive]=useState(''),[slot,setSlot]=useState(0),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 const [history,setHistory]=useState<Map<string,PageCompositionSpec>[]>([]);
 const [fontVersion,setFontVersion]=useState(0);
 useEffect(()=>{const link=document.createElement("link");link.rel="stylesheet";link.href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;700&family=DM+Sans:wght@400;700&family=Fraunces:wght@400;700&family=Fredoka:wght@400;700&family=Libre+Baskerville:wght@400;700&family=Lora:wght@400;700&family=Nunito:wght@400;700&family=Playfair+Display:wght@400;700&family=Source+Serif+4:wght@400;700&family=Space+Grotesk:wght@400;700&display=swap";link.onload=()=>{document.fonts.ready.then(()=>setFontVersion(v=>v+1))};document.head.appendChild(link);return()=>{link.remove()}},[]);
 const units=useMemo(()=>book?unitsFromBook(book):[],[book]); const measure=useMemo(()=>createCanvasMeasurer(),[fontVersion]);
 useEffect(()=>{let live=true; if(!bookId||!kind)return; setReady(false); loadDesigns(bookId).then(d=>{if(!live)return;setSettings(d.settings??defaultSettings(kind,bookId));setSpecs(new Map([...d.pages].map(([k,v])=>[k,v.spec])));setOriginal(new Map([...d.pages].map(([k,v])=>[k,v.generated??v.spec])));setActive(units[0]?.pageKey??'');if(d.rejected.length)setError('Some saved designs could not be loaded. Regenerate the affected sections.');setReady(true);}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[bookId,kind]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty)e.preventDefault()};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
 const result=useMemo(()=>paginate(units,specs,measure),[units,specs,measure]);
 const spec=specs.get(active),unit=units.find(u=>u.pageKey===active);
 const issues=[...result.issues,...units.flatMap(u=>specs.has(u.pageKey)?staticChecks(specs.get(u.pageKey)!,textHash(u.text)):[])];
 const input=(u:typeof units[number],i:number)=>({bookType:kind!,pageKey:u.pageKey,pageIndex:i,text:u.text,heading:u.heading,images:u.images,settings:settings!,recentLayouts:[...specs.values()].slice(0,i).slice(-4).map(s=>s.layout)});
 const replace=(next:Map<string,PageCompositionSpec>)=>{setHistory(h=>[...h.slice(-29),specs]);setSpecs(next);setDirty(true)};
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}catch(e){toast.error(e instanceof Error?e.message:'Operation failed')}finally{setBusy(false)}};
 const generate=(all:boolean)=>run(async()=>{const next=new Map(specs),generated=new Map(original);for(const [i,u] of units.entries()){if(!all&&u.pageKey!==active)continue;const s=await composePage(input(u,i),settings!.mode,bookId!);next.set(u.pageKey,s);generated.set(u.pageKey,s)}replace(next);setOriginal(generated)});
 const edit=(e:PageEdit)=>{if(!spec||!unit)return;const r=applyEdit(spec,e,input(unit,units.indexOf(unit)));if(r.note)toast.info(r.note);replace(new Map(specs).set(active,r.spec))};
 if(isLoading)return <p className="p-8">Loading book…</p>;
 if(!book||!kind)return <p className="p-8">This book does not support page design. <Link to="/dashboard">Back to library</Link></p>;
 return <div className="min-h-screen bg-background text-foreground">
 <header className="border-b p-4 flex flex-wrap items-center gap-3"><Link to={'/dashboard/'+bookId}>← Book</Link><div className="flex-1"><h1 className="font-serif text-xl">Page Design</h1><p className="text-xs text-muted-foreground">{book.title} · {result.pages.length} pages · {dirty?'Unsaved changes':'Saved'}</p></div><Button variant="outline" disabled={busy||!result.pages.length||issues.some(i=>i.level==='error')} onClick={()=>run(()=>printDesignedPages(result.pages,book.title))}>Print / Save PDF</Button><Button disabled={busy||!dirty} onClick={()=>run(async()=>{for(const s of specs.values())await savePageSpec(bookId!,s,original.get(s.pageKey));await saveSettings(bookId!,settings!);setDirty(false);toast.success('Designs saved')})}>Save designs</Button></header>
 {error&&<p role="alert" className="p-4 text-destructive">{error}</p>}
 {!units.length?<p className="p-8">Write a book section first, then return here to design its pages.</p>:ready&&settings&&<>
 <div className="p-4 border-b flex flex-wrap gap-3 items-center"><label>Style <select aria-label="Style family" className="border rounded p-2 bg-background" value={settings.styleFamily} onChange={e=>{setSettings({...settings,styleFamily:e.target.value as typeof settings.styleFamily});setDirty(true)}}>{STYLE_FAMILIES.map(s=><option key={s}>{s}</option>)}</select></label><label>Mode <select aria-label="Composition mode" className="border rounded p-2 bg-background" value={settings.mode} onChange={e=>{setSettings({...settings,mode:e.target.value as typeof settings.mode});setDirty(true)}}>{COMPOSITION_MODES.map(s=><option key={s}>{s}</option>)}</select></label><Button disabled={busy} onClick={()=>generate(true)}>Compose all sections</Button><span className="text-xs text-muted-foreground">{settings.mode==='dynamic-ai'?'Uses your configured AI service and may incur charges.':'Local layout composition · no AI request'}</span></div>
 <div className="grid lg:grid-cols-[220px_minmax(0,1fr)_270px]">
 <aside className="border-r p-3 space-y-2">{units.map((u,i)=><button key={u.pageKey} onClick={()=>{setActive(u.pageKey);setSlot(0)}} className={'block w-full text-left rounded-lg p-3 text-sm '+(active===u.pageKey?'bg-primary/10 text-primary':'hover:bg-muted')}>{i+1}. {u.heading||u.chapterTitle}<span className="block text-xs opacity-60">{specs.has(u.pageKey)?'Designed':'Awaiting design'}</span></button>)}</aside>
 <main className="bg-muted/40 p-4 min-w-0"><div className="flex gap-2 flex-wrap mb-4"><Button disabled={busy} onClick={()=>generate(false)}>Recompose section</Button><Button variant="outline" disabled={!history.length||busy} onClick={()=>{setSpecs(history[history.length-1]);setHistory(h=>h.slice(0,-1));setDirty(true)}}>Undo</Button><Button variant="outline" disabled={!original.has(active)||busy} onClick={()=>replace(new Map(specs).set(active,original.get(active)!))}>Revert section</Button></div>{spec&&<p className="text-xs mb-3">Composition: {spec.provenance.source}{spec.provenance.fallbackReason?' · '+spec.provenance.fallbackReason:''}</p>}<div className="overflow-auto space-y-6">{result.pages.filter(p=>p.pageKey===active).map(p=><div key={p.numbers.join('-')}><p className="text-xs mb-2">Page {p.numbers.join('–')} · {p.kind}</p><PageRenderer page={p} scale={Math.min(65,640/p.canvas.w)} editable={p.kind==='designed'||p.kind==='spread'} selectedSlot={slot} onSelectImage={s=>setSlot(s??0)} onImageBox={(slot,box)=>edit({type:'setImageBox',slot,box})} showGuides /></div>)}</div>{!spec&&<p className="p-12 text-center text-muted-foreground">Compose this section to begin designing.</p>}<div className="mt-6 space-y-2">{issues.filter(i=>!i.pageKey||i.pageKey===active).map((i,n)=><p key={n} className="text-xs border rounded p-2">{i.level}: {i.message}</p>)}</div></main>
 <aside className="p-4 border-l">{spec&&<><PageEditorToolbar spec={spec} slot={slot} edit={edit}/><label className="block text-sm mt-4">Replace selected picture<select aria-label="Replace picture" className="w-full border rounded p-2 bg-background" value="" onChange={e=>edit({type:'replaceImage',slot,url:e.target.value})}><option value="">Choose from this book</option>{bookIllustrations(book).map(im=><option value={im.url} key={im.url}>{im.alt}</option>)}</select></label><Button className="mt-3 w-full" variant="outline" disabled={busy||!spec.images.length} onClick={()=>run(async()=>{const {data,error}=await supabase.functions.invoke("generate-image",{body:{content:unit!.text,bookType:book.bookType,theme:book.theme,imageOpportunity:spec.images.find(im=>im.slot===slot)?.alt}});if(error||data?.error||!data?.imageUrl)throw new Error(error?.message||data?.error||"Image generation returned no picture");edit({type:"replaceImage",slot,url:data.imageUrl})})}>Regenerate picture</Button><p className="text-xs text-muted-foreground mt-2">Picture generation uses the configured image provider and may incur charges. PDF uses your browser’s Save as PDF option. Designed EPUB export is not available.</p></>}</aside>
 </div></>}
 </div>;
}
