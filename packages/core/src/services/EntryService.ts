import { decryptAES256GCM, encryptAES256GCM, generateRandomKey } from "../crypto/aes";
import type { AuthenticatorEntry, EntryPayload } from "../types/domain";

/**
 * Generates a new UUID v4 string safely across all environments.
 */
function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = generateRandomKey(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

/**
 * Encrypts an EntryPayload with the Vault Key and creates an AuthenticatorEntry record.
 */
export async function createEncryptedEntry(
  payload: EntryPayload,
  vaultId: string,
  vaultKey: Uint8Array,
  options: { favorite?: boolean; sortOrder?: number } = {}
): Promise<AuthenticatorEntry> {
  const jsonString = JSON.stringify(payload);
  const encrypted = await encryptAES256GCM(jsonString, vaultKey);

  const now = new Date().toISOString();
  return {
    id: generateUUID(),
    vaultId,
    createdAt: now,
    updatedAt: now,
    favorite: options.favorite ?? false,
    sortOrder: options.sortOrder ?? 0,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
  };
}

/**
 * Decrypts an AuthenticatorEntry record using the Vault Key.
 */
export async function decryptEntryPayload(
  entry: AuthenticatorEntry,
  vaultKey: Uint8Array
): Promise<EntryPayload> {
  const decryptedJson = await decryptAES256GCM(
    {
      ciphertext: entry.ciphertext,
      nonce: entry.nonce,
      authTag: entry.authTag,
    },
    vaultKey
  );

  return JSON.parse(decryptedJson) as EntryPayload;
}
