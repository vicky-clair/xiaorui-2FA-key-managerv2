/**
 * @file VaultService.ts
 * @description 主保险库生命周期与信封加密 (Envelope Encryption) 管理服务
 * 采用双层密钥架构：
 * 1. KEK (Key Encryption Key): 通过 Argon2id 从用户主密码派生；
 * 2. DEK / VaultKey (Data Encryption Key): 随机生成的 256 位保险库数据主密钥；
 * 3. 密码修改时仅需重新加密 VaultKey，无需对所有 2FA 密文进行全量重加密。
 */

import { decryptAES256GCM, encryptAES256GCM, generateRandomKey } from "../crypto/aes";
import { DEFAULT_KDF_PARAMS, deriveKey, type KDFParams } from "../crypto/kdf";
import { base64ToUint8Array, uint8ArrayToBase64, wipeBytes } from "../crypto/utils";
import type { VaultMetadata } from "../types/domain";

/**
 * 跨环境安全生成 UUID v4 唯一标识符
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
 * 创建并初始化全新主保险库
 * @param password 用户设置的主密码 (Master Password)
 * @param name 保险库名称 (如 "My Vault")
 * @returns 包含盐值与加密后 VaultKey 的保险库元数据对象
 */
export async function createVault(password: string, name: string): Promise<VaultMetadata> {
  // 1. 生成 16 字节随机盐并派生 KEK (密钥加密密钥)
  const saltBytes = generateRandomKey(16);
  const params: KDFParams = {
    ...DEFAULT_KDF_PARAMS,
    salt: uint8ArrayToBase64(saltBytes),
  };
  const kek = await deriveKey(password, params);

  try {
    // 2. 生成实际用于加密 2FA 条目的 256 位 Vault Key (数据加密密钥)
    const vaultKey = generateRandomKey(32);

    try {
      // 3. 使用 KEK 对 Vault Key 执行 AES-256-GCM 信封加密
      const encryptedVaultKeyData = await encryptAES256GCM(uint8ArrayToBase64(vaultKey), kek);

      // 4. 返回持久化元数据结构
      return {
        id: generateUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        name,
        salt: params.salt,
        iterations: params.iterations,
        memory: params.memory,
        parallelism: params.parallelism,
        encryptedVaultKey: encryptedVaultKeyData.ciphertext,
        vaultKeyNonce: encryptedVaultKeyData.nonce,
        vaultKeyAuthTag: encryptedVaultKeyData.authTag,
      };
    } finally {
      wipeBytes(vaultKey);
    }
  } finally {
    wipeBytes(kek);
  }
}

/**
 * 解锁保险库：校验用户主密码并解密还原 Vault Key
 * 注意：派生出的 Vault Key 仅保存在内存中，严禁写入磁盘
 * @param password 用户输入的主密码
 * @param vault 数据库中读取的保险库元数据
 * @returns 解密出的 32 字节 Vault Key (Uint8Array)
 */
export async function unlockVault(password: string, vault: VaultMetadata): Promise<Uint8Array> {
  const params: KDFParams = {
    salt: vault.salt,
    iterations: vault.iterations,
    memory: vault.memory,
    parallelism: vault.parallelism,
    hashLength: 32,
  };
  const kek = await deriveKey(password, params);

  try {
    // 使用 KEK 解密出 Vault Key 的 Base64 字符串
    const vaultKeyBase64 = await decryptAES256GCM(
      {
        ciphertext: vault.encryptedVaultKey,
        nonce: vault.vaultKeyNonce,
        authTag: vault.vaultKeyAuthTag,
      },
      kek,
    );

    return base64ToUint8Array(vaultKeyBase64);
  } finally {
    wipeBytes(kek);
  }
}
