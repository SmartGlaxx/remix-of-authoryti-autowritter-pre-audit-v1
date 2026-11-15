import { FONT_TOKENS } from '@/lib/pageDesign/layoutCatalog';
import { applyEdit, hexToHsl, hslToHex, type PageEdit } from '@/lib/pageDesign/edits';
import { LAYOUT_STRUCTURES, IMAGE_SHAPES, IMAGE_TREATMENTS, TEXT_FLOW_MODES, DECORATION_KINDS, type PageCompositionSpec } from '@/types/pageDesign';
export function PageEditorToolbar({ spec, slot, edit }: { spec: PageCompositionSpec; slot: number; edit: (e: PageEdit) => void }) {
 const image = spec.images.find(i => i.slot === slot);
 const select = (label: string, value: string, options: readonly string[], change: (v: string) => void) => <label className="block text-sm space-y-1">{label}<select className="w-full border rounded-md p-2 bg-background" value={value} onChange={e => change(e.target.value)}>{options.map(v => <option key={v} value={v}>{v.replace(/-/g, ' ')}</option>)}</select></label>;
 return <div className="space-y-4">
 {select('Layout',spec.layout,LAYOUT_STRUCTURES,v=>edit({type:'layout',layout:v as typeof spec.layout}))}
 {image && <>{select('Image shape',image.shape,IMAGE_SHAPES,v=>edit({type:'shape',slot,shape:v as typeof image.shape}))}{select('Image edges',image.treatment,IMAGE_TREATMENTS,v=>edit({type:'treatment',slot,treatment:v as typeof image.treatment}))}<p className="text-xs text-muted-foreground">Drag the picture to move it. Drag its bottom corner to resize.</p></>}
 {select('Body font',spec.typography.bodyFont,Object.keys(FONT_TOKENS),v=>edit({type:'font',which:'body',font:v}))}
 {select('Heading font',spec.typography.headingFont,Object.keys(FONT_TOKENS),v=>edit({type:'font',which:'heading',font:v}))}
 <label className="block text-sm">Body size (pt)<input className="w-full border rounded p-2 bg-background" type="number" step="0.5" value={spec.typography.bodyPt} onChange={e=>edit({type:'fontSize',bodyPt:Number(e.target.value),bookBasePt:spec.bookType==='children'?20:11})}/></label>
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={spec.typography.dropCap} onChange={e=>edit({type:'dropCap',on:e.target.checked})}/>Drop cap</label>
 {spec.textRegions.map((r,region)=><fieldset key={region} className="space-y-2 border rounded p-2"><legend className="text-xs">Text area {region+1}</legend>{select('Alignment',r.align,['left','center','justify'],v=>edit({type:'textAlign',region,align:v as typeof r.align}))}{select('Columns',String(r.columns),['1','2','3'],v=>edit({type:'columns',region,columns:Number(v) as 1|2|3}))}{r.overImage && <label className="flex gap-2"><input type="checkbox" checked={r.panel} onChange={e=>edit({type:"panel",region,panel:e.target.checked})}/>Solid text panel</label>}</fieldset>)}
 <div className="grid grid-cols-2 gap-2">{(['paper','ink','accent','panel'] as const).map(key=><label key={key} className="text-sm capitalize">{key}<input aria-label={key+' color'} type="color" className="block w-full h-8" value={hslToHex(spec.colors[key])} onChange={e=>edit({type:'color',key,hsl:hexToHsl(e.target.value)})}/></label>)}</div>
 {select('Decoration',spec.decorations[0]?.kind??'none',['none',...DECORATION_KINDS],v=>edit({type:'decorations',kinds:v==='none'?[]:[{kind:v as typeof DECORATION_KINDS[number],position:'corners'}]}))}
 </div>;
}
