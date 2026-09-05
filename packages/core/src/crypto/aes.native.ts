import { Buffer } from "node:buffer";
import crypto from "react-native-quick-crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits for GCM

export interface EncryptedData {
  ciphertext: string; // Base64
  nonce: string; // Base64
  authTag: string; // Base64
}

/**
 * Encrypts a plaintext string using AES-256-GCM
 * @param plaintext The text to encrypt
 * @param key The 256-bit (32 byte) encryption key
 * @returns EncryptedData containing Base64 encoded ciphertext, nonce, and authTag
 */
export async function encryptAES256GCM(
  plaintext: string,
  key: Uint8Array | Buffer,
): Promise<EncryptedData> {
  if (key.length !== 32) {
    throw new Error("Key must be exactly 32 bytes for AES-256-GCM");
  }

  const nonce = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(key), nonce);

  const ciphertext = Buffer.concat([
    Buffer.from(cipher.update(plaintext, "utf8")),
    Buffer.from(cipher.final()),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Decrypts data using AES-256-GCM
 * @param data The encrypted data structure
 * @param key The 256-bit (32 byte) encryption key
 * @returns The decrypted plaintext string
 */
export async function decryptAES256GCM(
  data: EncryptedData,
  key: Uint8Array | Buffer,
): Promise<string> {
  if (key.length !== 32) {
    throw new Error("Key must be exactly 32 bytes for AES-256-GCM");
  }

  const nonce = Buffer.from(data.nonce, "base64");
  const authTag = Buffer.from(data.authTag, "base64");
  const ciphertext = Buffer.from(data.ciphertext, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key), nonce);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    Buffer.from(decipher.update(ciphertext)),
    Buffer.from(decipher.final()),
  ]);

  return plaintext.toString("utf8");
}

/**
 * Generates a strong random key of the specified byte length
 * @param length Defaults to 32 bytes (256 bits)
 */
export function generateRandomKey(length = 32): Uint8Array {
  return crypto.randomBytes(length);
}
