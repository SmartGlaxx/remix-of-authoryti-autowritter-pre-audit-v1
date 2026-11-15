import { contentHash } from './extraction.ts';

/** Recover only a complete section matching the acceptance hash. Never infer boundaries by position. */
export function recoverAcceptedText(hash: string, outlineText: unknown, manuscript: unknown): string | null {
  if (typeof outlineText === 'string' && outlineText.trim() && contentHash(outlineText) === hash) return outlineText;
  if (typeof manuscript !== 'string' || manuscript.length > 500_000) return null;
  const length = Number(hash.split('_')[1]);
  if (!Number.isSafeInteger(length) || length <= 0 || length > manuscript.length) return null;
  const chars: string[] = [], offsets: number[] = [];
  for (const match of manuscript.matchAll(/\S+|\s+/g)) {
    if (/^\s/.test(match[0])) { if(chars.length) { chars.push(' '); offsets.push(match.index!); } }
    else for(let i=0;i<match[0].length;i++){chars.push(match[0][i]);offsets.push(match.index!+i)}
  }
  const normalized=chars.join('').trimEnd();
  // Committed sections are appended with paragraph separators. Restrict the search to paragraph starts.
  const starts=new Set([0,...[...manuscript.matchAll(/\n\s*\n(?=\S)/g)].map(m=>m.index!+m[0].length)]);
  let found: string | null=null;
  for(let i=0;i+length<=normalized.length;i++){
    if(!starts.has(offsets[i]))continue;
    if(i+length<normalized.length && normalized[i+length] !== ' ')continue;
    const slice=normalized.slice(i,i+length);
    if(contentHash(slice)!==hash)continue;
    const text=manuscript.slice(offsets[i],offsets[i+length-1]+1);
    if(found!==null && found!==text)return null;
    found=text;
  }
  return found;
}
