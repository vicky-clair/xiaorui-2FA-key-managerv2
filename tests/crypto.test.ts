import { describe, expect, it } from "bun:test";
import {
  base32ToUint8Array,
  decryptAES256GCM,
  deriveKey,
  encryptAES256GCM,
  generateRandomBytes,
  timingSafeEqual,
  uint8ArrayToBase32,
  uint8ArrayToBase64,
  base64ToUint8Array,
  wipeBytes,
  DEFAULT_KDF_PARAMS,
} from "../packages/core/src";

describe("Security & Crypto Core Test Suite", () => {
  it("should encrypt and decrypt plaintext accurately using AES-256-GCM", async () => {
    const key = generateRandomBytes(32);
    const plaintext = JSON.stringify({
      issuer: "GitHub",
      account: "octocat@github.com",
      secret: "JBSWY3DPEHPK3PXP",
    });

    const encrypted = await encryptAES256GCM(plaintext, key);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.nonce).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();

    const decrypted = await decryptAES256GCM(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("should fail decryption when ciphertext is tampered with (GCM auth tag verification)", async () => {
    const key = generateRandomBytes(32);
    const plaintext = "Sensitive 2FA Secret Key";

    const encrypted = await encryptAES256GCM(plaintext, key);

    // Tamper with ciphertext
    const tamperedBytes = base64ToUint8Array(encrypted.ciphertext);
    tamperedBytes[0] ^= 0xff; // flip bits
    const tamperedEncrypted = {
      ...encrypted,
      ciphertext: uint8ArrayToBase64(tamperedBytes),
    };

    expect(decryptAES256GCM(tamperedEncrypted, key)).rejects.toThrow();
  });

  it("should fail decryption when wrong key is provided", async () => {
    const key1 = generateRandomBytes(32);
    const key2 = generateRandomBytes(32);
    const plaintext = "Top Secret";

    const encrypted = await encryptAES256GCM(plaintext, key1);
    expect(decryptAES256GCM(encrypted, key2)).rejects.toThrow();
  });

  it("should derive deterministic key from password with Argon2id", async () => {
    const salt = uint8ArrayToBase64(generateRandomBytes(16));
    const params = { ...DEFAULT_KDF_PARAMS, salt };

    const key1 = await deriveKey("MasterPassword123!", params);
    const key2 = await deriveKey("MasterPassword123!", params);
    const keyDifferentPassword = await deriveKey("WrongPassword!", params);

    expect(key1.length).toBe(32);
    expect(timingSafeEqual(key1, key2)).toBe(true);
    expect(timingSafeEqual(key1, keyDifferentPassword)).toBe(false);
  });

  it("should correctly zeroize memory with wipeBytes", () => {
    const key = generateRandomBytes(32);
    expect(key.some((b) => b !== 0)).toBe(true);

    wipeBytes(key);
    expect(key.every((b) => b === 0)).toBe(true);
  });

  it("should correctly encode and decode RFC 4648 Base32", () => {
    const testStrings = [
      "Hello 2FA",
      "admin",
      "abcde",
      "SecureAuthenticator",
      "zero-knowledge 2fa key manager v2",
    ];

    for (const str of testStrings) {
      const bytes = new TextEncoder().encode(str);
      const encoded = uint8ArrayToBase32(bytes);
      const decodedBytes = base32ToUint8Array(encoded);
      expect(new TextDecoder().decode(decodedBytes)).toBe(str);
    }
  });




  it("should reject invalid Base32 strings", () => {
    expect(() => base32ToUint8Array("1890InvalidBase32!")).toThrow();
  });
});
