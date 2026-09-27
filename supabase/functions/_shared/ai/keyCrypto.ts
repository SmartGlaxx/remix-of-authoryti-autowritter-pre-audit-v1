// AES-GCM encryption for user provider keys. The encryption secret lives only in the
// backend environment; the database stores ciphertext + IV and a masked hint.
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(secret: string, userId: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error("Key encryption is not configured");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  // Per-user derived key: a ciphertext copied to another user's row cannot be decrypted.
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("authoryti-byok-v1"), info: enc.encode(userId) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptKey(secret: string, userId: string, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveKey(secret, userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function decryptKey(secret: string, userId: string, ciphertext: string, iv: string): Promise<string> {
  const key = await deriveKey(secret, userId);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ciphertext));
  return dec.decode(pt);
}
