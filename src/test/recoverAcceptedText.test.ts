import {it,expect} from 'vitest';
import { contentHash } from '../../supabase/functions/_shared/narrative/extraction';
import { recoverAcceptedText } from '../../supabase/functions/_shared/narrative/recoverAcceptedText';
it('recovers exact accepted paragraphs without including adjacent sections',()=>{const text='First line.\n\nSecond paragraph.';expect(recoverAcceptedText(contentHash(text),null,'Previous section.\n\n'+text+'\n\nNext section.')).toBe(text)});
it('prefers hash-matching outline text',()=>{const text='Accepted text.';expect(recoverAcceptedText(contentHash(text),text,'Other text')).toBe(text)});
it('refuses stale outline and unrelated manuscript',()=>{expect(recoverAcceptedText(contentHash('Accepted text.'),'Changed text.','Other text.')).toBeNull()});
it('does not recover a prefix as a complete section',()=>{expect(recoverAcceptedText(contentHash('Hello'),'','Helloworld.')).toBeNull()});
