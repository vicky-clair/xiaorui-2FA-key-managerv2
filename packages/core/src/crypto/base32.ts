/**
 * RFC 4648 Base32 decoder and encoder.
 */
const RFC4648_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decodes a Base32 string (case-insensitive, ignores spaces and hyphens) to a Uint8Array.
 */
export function base32ToUint8Array(base32: string): Uint8Array {
  // Normalize string: uppercase, remove spaces, hyphens, and padding '='
  const clean = base32.toUpperCase().replace(/[\s\-=]/g, "");
  if (clean.length === 0) {
    return new Uint8Array(0);
  }

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const char = clean.charAt(i);
    const index = RFC4648_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: "${char}"`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

/**
 * Encodes a Uint8Array to a Base32 string without padding.
 */
export function uint8ArrayToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;

    while (bits >= 5) {
      output += RFC4648_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += RFC4648_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}
