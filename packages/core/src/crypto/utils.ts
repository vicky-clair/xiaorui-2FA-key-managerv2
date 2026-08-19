/**
 * @file utils.ts
 * @description 密码学辅助工具库：安全随机数、Base64 编解码、恒定时间比较 (Constant-Time) 与内存擦除 (Zeroization)
 */

/**
 * 使用 Web Crypto API 生成密码学强随机字节数组 (CSPRNG)
 * @param length 需要生成的字节数量
 */
export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 将二进制字节数组编码为标准 Base64 字符串
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 将 Base64 字符串解码为二进制字节数组 (Uint8Array)
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 恒定时间比较两个字节数组 (Timing-Safe Equal)
 * 防止由于逐字节比较提前返回而遭受时序侧信道攻击 (Timing Attack)
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * 内存安全擦除：对敏感密钥字节进行物理清零 (Zeroization)
 * 防止密钥残留在 JavaScript V8 堆内存中被转储或侧信道截获
 * @param buffer 需要擦除的敏感二进制数组
 */
export function wipeBytes(buffer: Uint8Array): void {
  buffer.fill(0);
}
