import { describe,it,expect } from 'vitest';
import { defaultSettings,buildSpec } from '../../supabase/functions/_shared/pageDesign/compose';
import { LAYOUT_CATALOG } from '../../supabase/functions/_shared/pageDesign/catalog';
import { paginate } from '../../supabase/functions/_shared/pageDesign/paginate';
import { applyEdit } from '@/lib/pageDesign/edits';
const measure=(text:string,f:{pt:number})=>text.length*f.pt*.5/72;
describe('page design pagination',()=>{
 for(const layout of LAYOUT_CATALOG) it(`preserves text and spread parity: ${layout.id}`,()=>{
 const text=Array.from({length:400},(_,i)=>`word${i}`).join(' ');
 const input={bookType:'children' as const,pageKey:'a',pageIndex:0,text,images:[],settings:defaultSettings('children','b'),recentLayouts:[]};
 const spec=buildSpec(input,{layout:layout.id,shapes:layout.slots.map(()=>layout.defaultShape),treatments:layout.slots.map(()=> 'borderless' as const),dropCap:false,decorations:[]},{source:'manual',mode:'manual',createdAt:''});
 const result=paginate([input],new Map([['a',spec]]),measure);
 expect(result.issues.filter(i=>i.level==='error')).toEqual([]);
 const placed=result.pages.flatMap(p=>p.flow?.lines.filter(l=>l.kind==='body').flatMap(l=>l.words)??[]).join(' ');
 expect(placed).toBe(text);
 for(const p of result.pages.filter(p=>p.kind==='spread')){expect(p.numbers[0]%2).toBe(0);expect(p.numbers[1]).toBe(p.numbers[0]+1)}
 const moved=applyEdit(spec,{type:'moveImage',slot:0,dx:1,dy:0}).spec;
 expect(moved).not.toBe(spec);expect(moved.provenance.source).toBe('manual');expect(spec.provenance.source).toBe('manual');
 });
});
