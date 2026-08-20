/**
 * @file EntryService.ts
 * @description 2FA 账号条目的零知识加密存储与解密读取服务
 * 确保数据库 SQLite 中存储的均为强加密数据，任何明文（密钥、账号信息、备注）均不以明文落地。
 */

import { decryptAES256GCM, encryptAES256GCM, generateRandomKey } from "../crypto/aes";
import type { EntryMetadata, EntryPayload } from "../types/domain";

/**
 * 跨环境安全生成 UUID v4
 */
function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = generateRandomKey(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

/**
 * 加密并创建新的 2FA 账号记录
 * @param payload 明文 2FA 条目载荷 (含密钥、服务商、账号、算法等)
 * @param vaultId 所属保险库 ID
 * @param vaultKey 当前保险库在内存中的 32 字节解密主密钥
 * @returns 准备写入 SQLite 数据库的密文条目元数据
 */
export async function createEntry(
  payload: EntryPayload,
  vaultId: string,
  vaultKey: Uint8Array,
  options?: { favorite?: boolean; sortOrder?: number },
): Promise<EntryMetadata> {
  const jsonPayload = JSON.stringify(payload);
  const encrypted = await encryptAES256GCM(jsonPayload, vaultKey);

  return {
    id: generateUUID(),
    vaultId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    favorite: options?.favorite ?? false,
    sortOrder: options?.sortOrder ?? 0,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
  };
}

/**
 * 解密并读取单个 2FA 账号明文信息
 * @param entry 数据库中的密文条目元数据
 * @param vaultKey 当前保险库在内存中的 32 字节主密钥
 * @returns 解密还原的 2FA 明文载荷
 */
export async function decryptEntry(
  entry: EntryMetadata,
  vaultKey: Uint8Array,
): Promise<EntryPayload> {
  const jsonPayload = await decryptAES256GCM(
    {
      ciphertext: entry.ciphertext,
      nonce: entry.nonce,
      authTag: entry.authTag,
    },
    vaultKey,
  );

  return JSON.parse(jsonPayload) as EntryPayload;
}

export const createEncryptedEntry = createEntry;
export const decryptEntryPayload = decryptEntry;
