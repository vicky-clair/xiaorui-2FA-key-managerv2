/**
 * @file aes.ts
 * @description AES-256-GCM 高强度对称加解密模块
 * 遵循 Web Crypto API 标准，提供认证加密 (AEAD)，防止密文被篡改与伪造。
 */

import { base64ToUint8Array, generateRandomBytes, uint8ArrayToBase64 } from "./utils";

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // GCM 标准初始化向量长度：96 位 (12 字节)
const AUTH_TAG_LENGTH = 16; // GCM 认证标签长度：128 位 (16 字节)

/**
 * 加密数据通用载荷结构 (密文 + 随机向量 + 认证标签)
 */
export interface EncryptedData {
  ciphertext: string; // Base64 编码的密文
  nonce: string; // Base64 编码的 12 字节初始化向量
  authTag: string; // Base64 编码的 16 字节 GCM 认证标签
}

/**
 * 内部辅助函数：将原始密钥字节导入为 Web Crypto 的 CryptoKey 对象
 */
async function importKey(key: Uint8Array): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "raw",
    key as any as BufferSource,
    { name: ALGORITHM },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 使用 AES-256-GCM 算法对明文字符串进行端到端加密
 * @param plaintext 需要加密的明文字符串 (如 JSON 序列化后的 2FA 密钥与元数据)
 * @param key 256 位 (32 字节) 的高强对称加密密钥
 * @returns 包含 Base64 密文、Nonce 与 AuthTag 的加密数据对象
 */
export async function encryptAES256GCM(plaintext: string, key: Uint8Array): Promise<EncryptedData> {
  if (key.length !== 32) {
    throw new Error("AES-256-GCM 密钥长度必须为精确的 32 字节 (256 bits)");
  }

  const cryptoKey = await importKey(key);
  const nonce = generateRandomBytes(IV_LENGTH);
  const encodedPlaintext = new TextEncoder().encode(plaintext);

  // 调用底层 Web Crypto API 执行硬件级加密
  const ciphertextWithTagBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: nonce as any as BufferSource,
      tagLength: AUTH_TAG_LENGTH * 8, // 128 位认证标签
    },
    cryptoKey,
    encodedPlaintext as any as BufferSource
  );

  const ciphertextWithTag = new Uint8Array(ciphertextWithTagBuffer);
  // WebCrypto 将认证标签自动附加在密文末尾，此处将其切分存储
  const ciphertextBytes = ciphertextWithTag.slice(0, ciphertextWithTag.length - AUTH_TAG_LENGTH);
  const authTagBytes = ciphertextWithTag.slice(ciphertextWithTag.length - AUTH_TAG_LENGTH);

  return {
    ciphertext: uint8ArrayToBase64(ciphertextBytes),
    nonce: uint8ArrayToBase64(nonce),
    authTag: uint8ArrayToBase64(authTagBytes),
  };
}

/**
 * 使用 AES-256-GCM 算法对加密数据进行解密与完整性校验
 * @param data 加密数据对象 (含密文、Nonce 和 AuthTag)
 * @param key 256 位 (32 字节) 的对称解密密钥
 * @returns 解密还原的 UTF-8 明文字符串
 * @throws 当密码错误或密文遭受篡改时抛出异常 (GCM 认证标签校验失败)
 */
export async function decryptAES256GCM(data: EncryptedData, key: Uint8Array): Promise<string> {
  if (key.length !== 32) {
    throw new Error("AES-256-GCM 解密密钥长度必须为精确的 32 字节 (256 bits)");
  }

  const cryptoKey = await importKey(key);
  const nonce = base64ToUint8Array(data.nonce);
  const authTag = base64ToUint8Array(data.authTag);
  const ciphertext = base64ToUint8Array(data.ciphertext);

  // WebCrypto 期望将密文与认证标签合并在单个 Buffer 中进行校验与解密
  const ciphertextWithTag = new Uint8Array(ciphertext.length + authTag.length);
  ciphertextWithTag.set(ciphertext, 0);
  ciphertextWithTag.set(authTag, ciphertext.length);

  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv: nonce as any as BufferSource,
      tagLength: AUTH_TAG_LENGTH * 8,
    },
    cryptoKey,
    ciphertextWithTag as any as BufferSource
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * 生成指定字节长度的高强度密码学安全伪随机密钥 (CSPRNG)
 * @param length 密钥字节数，默认为 32 字节 (256 位)
 */
export function generateRandomKey(length = 32): Uint8Array {
  return generateRandomBytes(length);
}
