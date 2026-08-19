/**
 * Converts a Uint8Array or Buffer to a standard Base64 string.
 * Works seamlessly in Node.js, Web Browser, Electron, React Native.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.Buffer !== "undefined") {
    return globalThis.Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

/**
 * Converts a Base64 string to a Uint8Array.
 * Works seamlessly in Node.js, Web Browser, Electron, React Native.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof globalThis.Buffer !== "undefined") {
    const buf = globalThis.Buffer.from(base64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = globalThis.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a strong random byte array of specified length using Web Crypto (CSPRNG).
 */
export function generateRandomBytes(length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Overwrites a Uint8Array buffer with zeroes to safely wipe sensitive keys from memory.
 */
export function wipeBytes(bytes: Uint8Array | null | undefined): void {
  if (!bytes) return;
  try {
    bytes.fill(0);
  } catch {
    // If buffer is detached or read-only, ignore
  }
}

/**
 * Performs a constant-time comparison of two Uint8Arrays to prevent timing attacks.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
