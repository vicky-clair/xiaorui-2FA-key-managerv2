/**
 * @file crypto.ts
 * @description 浏览器扩展专用密码学与 TOTP 引擎 (基于 Web Crypto API 标准)
 */

// RFC 4648 Base32 解码
const RFC4648_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32ToUint8Array(base32Str: string): Uint8Array {
  const cleanStr = base32Str.replace(/[\s\-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const char = cleanStr[i];
    if (char === "=") break;

    const val = RFC4648_ALPHABET.indexOf(char);
    if (val === -1) {
      throw new Error(`非法 Base32 字符: ${char}`);
    }

    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

// 解析 otpauth:// 链接
export interface ParsedOtpAuth {
  type: "totp" | "hotp";
  issuer: string;
  account: string;
  secret: string;
  algorithm: "SHA-1" | "SHA-256" | "SHA-512";
  digits: number;
  period: number;
  counter?: number;
  rawUri: string;
}

export function parseOtpAuthUri(uri: string): ParsedOtpAuth {
  let cleanUri = uri.trim();
  if (cleanUri.includes("?uri=")) {
    const idx = cleanUri.indexOf("?uri=");
    cleanUri = decodeURIComponent(cleanUri.substring(idx + 5));
  }
  if (cleanUri.startsWith("otpauth%3A%2F%2F") || cleanUri.startsWith("otpauth%3a%2f%2f")) {
    cleanUri = decodeURIComponent(cleanUri);
  }

  if (!cleanUri.toLowerCase().startsWith("otpauth://") && !cleanUri.toLowerCase().startsWith("otpauth:/")) {
    throw new Error("不是有效的 otpauth 链接");
  }

  // 1. 使用正则提取 type (totp / hotp) 与 路径、参数
  const typeMatch = cleanUri.match(/^otpauth:\/+(totp|hotp)(\/[^?]+)?(\?.*)?$/i);
  let type: "totp" | "hotp" = "totp";
  let pathPart = "";
  let queryPart = "";

  if (typeMatch) {
    type = typeMatch[1].toLowerCase() as "totp" | "hotp";
    pathPart = typeMatch[2] ? typeMatch[2].replace(/^\/+/, "") : "";
    queryPart = typeMatch[3] || "";
  } else {
    try {
      const url = new URL(cleanUri);
      let host = url.host ? url.host.toLowerCase() : "";
      let pathname = url.pathname.replace(/^\/+/, "");
      if (!host && pathname) {
        const segs = pathname.split("/");
        host = segs[0].toLowerCase();
        pathname = segs.slice(1).join("/");
      }
      type = host === "hotp" ? "hotp" : "totp";
      pathPart = pathname;
      queryPart = url.search;
    } catch {
      type = "totp";
    }
  }

  // 2. 解析 label (issuer:account 或 account)
  let labelIssuer = "";
  let labelAccount = "";
  if (pathPart) {
    const fullLabel = decodeURIComponent(pathPart);
    if (fullLabel.includes(":")) {
      const parts = fullLabel.split(":");
      labelIssuer = parts[0].trim();
      labelAccount = parts.slice(1).join(":").trim();
    } else {
      labelAccount = fullLabel.trim();
    }
  }

  // 3. 解析 searchParams
  const searchParams = new URLSearchParams(queryPart);
  const secret = searchParams.get("secret");
  if (!secret) {
    throw new Error("otpauth 缺少 secret 密钥参数");
  }

  const queryIssuer = searchParams.get("issuer");
  const finalIssuer = queryIssuer ? queryIssuer.trim() : (labelIssuer || "2FA Service");
  const finalAccount = labelAccount || finalIssuer;

  const rawAlgo = (searchParams.get("algorithm") || "SHA1").toUpperCase();
  let algorithm: "SHA-1" | "SHA-256" | "SHA-512" = "SHA-1";
  if (rawAlgo === "SHA256" || rawAlgo === "SHA-256") algorithm = "SHA-256";
  if (rawAlgo === "SHA512" || rawAlgo === "SHA-512") algorithm = "SHA-512";

  const digits = parseInt(searchParams.get("digits") || "6", 10);
  const period = parseInt(searchParams.get("period") || "30", 10);
  const counterStr = searchParams.get("counter");
  const counter = counterStr ? parseInt(counterStr, 10) : undefined;

  return {
    type,
    issuer: finalIssuer,
    account: finalAccount,
    secret: secret.replace(/[\s\-_=]/g, "").toUpperCase(),
    algorithm,
    digits: isNaN(digits) ? 6 : digits,
    period: isNaN(period) ? 30 : period,
    counter,
    rawUri: cleanUri,
  };
}

// 快速校验是否是合法的 2FA 二维码文本
export function is2FaOtpAuthUri(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  let clean = text.trim();
  if (clean.includes("?uri=")) {
    const idx = clean.indexOf("?uri=");
    clean = decodeURIComponent(clean.substring(idx + 5));
  }
  if (clean.startsWith("otpauth%3A%2F%2F") || clean.startsWith("otpauth%3a%2f%2f")) {
    clean = decodeURIComponent(clean);
  }
  return /^otpauth:\/+(totp|hotp)\//i.test(clean);
}

// RFC 6238 TOTP 动态码计算
export async function generateTOTP(
  secretBase32: string,
  options?: {
    algorithm?: "SHA-1" | "SHA-256" | "SHA-512";
    digits?: number;
    period?: number;
    timestamp?: number;
  }
): Promise<{ code: string; remainingSeconds: number; progress: number }> {
  const algorithm = options?.algorithm || "SHA-1";
  const digits = options?.digits || 6;
  const period = options?.period || 30;
  const now = options?.timestamp || Date.now();

  const epochSeconds = Math.floor(now / 1000);
  const timeStep = Math.floor(epochSeconds / period);
  const remainingSeconds = period - (epochSeconds % period);
  const progress = remainingSeconds / period;

  const keyBytes = base32ToUint8Array(secretBase32);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as any as BufferSource,
    { name: "HMAC", hash: { name: algorithm } },
    false,
    ["sign"]
  );

  // Time buffer: 8 bytes big endian
  const timeBuffer = new ArrayBuffer(8);
  const dataView = new DataView(timeBuffer);
  dataView.setBigUint64(0, BigInt(timeStep), false);

  const hmacSignature = await crypto.subtle.sign("HMAC", cryptoKey, timeBuffer);
  const hmacBytes = new Uint8Array(hmacSignature);

  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const binary =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  const code = String(otp).padStart(digits, "0");

  return { code, remainingSeconds, progress };
}

// AES-256-GCM 加解密工具
export async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as any as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as any as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptData(plaintext: string, key: CryptoKey): Promise<{ ciphertextHex: string; ivHex: string }> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as any as BufferSource },
    key,
    enc.encode(plaintext) as any as BufferSource
  );

  const ciphertextHex = Array.from(new Uint8Array(encrypted))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ivHex = Array.from(iv)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { ciphertextHex, ivHex };
}

export async function decryptData(ciphertextHex: string, ivHex: string, key: CryptoKey): Promise<string> {
  const ciphertext = new Uint8Array(ciphertextHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as any as BufferSource },
    key,
    ciphertext as any as BufferSource
  );

  const dec = new TextDecoder();
  return dec.decode(decrypted);
}
