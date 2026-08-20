/**
 * @file totp.ts
 * @description RFC 6238 (TOTP) 与 RFC 4226 (HOTP) 标准动态口令生成与 URI 解析模块
 * 支持 SHA1 / SHA256 / SHA512 散列算法，自适应处理 6 位/8 位数字验证码及多种时间步长。
 */

import { base32ToUint8Array } from "./base32";
import type { OTPAlgorithm } from "../types/domain";

export { type OTPAlgorithm };

export interface ParsedOtpAuthUri {
  type: "totp" | "hotp";
  issuer: string;
  account: string;
  secret: string; // Base32 编码的原始密钥
  algorithm: OTPAlgorithm;
  digits: number;
  period: number;
  counter?: number;
}

/**
 * 内部辅助函数：根据算法名称获取 Web Crypto HMAC 散列标识
 */
function getWebCryptoAlgorithmName(algo: OTPAlgorithm): string {
  switch (algo) {
    case "SHA256":
      return "SHA-256";
    case "SHA512":
      return "SHA-512";
    case "SHA1":
    default:
      return "SHA-1";
  }
}

/**
 * 基于 RFC 4226 标准实现 HMAC-Based One-Time Password (HOTP)
 * @param secret Base32 编码的密钥字符串
 * @param counter 计数器数值 (64位整数)
 * @param digits 生成口令的位数，默认为 6 位 (RFC 标准支持 6-8 位)
 * @param algorithm 散列算法，默认为 SHA1
 * @returns 格式化后的数字验证码字符串 (前置补 0)
 */
export async function generateHOTP(
  secret: string,
  counter: number,
  digits = 6,
  algorithm: OTPAlgorithm = "SHA1"
): Promise<string> {
  const cleanSecret = secret.replace(/[\s\-]/g, "").toUpperCase();
  const keyBytes = base32ToUint8Array(cleanSecret);

  // 1. 将计数器转换为 8 字节大端序 (Big-Endian) 二进制缓冲区
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  // JavaScript 数字超过 32 位安全整数时进行高低位拆分写入
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  counterView.setUint32(0, high, false);
  counterView.setUint32(4, low, false);

  // 2. 导入 HMAC 密钥
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes as any as BufferSource,
    {
      name: "HMAC",
      hash: { name: getWebCryptoAlgorithmName(algorithm) },
    },
    false,
    ["sign"]
  );

  // 3. 计算 HMAC 签名散列
  const hmacSignature = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, counterBuffer);
  const hmacBytes = new Uint8Array(hmacSignature);

  // 4. 动态截断 (Dynamic Truncation - RFC 4226 Section 5.4)
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const binary =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  // 5. 取模生成指定位数的动态验证码
  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, "0");
}

/**
 * 基于 RFC 6238 标准实现 Time-Based One-Time Password (TOTP)
 * @param secret Base32 编码的密钥字符串
 * @param timestamp 当前时间戳 (毫秒)，默认为当前系统时间 Date.now()
 * @param period 验证码更新步长 (秒)，标准为 30 秒
 * @param digits 验证码位数，默认为 6 位
 * @param algorithm 散列算法，默认为 SHA1
 * @returns 实时动态验证码
 */
export async function generateTOTP(
  secret: string,
  timestamp: number = Date.now(),
  period = 30,
  digits = 6,
  algorithm: OTPAlgorithm = "SHA1"
): Promise<string> {
  const counter = Math.floor(timestamp / 1000 / period);
  return generateHOTP(secret, counter, digits, algorithm);
}

/**
 * 计算当前周期内验证码的剩余有效秒数
 * @param period 周期时长 (秒，如 30)
 * @param timestamp 当前时间戳 (毫秒)
 */
export function getRemainingSeconds(period = 30, timestamp: number = Date.now()): number {
  const currentSeconds = Math.floor(timestamp / 1000);
  const remainder = currentSeconds % period;
  return period - remainder;
}

/**
 * 计算当前周期的已耗时进度百分比 (0.0 ~ 1.0)
 * @param period 周期时长 (秒)
 * @param timestamp 当前时间戳 (毫秒)
 */
export function getPeriodProgress(period = 30, timestamp: number = Date.now()): number {
  const secondsInPeriod = (timestamp / 1000) % period;
  return secondsInPeriod / period;
}

/**
 * 解析标准的 otpauth:// 协议链接 (如 Google Authenticator 二维码 URL)
 * 示例: otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&period=30
 */
export function parseOtpAuthUri(uri: string): ParsedOtpAuthUri {
  let cleanUri = uri.trim();
  if (cleanUri.includes("?uri=")) {
    const idx = cleanUri.indexOf("?uri=");
    cleanUri = decodeURIComponent(cleanUri.substring(idx + 5));
  }
  if (cleanUri.startsWith("otpauth%3A%2F%2F") || cleanUri.startsWith("otpauth%3a%2f%2f")) {
    cleanUri = decodeURIComponent(cleanUri);
  }

  if (!cleanUri.toLowerCase().startsWith("otpauth://") && !cleanUri.toLowerCase().startsWith("otpauth:/")) {
    throw new Error("无效的 2FA 链接协议，必须以 otpauth:// 开头");
  }

  // 1. 使用正则稳妥提取 type (totp / hotp) 与 剩余路径和查询参数
  const typeMatch = cleanUri.match(/^otpauth:\/+(totp|hotp)(\/[^?]+)?(\?.*)?$/i);
  
  let type: "totp" | "hotp" = "totp";
  let pathPart = "";
  let queryPart = "";

  if (typeMatch) {
    type = typeMatch[1].toLowerCase() as "totp" | "hotp";
    pathPart = typeMatch[2] ? typeMatch[2].replace(/^\/+/, "") : "";
    queryPart = typeMatch[3] || "";
  } else {
    // 降级使用 URL 兼容提取
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

  // 2. 从 pathPart 中解析服务商 (issuer) 与 账号 (account)
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
    throw new Error("otpauth URI 中缺少必要的 secret 密钥参数");
  }

  const issuerParam = searchParams.get("issuer");
  const finalIssuer = issuerParam ? issuerParam.trim() : (labelIssuer || "2FA Service");
  const finalAccount = labelAccount || finalIssuer;

  const rawAlgo = (searchParams.get("algorithm") || "SHA1").toUpperCase();
  let algorithm: OTPAlgorithm = "SHA1";
  if (rawAlgo === "SHA256" || rawAlgo === "SHA-256") algorithm = "SHA256";
  if (rawAlgo === "SHA512" || rawAlgo === "SHA-512") algorithm = "SHA512";

  const digits = parseInt(searchParams.get("digits") || "6", 10);
  const period = parseInt(searchParams.get("period") || "30", 10);
  const counterParam = searchParams.get("counter");
  const counter = counterParam ? parseInt(counterParam, 10) : undefined;

  return {
    type,
    issuer: finalIssuer,
    account: finalAccount,
    secret: secret.replace(/[\s\-_=]/g, "").toUpperCase(),
    algorithm,
    digits: isNaN(digits) ? 6 : digits,
    period: isNaN(period) ? 30 : period,
    counter,
  };
}
