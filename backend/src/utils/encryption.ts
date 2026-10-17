import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY environment variable is required for token encryption. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  // Derive a consistent 32-byte key from the provided string
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Output format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a ciphertext string produced by `encrypt()`.
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format.');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Best-effort check whether a value looks like it was produced by `encrypt()`.
 * Used for backward-compatible migration of plaintext tokens.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  try {
    // Each part should be valid base64
    for (const part of parts) {
      const buf = Buffer.from(part, 'base64');
      if (buf.toString('base64') !== part) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Decrypt a token, handling backward compatibility with plaintext tokens.
 * If the value doesn't appear encrypted, returns it as-is.
 */
export function decryptToken(value: string | undefined): string | undefined {
  if (!value) return undefined;

  if (!isEncrypted(value)) {
    // Legacy plaintext token — return as-is
    return value;
  }

  try {
    return decrypt(value);
  } catch {
    // If decryption fails, assume it's a legacy plaintext value
    return value;
  }
}

/**
 * Encrypt a token for storage. Returns undefined if input is empty.
 */
export function encryptToken(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    return encrypt(value);
  } catch {
    // If encryption key is missing, store plaintext but warn
    console.warn('[encryption] TOKEN_ENCRYPTION_KEY not set — storing token in plaintext.');
    return value;
  }
}
