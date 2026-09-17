import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const PREFIX = 'enc:v1:';
const MOCK_PREFIX = 'enc_token_mock_';

/**
 * Validates and retrieves the encryption key from environment variable.
 * Expects a 64-character hex string (32 bytes).
 */
export function getEncryptionKey(): Buffer {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error('ENCRYPTION_KEY environment variable is missing.');
  }

  if (hexKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(hexKey)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes).');
  }

  return Buffer.from(hexKey, 'hex');
}

/**
 * Ensures system configuration is valid on startup.
 */
export function validateEncryptionConfig(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Startup failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Checks whether a token is a development mock credential.
 */
export function isMockToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return token.startsWith(MOCK_PREFIX);
}

/**
 * Checks whether a token string is in encrypted format.
 */
export function isEncryptedToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return token.startsWith(PREFIX);
}

/**
 * Encrypts a plaintext OAuth token using AES-256-GCM.
 * Development mock credentials starting with `enc_token_mock_` are returned as-is.
 */
export function encryptToken(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  if (isMockToken(plaintext)) return plaintext;
  if (isEncryptedToken(plaintext)) return plaintext; // Already encrypted

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an encrypted token string using AES-256-GCM.
 * Development mock credentials starting with `enc_token_mock_` are returned as-is.
 */
export function decryptToken(encryptedText: string | null | undefined): string | null {
  if (!encryptedText) return null;
  if (isMockToken(encryptedText)) return encryptedText;

  if (!isEncryptedToken(encryptedText)) {
    // If it's not encrypted and not a mock token, throw or handle securely
    throw new Error('Invalid credential format: Token is not encrypted.');
  }

  try {
    const key = getEncryptionKey();
    const payload = encryptedText.substring(PREFIX.length);
    const parts = payload.split(':');

    if (parts.length !== 3) {
      throw new Error('Corrupted credential format.');
    }

    const [ivHex, authTagHex, cipherTextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherTextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err: any) {
    if (err.message === 'ENCRYPTION_KEY environment variable is missing.' ||
        err.message.includes('ENCRYPTION_KEY must be')) {
      throw err;
    }
    // Securely sanitize error message to avoid revealing token/key/ciphertext
    throw new Error('Credential decryption failed: Authentication tag verification failed or payload corrupted.');
  }
}
