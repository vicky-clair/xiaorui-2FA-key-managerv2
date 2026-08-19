import { base32ToUint8Array } from "./base32";
import type { EntryPayload, OTPAlgorithm } from "../types/domain";

const ALLOWED_ALGORITHMS: OTPAlgorithm[] = ["SHA1", "SHA256", "SHA512"];

/**
 * Maps OTPAlgorithm to WebCrypto hash name.
 */
function getHashName(algorithm: OTPAlgorithm = "SHA1"): string {
  const norm = algorithm.toUpperCase();
  if (norm === "SHA256") return "SHA-256";
  if (norm === "SHA512") return "SHA-512";
  return "SHA-1";
}

/**
 * Computes an HMAC-based One-Time Password (HOTP) as per RFC 4226.
 *
 * @param secret Base32-encoded secret key or Uint8Array
 * @param counter The 64-bit counter value
 * @param digits Number of digits (default: 6, supports 6-8)
 * @param algorithm Hash algorithm (default: SHA1)
 * @returns Formatted OTP string (e.g. "123456")
 */
export async function generateHOTP(
  secret: string | Uint8Array,
  counter: number,
  digits: number = 6,
  algorithm: OTPAlgorithm = "SHA1"
): Promise<string> {
  const safeDigits = Math.min(Math.max(Number(digits) || 6, 6), 8);
  const safeAlgo = ALLOWED_ALGORITHMS.includes(algorithm) ? algorithm : "SHA1";
  const keyBytes = typeof secret === "string" ? base32ToUint8Array(secret) : secret;

  if (keyBytes.length === 0) {
    throw new Error("Secret key cannot be empty");
  }

  const hashName = getHashName(safeAlgo);

  // Import key for HMAC
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: { name: hashName } },
    false,
    ["sign"]
  );

  // Counter as 8-byte big-endian DataView
  const counterBuffer = new ArrayBuffer(8);
  const dataView = new DataView(counterBuffer);
  const high = Math.floor(counter / 0x100000000);
  const low = counter & 0xffffffff;
  dataView.setUint32(0, high, false);
  dataView.setUint32(4, low, false);

  // Sign with HMAC
  const signature = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, counterBuffer);
  const hmacResult = new Uint8Array(signature);

  // Dynamic truncation (RFC 4226 Section 5.3)
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  const modulus = Math.pow(10, safeDigits);
  const otpNumber = code % modulus;

  return otpNumber.toString().padStart(safeDigits, "0");
}

/**
 * Computes a Time-based One-Time Password (TOTP) as per RFC 6238.
 *
 * @param secret Base32-encoded secret key or Uint8Array
 * @param timestamp Optional epoch timestamp in milliseconds (defaults to Date.now())
 * @param period Time step in seconds (default: 30)
 * @param digits Number of digits (default: 6)
 * @param algorithm Hash algorithm (default: SHA1)
 * @returns The current TOTP code string
 */
export async function generateTOTP(
  secret: string | Uint8Array,
  timestamp: number = Date.now(),
  period: number = 30,
  digits: number = 6,
  algorithm: OTPAlgorithm = "SHA1"
): Promise<string> {
  const safePeriod = Math.min(Math.max(Number(period) || 30, 5), 600);
  const epochSeconds = Math.floor(timestamp / 1000);
  const counter = Math.floor(epochSeconds / safePeriod);
  return await generateHOTP(secret, counter, digits, algorithm);
}

/**
 * Calculates remaining seconds in the current TOTP period.
 */
export function getRemainingSeconds(period: number = 30, timestamp: number = Date.now()): number {
  const safePeriod = Math.min(Math.max(Number(period) || 30, 5), 600);
  const epochSeconds = Math.floor(timestamp / 1000);
  const elapsed = epochSeconds % safePeriod;
  return safePeriod - elapsed;
}

/**
 * Calculates time progress in the current TOTP period from 0.0 to 1.0.
 */
export function getPeriodProgress(period: number = 30, timestamp: number = Date.now()): number {
  const safePeriod = Math.min(Math.max(Number(period) || 30, 5), 600);
  const epochSeconds = Math.floor(timestamp / 1000);
  const elapsed = epochSeconds % safePeriod;
  return elapsed / safePeriod;
}

/**
 * Parses an otpauth:// URL into an EntryPayload object with strict validation and sanitization.
 * Format: otpauth://totp/[Issuer:]Account?secret=SECRET&issuer=Issuer&algorithm=SHA1&digits=6&period=30
 */
export function parseOtpAuthUri(uri: string): EntryPayload {
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith("otpauth://")) {
    throw new Error("Invalid URI scheme. Must start with otpauth://");
  }

  // Parse URL safely without eval
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Malformed otpauth URI format");
  }

  if (parsed.protocol !== "otpauth:") {
    throw new Error("Invalid URI scheme. Expected otpauth:");
  }

  const type = parsed.hostname.toLowerCase();
  if (type !== "totp" && type !== "hotp") {
    throw new Error(`Unsupported OTP type: ${type}. Only TOTP is currently supported.`);
  }

  // Extract label: /Issuer:Account or /Account
  let label = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  let issuer = "";
  let account = "";

  if (label.includes(":")) {
    const parts = label.split(":");
    issuer = parts[0].trim();
    account = parts.slice(1).join(":").trim();
  } else {
    account = label.trim();
  }

  const queryIssuer = parsed.searchParams.get("issuer");
  if (queryIssuer) {
    issuer = queryIssuer.trim();
  }

  const rawSecret = parsed.searchParams.get("secret");
  if (!rawSecret) {
    throw new Error("Missing secret parameter in otpauth URI");
  }

  // Sanitize secret: remove spaces and hyphens, uppercase
  const cleanSecret = rawSecret.replace(/[\s\-]/g, "").toUpperCase();

  // Validate Base32 format
  try {
    base32ToUint8Array(cleanSecret);
  } catch {
    throw new Error("Secret is not a valid Base32 encoded string");
  }

  // Parse algorithm safely
  const rawAlgo = parsed.searchParams.get("algorithm")?.toUpperCase();
  let algorithm: OTPAlgorithm = "SHA1";
  if (rawAlgo === "SHA256" || rawAlgo === "SHA512") {
    algorithm = rawAlgo;
  }

  // Parse digits safely (bounded between 6 and 8)
  const rawDigits = parseInt(parsed.searchParams.get("digits") || "6", 10);
  const digits = isNaN(rawDigits) ? 6 : Math.min(Math.max(rawDigits, 6), 8);

  // Parse period safely (bounded between 5 and 600)
  const rawPeriod = parseInt(parsed.searchParams.get("period") || "30", 10);
  const period = isNaN(rawPeriod) ? 30 : Math.min(Math.max(rawPeriod, 5), 600);

  // Truncate maximum string lengths to prevent storage/memory DoS
  const safeIssuer = (issuer || account || "2FA").slice(0, 100);
  const safeAccount = (account || issuer || "Account").slice(0, 100);

  return {
    issuer: safeIssuer,
    account: safeAccount,
    secret: cleanSecret.slice(0, 256),
    algorithm,
    digits,
    period,
  };
}
