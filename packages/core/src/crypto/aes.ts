import { base64ToUint8Array, generateRandomBytes, uint8ArrayToBase64 } from "./utils";

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits for GCM

export interface EncryptedData {
  ciphertext: string; // Base64
  nonce: string; // Base64
  authTag: string; // Base64
}

/**
 * Helper to import raw key bytes into a CryptoKey for Web Crypto API
 */
async function importKey(key: Uint8Array): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "raw",
    key,
    { name: ALGORITHM },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a plaintext string using AES-256-GCM via Web Crypto API
 * @param plaintext The text to encrypt
 * @param key The 256-bit (32 byte) encryption key
 * @returns EncryptedData containing Base64 encoded ciphertext, nonce, and authTag
 */
export async function encryptAES256GCM(plaintext: string, key: Uint8Array): Promise<EncryptedData> {
  if (key.length !== 32) {
    throw new Error("Key must be exactly 32 bytes for AES-256-GCM");
  }

  const cryptoKey = await importKey(key);
  const nonce = generateRandomBytes(IV_LENGTH);
  const encodedPlaintext = new TextEncoder().encode(plaintext);

  const ciphertextWithTagBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: nonce,
      tagLength: AUTH_TAG_LENGTH * 8, // in bits
    },
    cryptoKey,
    encodedPlaintext
  );

  const ciphertextWithTag = new Uint8Array(ciphertextWithTagBuffer);
  // WebCrypto appends the auth tag to the end of the ciphertext
  const ciphertextBytes = ciphertextWithTag.slice(0, ciphertextWithTag.length - AUTH_TAG_LENGTH);
  const authTagBytes = ciphertextWithTag.slice(ciphertextWithTag.length - AUTH_TAG_LENGTH);

  return {
    ciphertext: uint8ArrayToBase64(ciphertextBytes),
    nonce: uint8ArrayToBase64(nonce),
    authTag: uint8ArrayToBase64(authTagBytes),
  };
}

/**
 * Decrypts data using AES-256-GCM via Web Crypto API
 * @param data The encrypted data structure
 * @param key The 256-bit (32 byte) encryption key
 * @returns The decrypted plaintext string
 */
export async function decryptAES256GCM(data: EncryptedData, key: Uint8Array): Promise<string> {
  if (key.length !== 32) {
    throw new Error("Key must be exactly 32 bytes for AES-256-GCM");
  }

  const cryptoKey = await importKey(key);
  const nonce = base64ToUint8Array(data.nonce);
  const authTag = base64ToUint8Array(data.authTag);
  const ciphertext = base64ToUint8Array(data.ciphertext);

  // WebCrypto expects ciphertext + authTag in a single buffer
  const ciphertextWithTag = new Uint8Array(ciphertext.length + authTag.length);
  ciphertextWithTag.set(ciphertext, 0);
  ciphertextWithTag.set(authTag, ciphertext.length);

  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv: nonce,
      tagLength: AUTH_TAG_LENGTH * 8, // in bits
    },
    cryptoKey,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Generates a strong random key of the specified byte length using Web Crypto API
 * @param length Defaults to 32 bytes (256 bits)
 */
export function generateRandomKey(length = 32): Uint8Array {
  return generateRandomBytes(length);
}
