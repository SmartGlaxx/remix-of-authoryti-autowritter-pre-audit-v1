// Owner-verified callers only. Store private reference first; inspect that actual image second.
import { generateOpenAIImage } from '../ai/openaiImage.ts';
import { generateAIText } from '../ai/client.ts';
import { createAIDeps } from '../ai/server.ts';
import { parseModelJson } from './extraction.ts';
import { referencePrompt, validateCharacterLock, type CharacterLock } from './characterReference.ts';
const object = (properties: Record<string,unknown>) => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string = {type:'string'};
const schema = object({ features: object(Object.fromEntries(['build','skinTone','face','eyes','hair','hands','posture','clothes','distinctiveMarks'].map(k=>[k,string]))) });
export async function createCharacterReference(admin: any, userId: string, bookId: string, character: any, others: CharacterLock[] = []) {
  const path = `${userId}/books/${bookId}/${encodeURIComponent(character.id)}/five-view.png`;
  // Stable private object avoids paying for the image again when vision/card completion is retried.
  let { data: signed } = await admin.storage.from('persona-portraits').createSignedUrl(path,3600);
  if (!signed?.signedUrl) {
    const image = await generateOpenAIImage({ admin, userId, prompt: referencePrompt(character.name, character.role, character.visualDescription ?? ''), size:'1536x1024', quality:'low', noFallback:true });
    const response = await fetch(image);
    if (!response.ok) throw new Error('Could not read generated reference');
    const upload = await admin.storage.from('persona-portraits').upload(path,await response.arrayBuffer(),{contentType:'image/png',upsert:true});
    if (upload.error) throw upload.error;
    const result = await admin.storage.from('persona-portraits').createSignedUrl(path,3600); signed = result.data;
  }
  if (!signed?.signedUrl) throw new Error('Private reference unavailable');
  const result = await generateAIText({ role:'character_generator',config:{mode:'single',singleModel:'openai/gpt-6-astra'},userId,bookId,
    request:{system:'Describe only visible features in this actual five-view reference. Unknown/obscured fields must say unknown. Do not infer gender, ethnicity, exact height/weight, strength, behaviour or voice from appearance.',user:'Return JSON features of this reference image.',images:[signed.signedUrl],jsonSchema:schema,reasoning:'low'} },createAIDeps(admin,userId));
  const visible = parseModelJson(result.text).features;
  if (!visible || typeof visible !== 'object' || Object.values(visible).some(v=>typeof v !== 'string')) throw new Error('Visible feature extraction failed');
  const lock: CharacterLock = { ...character.reference, referencePath:path, features:visible as Record<string,string>, locked:true };
  const issues = validateCharacterLock(lock,others);
  if (issues.length) throw new Error(issues.join('; '));
  return { ...character, portraitUrl:signed.signedUrl, reference:lock, visualDescription:Object.entries(lock.features).map(([k,v])=>`${k}: ${v}`).join('; ') };
}