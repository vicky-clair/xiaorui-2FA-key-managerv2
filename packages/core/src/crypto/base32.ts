/**
 * @file base32.ts
 * @description RFC 4648 标准 Base32 编码与解码工具
 * 广泛用于 2FA 密钥解析（如 Google Authenticator、GitHub、Binance 等）。
 */

const RFC4648_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * 将二进制字节数组编码为标准 Base32 字符串
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

/**
 * 将 Base32 字符串安全解码为二进制字节数组 (Uint8Array)
 * 自动忽略空格、连字符并容错转换大小写
 */
export function base32ToUint8Array(input: string): Uint8Array {
  // 过滤用户粘贴时常见的空格、破折号、等号填充以及不可见控制字符
  let sanitized = input.toUpperCase().replace(/[\s\-=_\r\n\t]/g, "");
  if (!sanitized) {
    return new Uint8Array(0);
  }

  // 常见手误/编码字符智能容错修复 (0 -> O, 1 -> I, 8 -> B)
  sanitized = sanitized.replace(/0/g, "O").replace(/1/g, "I").replace(/8/g, "B");

  let bits = 0;
  let value = 0;
  const result: number[] = [];

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];
    const index = RFC4648_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Base32 格式无效：包含非法字符 '${char}'`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(result);
}
