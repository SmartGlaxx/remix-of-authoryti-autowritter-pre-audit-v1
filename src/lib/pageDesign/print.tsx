import { createRoot } from 'react-dom/client';
import { PageRenderer } from '@/components/pageDesign/PageRenderer';
import type { PhysicalPage } from '../../../supabase/functions/_shared/pageDesign/paginate';

/** Browser PDF printing uses the same renderer and physical coordinates as the preview. */
export async function printDesignedPages(pages: PhysicalPage[], title: string) {
 const first=pages.find(p=>p.spec)?.spec;
 if(!first)throw new Error('Compose the book before exporting.');
 const win=window.open('','_blank');
 if(!win)throw new Error('Allow the print window to open, then try again.');
 win.document.title=title;
 const p=first.print, b=p.bleedIn, w=p.trimWidthIn+2*b,h=p.trimHeightIn+2*b;
 const css=win.document.createElement('style');
 css.textContent=`@page{size:${w}in ${h}in;margin:0}body{margin:0} .sheet{position:relative;width:${w}in;height:${h}in;overflow:hidden;break-after:page}.sheet:last-child{break-after:auto} *{box-sizing:border-box} .absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.w-full{width:100%}.h-full{height:100%}.overflow-hidden{overflow:hidden}.whitespace-pre{white-space:pre}.pointer-events-none{pointer-events:none}.rounded{border-radius:4px}.flex{display:flex}.items-center{align-items:center}.justify-center{justify-content:center}.text-center{text-align:center}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
 win.document.head.appendChild(css);
 document.querySelectorAll('link[rel="stylesheet"]').forEach(el=>win.document.head.appendChild(el.cloneNode(true)));
 const root=createRoot(win.document.body);
 root.render(<>{pages.flatMap(page=>page.numbers.map((n,index)=><div className="sheet" key={n}><div style={{position:'absolute',left:page.kind==='spread'?-index*p.trimWidthIn*96:0,top:0}}><PageRenderer page={page} scale={96} showBleed /></div></div>))}</>);
 await new Promise(resolve=>setTimeout(resolve,150));
 await win.document.fonts.ready;
 await Promise.all([...win.document.images].map(im=>im.decode().catch(()=>{throw new Error('A picture failed to load. Close the print window and retry.')})));
 win.focus();win.print();
}
