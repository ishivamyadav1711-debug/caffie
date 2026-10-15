import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
function getKey(): Buffer {
  const keyBase64 = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyBase64) {
    if (process.env.NODE_ENV === 'test') {
      return Buffer.alloc(32, 1);
    }
    throw new Error('TOKEN_ENCRYPTION_KEY env var must be set');
  }
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

/** Encrypt a UTF‑8 string and return base64 ciphertext */
export function encrypt(plain: string): string {
  const iv = randomBytes(12); // 96‑bit nonce
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Decrypt a base64‑encoded ciphertext back to UTF‑8 string */
export function decrypt(cipherB64: string): string {
  const data = Buffer.from(cipherB64, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
